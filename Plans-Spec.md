# Pulse — Plans & Entitlements Spec

Status: **Proposal — decisions open (PL1–PL11)** · Owner: product + eng ·
Related: `Permissions-Spec.md` (§ Plan gating), `Server-Functions-Spec.md` (SF3 — billing/plan sync)

**Decided:** the billing entity is an **Organization** (§1), and the payment provider is
**Stripe** (**PL8** — resolved; see §4 and §9).

## 0. What this is (and isn't)

This spec defines the **subscription/plan layer**: what each paid tier unlocks and
which limits it imposes. It is a **different axis** from `Permissions-Spec.md`:

- **Permissions (authorization):** *which member* may do *what* in a Pulse (roles/caps).
- **Plans (entitlement):** does the **owner's subscription** unlock a feature / allow a
  quantity — regardless of role.

They combine as:

> **effective permission = plan entitlement ∧ role capability**

A member with a capable role still can't use a feature the owner's plan doesn't include;
and a plan that includes a feature still respects each member's role. Neither overrides
the other — both must say yes.

Spec/design only — no application code changes.

## 1. Who "the plan owner" is — the Organization

A Pulse's entitlements come from a **single billing entity: an Organization** — not from
an individual member, and not from each member's own plan.

> **The Organization *is* the Workspace (PL6, decided — option 1).** Rather than a new
> parallel entity, an Organization is the app's existing **`Workspace`** extended with
> billing + legal identity (country, Stripe, org roles). So `orgId === workspaceId`, and a
> Pulse's org is its existing **`Pulse.workspaceId`** — no separate `billingOrgId` and no
> second membership roster. "Organization" is the name for the billing/legal face of a
> Workspace. Everything below that says "Organization" is a property of that Workspace.

- Every Pulse belongs to exactly one **Workspace/Organization** (`Pulse.workspaceId`). The
  Organization holds the subscription; its plan entitles *all* Pulses in that workspace.
  (Supersedes the earlier `billingOwnerUid`/`billingOrgId` sketch — billing attaches to the
  workspace, not a single user account. Both are retired; see §7.)
- **Members' own plans are irrelevant.** A member with no subscription of their own can
  fully use a Pulse in a Pro/Team Organization — the *Organization* pays. This is intended.
- **Solo / personal use** is just the user's **personal workspace** acting as a
  single-admin personal Organization (auto-created on sign-up — it already exists as
  `user.personalWorkspaceId`). There is always a workspace behind a Pulse, so there is
  always an org; "no organization" is not a state.
- **Ownership transfer** moves a Pulse between workspaces/organizations by reassigning its
  `workspaceId` (the "Make owner"/transfer flow). Entitlements immediately follow the new
  org's plan (**PL7**).

### 1.1 The Organization entity (= the extended Workspace)

An **Organization** is a **Workspace** in its role as the account that subscribes, pays,
and is invoiced. It owns Pulses (its `workspaceId` Pulses) and, beyond what a Workspace
holds today, has:

- **Administrators** — the existing **`WorkspaceMember`** roster carries the org roles:
  workspace `owner` → org **admin**, workspace `member` → org **member** (PL9). Admins
  manage the subscription and billing, the org's country/tax details, and org/workspace
  membership. A user can administer more than one Organization (they're an owner in more
  than one workspace); a user's *plan-level* rights in a Pulse come from that Pulse's org,
  never from the user. Org **admin** is a distinct axis from a Pulse's per-Pulse roles
  (`Permissions-Spec.md`): being an org admin does **not** grant edit rights inside a
  Pulse, and a Pulse owner/editor is not automatically an org admin. (**PL9** — confirm
  whether to keep the `owner/member` names or rename to `admin/member`; the mapping is the
  point.)
- **A country of establishment** — the ISO 3166-1 country the Organization is legally
  based in, plus optionally the set of countries it operates/bills in. This is the anchor
  for tax, currency, and invoice legal requirements (§9). It is set when the org is
  created and editable by admins; changing it may re-derive tax treatment going forward
  (never retroactively — issued invoices are immutable records).

Members' own plans stay irrelevant; only the owning Organization's plan matters for
entitlement.

## 2. Tiers (placeholder — product to finalize, PL1)

Illustrative; final names/prices are product's. The shape is what matters.

| Tier | Intent |
|---|---|
| **Free** | Solo / trial. Core planning, coarse roles only. |
| **Pro** | Individual power user. Granular roles, larger quotas. |
| **Team** | Multi-seat workspace. Everything + team management + higher quotas. |

## 3. Entitlements = feature flags + quotas

Two kinds, both derived from the tier.

### 3.1 Feature flags (boolean unlocks)

Candidate gated features (PL2 — confirm the split):

| Flag | Free | Pro | Team |
|---|---|---|---|
| `scopedRoles` — assign My-Beat Viewer / Task Lead (`Permissions-Spec`) | ✗ | ✓ | ✓ |
| `teams` — workspaces with >1 member | ✗ | ✗ | ✓ |
| `advancedCaps` — custom capability toggles (Permissions §5 Advanced) | ✗ | ✓ | ✓ |
| (future) integrations / export / API | ✗ | — | ✓ |
| (candidate) `costs` — the cost layer (`Costs-Spec.md`) | ? | ? | ? |
| (candidate) `byos` — bring your own storage (`Storage-Spec.md`) | ? | ? | ? |

Coarse roles (owner/editor/full-viewer) and commenting stay on **every** tier so
downgrades never lock people out of basic collaboration.

**Cost tracking (`Costs-Spec.md`) is listed as a candidate, not a decision** — whether
it's gated at all, and whether as a flag or a quota (entries per Pulse), is open and
belongs to PL2/PL3. If it is gated, note that §5's downgrade rule matters more here
than elsewhere: recorded spend is *history*, so a lapse must hide or freeze the view,
never drop entries.

### 3.2 Quotas (numeric limits)

Candidate quotas (PL3 — confirm the numbers):

| Quota | Free | Pro | Team |
|---|---|---|---|
| Pulses per billing owner | e.g. 3 | ∞ | ∞ |
| Members per Pulse (incl. viewers) | e.g. 3 | e.g. 10 | ∞ |
| Resources per Pulse | e.g. 15 | ∞ | ∞ |

Quota checks happen at the **point of growth** (create Pulse, add member/link, add
resource), never on read.

## 4. Storage — server-authoritative plan

The plan **must not be client-writable** (a user could set themselves to Pro). Design:

- A locked doc **`billing/{orgId}`** where **`orgId === workspaceId`** (PL6): `{ tier,
  status, currentPeriodEnd, seats?, updatedAt, source, stripeCustomerId,
  stripeSubscriptionId, country, currency, taxStatus? }`. Keyed by **workspace/Organization**,
  not user — one subscription per org.
- **Written only by the Stripe webhook** via the Admin SDK (bypasses rules) — see
  `Server-Functions-Spec.md` **SF3**. Rules: `allow read: if isOrgAdmin(orgId)` — i.e. the
  caller is an `owner` in `WorkspaceMember` for that workspace (org admin); `allow write: if
  false` (no client writes ever — the tier is set from Stripe's subscription state, never by
  a client).
- Rules gating a Pulse action read it with
  `get(/databases/$(db)/documents/billing/$(pulse.workspaceId))` — security-rules `get()`
  bypasses the doc's own read rule, so the doc stays private but still gate-able.
- **Absent doc = Free** (a newly-created Organization has no billing doc until it
  subscribes).

## 5. Enforcement

Mirror the Permissions-Spec `entitlement ∧ capability` model at every layer.

- **Firestore rules (authoritative for anything security/quota-relevant).** A gated
  write does `planOf(pulse) has flag X` **and** the caller's `caps` allow it. Example:
  assigning a scoped role to a member is allowed only if
  `entitlements(pulse.workspaceId).scopedRoles == true` **and** the actor is owner.
  Quotas that rules can check cheaply (a stored counter, or comparing an array length in
  the same doc) go in rules; **counts across a collection can't be done in rules** →
  those are client-guarded + optionally reconciled by a function (PL5, and
  `Server-Functions-Spec` if a counter function is added).
- **Client (UX).** Read the effective entitlements (from `billing/{owner}`), disable/soft-
  gate gated controls with an **upsell** affordance (ties into the "Billing & payment"
  item already stubbed in the account menu). Client gating alone is *not* the security
  boundary — rules are.
- **Downgrade behaviour (PL4).** When a plan lapses to a lower tier, over-quota/over-
  feature state must degrade gracefully, **read-only not destructive**: e.g. existing
  scoped-role assignments keep working but no *new* ones can be created; Pulses beyond
  the Free limit become read-only rather than deleted. Recommend never auto-deleting
  data on downgrade.

## 6. UX

- **Account menu** already has a stubbed **"Billing & payment"** entry — that becomes the
  plan/billing screen (current tier, usage vs. quota, upgrade/manage → payment provider
  portal). *Entering payment details is handled by the provider's hosted flow, never
  in-app.*
- Gated controls show a lightweight upsell ("Pro feature") instead of silently vanishing,
  so the value is discoverable.
- Quota-at-limit shows a clear "you've hit your plan's limit" with the upgrade path.

## 7. Data-model changes (additive)

**PL6 decided (option 1): the Organization is the existing `Workspace`, extended.** No
separate `organizations/{orgId}` collection, no `Pulse.billingOrgId`, no second roster —
`orgId === workspaceId`, and a Pulse's org is its existing `Pulse.workspaceId`.

- **Extend `Workspace`** (`workspaces/{workspaceId}`) with org/legal fields:
  `country` (ISO 3166-1 alpha-2, legal establishment), `countries?: string[]` (additional
  billing jurisdictions), `stripeCustomerId?`, and for the launch country
  `rfc?`, `taxRegime?`, `postalCode?` (§9.5). `isPersonal: true` = a single-admin personal
  org.
- **Reuse `WorkspaceMember`** as the org roster: role `owner` = org **admin**, `member` =
  org member (PL9). No new membership collection.
- **`billing/{workspaceId}` doc** (§4): `{ tier, status, currentPeriodEnd, seats?, source,
  updatedAt, stripeCustomerId, stripeSubscriptionId, country, currency, taxStatus? }`.
  Keyed by workspace id.
- **Retired:** `Pulse.billingOwnerUid` and the interim `Pulse.billingOrgId` — the org is
  resolved from `Pulse.workspaceId`, so a Pulse can never drift from its org.
- No change to `PulseMember`/`Resource`/`Feature`. Entitlements are read, never stored on
  those.

## 8. Open decisions (PL1–PL11)

1. **PL1 — Tier names, count, prices.** Product-owned. Recommend 3 tiers (Free/Pro/Team).
2. **PL2 — Feature-flag split.** Which features are gated (esp. `scopedRoles`, `teams`,
   `advancedCaps`). *Recommend the §3.1 split; confirm.*
3. **PL3 — Quota numbers.** The actual limits per tier (§3.2). Product-owned.
4. **PL4 — Downgrade behaviour.** *Recommend:* graceful/read-only, never destructive.
   *Confirm.*
5. **PL5 — Collection-count quotas.** Rules can't count a collection; do we (a) store a
   maintained counter (needs a function), or (b) client-guard only for v1? *Recommend
   client-guard v1, add a counter function later (register in Server-Functions-Spec).*
6. **PL6 — Organization ↔ workspace mapping. → DECIDED: option 1 (fold together).** The
   Organization **is** the existing `Workspace`, extended with billing/legal fields; a
   non-personal workspace is a team org, a personal workspace is a single-admin personal
   org. `orgId === workspaceId`; the org is resolved via `Pulse.workspaceId` (no separate
   entity, no `billingOrgId`, no second roster — §7). Reuse `WorkspaceMember` for org roles
   (PL9). *Future:* one-org-owns-many-workspaces (option 2) is a later change if a single
   bill must span multiple workspaces — not needed now.
7. **PL7 — Ownership transfer moves billing?** Does the transfer flow move the Pulse's
   `workspaceId` to the new owner's workspace/org? *Recommend yes (billing follows control);
   confirm, and define what happens if the target user has no team workspace (falls back to
   their personal org, or must pick one).*
8. **PL8 — Payment provider. → DECIDED: Stripe.** Drives SF3's webhook shape and the §9
   country/tax design. (Was Stripe vs RevenueCat vs other.)
9. **PL9 — Org role set.** Just `admin` + `member`, or a richer set (billing-admin vs
   org-admin, owner)? *Recommend `admin` + `member` to start; `admin` manages billing +
   membership + country/tax.*
10. **PL10 — Launch country. → DECIDED: Mexico (MX).** Pulse launches billing in **Mexico
    only**; Organizations are Mexico-based (`country: "MX"`), billed in **MXN**, with **IVA
    (16%)** calculated by Stripe Tax. Additional countries are a later expansion (§9.4).
    - **PL10-a — CFDI/invoicing at launch. → DECIDED: none in Pulse; the factura global is
      issued MANUALLY, out of band.** No CFDI code, no PAC integration, no invoicing function
      is built — removed from scope. Customers get only the (non-fiscal) Stripe receipt;
      Mexican origin is inferred from **card country**; finance/the accountant reads the
      period's collections from the **Stripe dashboard** and files the SAT factura global
      themselves. Automating it (scheduled job and/or PAC) is a later, separate initiative.
      Full detail in §9.5.
11. **PL11 — Seat definition.** What counts as a billable "seat" — an Organization member,
    or a member across the org's Pulses (deduped by user)? Drives `billing.seats` and the
    Team-tier quota (§3.2). *Recommend: unique users across the org's Pulses, deduped.*

> **Cross-refs:** this layer is referenced from `Permissions-Spec.md` (§ Plan gating,
> `entitlement ∧ capability`), and its server side is `Server-Functions-Spec.md` **SF3**
> (billing/plan sync — the Stripe webhook writes `billing/{orgId}`, the only writer).

## 9. Payments, tax & country-aware invoicing (Stripe)

**Provider: Stripe** (PL8, decided). The guiding principle is to **lean on Stripe's own
compliance machinery for per-country legal requirements rather than building tax/invoice
logic in Pulse.** Pulse's job is to model the Organization and its country correctly and
hand that to Stripe; Stripe computes tax.

> **Scope note — read §9.5 for the actual launch.** §9.1–§9.4 describe the *future*
> multi-country vision (where Stripe also produces the legal invoice). That does **not**
> hold for the Mexico launch: Stripe cannot issue a SAT-valid CFDI, so at launch Pulse
> **builds no invoicing** — the factura global is done **manually, out of band** (§9.5).
> Only the subscription/tax/entitlement parts (§9.1, §9.3 entitlement sync) are in the
> launch build.

### 9.1 Mapping Pulse → Stripe

- One **Stripe Customer per Organization/Workspace** (`Workspace.stripeCustomerId`), created on
  first subscribe. The customer's **address (country)** and any **Tax IDs** (VAT/CUIT/EIN/
  ABN…) come from the Organization's country/legal details (§1.1). Country drives currency,
  tax treatment, and invoice format.
- One **Subscription per Organization**, mapped to the tier (PL1). Subscription state is
  the source of truth for `billing/{orgId}.tier/status` (§4), synced by **SF3**.
- **Seats** (PL11) map to Stripe **quantity** on a per-seat price, if Team tier is
  per-seat.

### 9.2 Leverage Stripe's country/legal capabilities (don't reinvent)

- **Stripe Tax** — automatic calculation and collection of VAT / GST / sales tax by the
  customer's jurisdiction, including rate lookup, thresholds, and reverse-charge handling.
  This is the primary mechanism for "invoice per each country's legal requirements."
- **Customer Tax IDs** — collect and validate business tax IDs; Stripe renders them on
  invoices where legally required and applies reverse-charge/B2B rules.
- **Stripe Invoicing / hosted invoices & credit notes** — Stripe produces the invoice
  document with the fields each country mandates (sequential numbering, seller/buyer tax
  details, tax breakdown, currency), hosted + PDF. Where Stripe supports **local/e-invoicing
  or Revenue Recognition** for a jurisdiction, use it rather than a custom pipeline.
- **Stripe Checkout / Customer Portal** — all payment-detail entry and plan management
  happens in Stripe's **hosted** flows (never in-app — consistent with §6 and the app's
  security rules against handling card data). The account-menu "Billing & payment" screen
  deep-links into the portal.

### 9.3 What Pulse still owns

- **Correct org country & legal identity** — capture at org creation, editable by admins;
  this is the input Stripe Tax/Invoicing depends on, so it must be accurate.
- **Entitlement sync** — SF3 translates Stripe subscription/tax events into
  `billing/{orgId}` (idempotently; Stripe delivers webhooks at-least-once). Invoices/tax
  are read-only artifacts in Stripe; Pulse links to them, never regenerates them.
- **Immutability of issued documents** — a later change to the org's country affects
  *future* invoices only; already-issued invoices are legal records and are never
  rewritten.

### 9.4 Phasing (future-facing)

Country-aware invoicing is explicitly a **future** capability, not v1. Sequence:
1. Stripe Customer + Subscription per Org; tier sync via SF3; hosted Checkout/Portal.
   (Enough to charge and gate — single-country to start, PL10.)
2. Turn on **Stripe Tax** + Tax ID collection for the launch countries (PL10).
3. Expand jurisdictions / enable local e-invoicing where Stripe offers it, as Pulse sells
   into more countries.

The org data model (§1.1, §7) is designed now so this can land later without a migration:
`Organization.country`/`countries` and the per-org Stripe Customer are the only anchors
the country-aware tax/invoicing work needs.

### 9.5 Launch country: Mexico (PL10, decided)

Pulse launches billing in **Mexico only**. Concretely:

- **Currency:** MXN. **Tax:** **IVA** (VAT), standard **16%** — calculated/collected by
  **Stripe Tax** (Mexico supported). No tax IDs are collected in-app at launch (see below).
- **Stripe covers:** IVA calculation/collection via Stripe Tax, MXN charges, and hosted
  Checkout/Portal. That is the full extent of billing Pulse builds for Mexico at launch.

- **PL10-a — CFDI approach at launch. → DECIDED: no invoicing in Pulse; the factura global
  is issued MANUALLY, out of band.** Pulse (and any integrated service) issues **no fiscal
  documents at all** at launch:
  - Pulse builds **no CFDI code, no PAC integration, and no invoice-issuing function** —
    none of it is in scope. **Removed from the build entirely.**
  - Each customer receives only the **generic Stripe invoice/receipt** for their charge,
    which has **no legal (fiscal) status in Mexico**. The billing UI must not imply it's a
    tax invoice.
  - **Customer origin (is-this-Mexico?) is inferred from the payment card's country**
    (Stripe card/issuer country), **not** from a collected RFC or address — keeps onboarding
    frictionless; no fiscal-data capture.
  - The SAT-required **factura global** (CFDI to público en general) is produced **manually
    by finance/the accountant, outside Pulse** — they read the period's collections from the
    **Stripe dashboard** and file the global invoice with the SAT themselves. Pulse's only
    job is to make the charge data available in Stripe (which it already is).
  - **Trade-off (accepted):** no automation and no per-customer CFDI. Automating this — a
    scheduled collections job and/or a PAC integration for per-customer CFDIs — is a
    **later, separate initiative** with its own decision, deliberately **not** built now.

- **Data implications:** because there is no in-app invoicing, the Mexico fiscal fields once
  sketched on `Workspace` (`rfc`, `taxRegime`, `postalCode`, `usoCFDI`) are **not added** —
  they belong to a future automated-CFDI effort if it ever happens. Store nothing fiscal at
  launch.
- **No new server function for MX at launch.** The only billing function is **SF3**
  (Stripe subscription → `billing/{orgId}` sync). There is no scheduled invoicer.
