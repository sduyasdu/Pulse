# Pulse — Plans & Entitlements Spec

Status: **Mostly decided — open: PL5, PL7, PL9** · Owner: product + eng ·
Related: `Permissions-Spec.md` (§ Plan gating), `Server-Functions-Spec.md` (SF3 — billing/plan sync)

**Decided:** billing entity is an **Organization = Workspace** (PL6); provider **Stripe**
(PL8); **quota-only** model, no feature gating (PL2); tiers **Pro/Teams/Business** at
**$0/$6/$12 per editor seat/mo** (PL1) with the §3.2 quotas (PL3); a seat = an **editor**
(PL11); launch **Mexico**, invoicing manual (PL10/10-a). See §2–§3, §8.

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
  fully use a Pulse in a paid (Teams/Business) Organization — the *Organization* pays. A
  collaborator never needs a paid seat; only editors do. This is intended.
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

## 2. Tiers & pricing (PL1 — decided)

**Three tiers, differentiated by quantity limits only** (§3) — every tier has **every
feature**. Price is **per editor seat, per month**, in **USD**, billed **monthly in
arrears** ("mass" billing at month end) via Stripe. For Mexican customers the price is
**VAT-inclusive** (IVA 16% via Stripe Tax); the SAT factura global stays manual (§9.5).

| Tier | $/editor/mo | Editor seats | Pulses/org | Collaborators/org | Resources/Pulse |
|---|---|---|---|---|---|
| **Pro** | **$0** (free) | 1 (fixed) | 3 | 10 | 20 |
| **Teams** | **$6** | per purchased seat | 5 | 20 | 40 |
| **Business** | **$12** | per purchased seat | ∞ | ∞ | ∞ |

- **Pro is the free default** — the absence of a subscription (no Stripe product). One
  editor (the org owner), enough to plan solo and invite collaborators.
- **Teams / Business bill per editor seat** (Stripe subscription `quantity` = editor
  count). Pulses / collaborators / resources are the tier's caps; editors are the billing
  driver and, on Teams/Business, are limited only by the seats purchased.

## 3. Entitlements = quantity limits only (no feature gating)

Every tier unlocks **every feature** — canvas, kanban, epics, all roles, comments,
activity, undo, costs, i18n. Tiers differ **only** by the limits below, so a downgrade
never removes a capability, only caps growth. Resolved from the tier in
`src/domain/entitlements.ts` (`TIER_ENTITLEMENTS`).

### 3.1 The licensing model — editors vs collaborators

Two kinds of member, per Organization:

- **Editors** (roles **owner** / **editor**) are **paid seats**. Only editors can **create
  Pulses** and fully edit. The number of editors in an org ≤ its editor-seat limit (Pro = 1;
  Teams/Business = purchased seats). "Pay users create Pulses."
- **Collaborators** (roles **full viewer** / **my-beat viewer** / **task lead**) are **free**,
  don't consume an editor seat, and **cannot create Pulses** — they only participate in
  Pulses the org's editors own. They count toward the collaborator quota.

A **user's role is per-Organization**: the same person can be a collaborator in one org, an
owner/editor in another, and an editor in several more — each editor role consumes one seat
**in that org**. Every user also gets their own free **Pro** org (their personal workspace),
where they are the single editor and can create up to 3 Pulses.

### 3.2 Quotas (per org, unless noted)

| Quota | Pro | Teams | Business |
|---|---|---|---|
| Editor seats | 1 (fixed) | purchased | purchased |
| Pulses per org | 3 | 5 | ∞ |
| Collaborators per org | 10 | 20 | ∞ |
| Resources per Pulse | 20 | 40 | ∞ |

Checks happen at the **point of growth** (create Pulse, add editor/collaborator, add
resource), never on read; enforced client-side for v1 (PL5), with a counter function later
if a collection count must be authoritative. Encoded in `src/domain/entitlements.ts`
(`Entitlements` = `{ maxEditors, maxPulses, maxCollaborators, maxResourcesPerPulse }`;
`maxEditors: null` on Teams/Business means "bounded by purchased seats", `editorSeatLimit()`).

### 3.3 Dashboard — Pulses grouped by Organization

Because a user can belong to several orgs, the dashboard groups Pulses **by Organization**:

- **Your Pulses** — Pulses in orgs where you're an **editor/owner**, grouped under each org.
- **Shared with you** — Pulses in orgs where you're a **collaborator**, grouped under each org.
- The **New Pulse** action appears only for editors (collaborators can't create). If a user
  is an editor in **more than one** org, creating a Pulse **prompts which org** it belongs to
  (or the app derives it from dashboard context — e.g. the org section the action was invoked
  from). With a single editor org, that org is used implicitly.

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
- **Absent doc = Pro** (the free default — a newly-created Organization has no billing doc
  until it subscribes to Teams/Business).

## 5. Enforcement

There is **no feature gating** — enforcement is entirely about **quantity limits** at the
point of growth (create Pulse, add editor/collaborator, add resource).

- **Create-Pulse gate.** Only an **editor** (role owner/editor) in the target org may create
  a Pulse, and only while the org is under its `maxPulses` cap. Collaborators can't create.
- **Seat / member gates.** Promoting a member to editor is allowed only while editors <
  `editorSeatLimit` (Pro 1; Teams/Business purchased `seats`). Adding a collaborator is
  allowed only under `maxCollaborators`. Adding a resource, under `maxResourcesPerPulse`.
- **Firestore rules** enforce what they can check cheaply (a stored counter or an
  array-length in the same doc, read via `get(billing/{pulse.workspaceId})`). **Counts
  across a collection can't be done in rules** → client-guarded for v1 (PL5), with a counter
  function later (`Server-Functions-Spec`) if a count must be authoritative.
- **Client (UX).** Read the effective entitlements (from `billing/{workspaceId}`), disable/
  soft-gate growth controls with an **upsell** affordance (ties into the "Billing & payment"
  item already stubbed in the account menu). Client gating alone is *not* the security
  boundary — rules are.

### 5.1 Downgrade behaviour (PL4 — decided)

**Graceful downsize, never destructive** — nothing is ever deleted. The over-limit handling
below applies **only when downgrading to the free tier (Pro)**; paid→paid downgrades are
handled at the source (the portal blocks reducing seats below the current editor count) and
are otherwise out of scope for v1.

- **Pulses over the limit → newest become read-only; archive to unlock.** On dropping to Pro
  (3 Pulses), at most `maxPulses` **non-archived** Pulses stay editable; the **newest** beyond
  that are **read-only** (viewable, not editable), never deleted. To edit a locked Pulse the
  owner **archives another active Pulse**, freeing a slot so a locked one becomes editable —
  i.e. the owner chooses which 3 stay live. Enforced **client-side** (the lock is derived from
  the Pulse list ordered by `createdAt` + the tier cap; rules can't count/sort — PL5); a
  bypass only lets someone exceed a commercial limit, not a security boundary.
- **Editors are demoted to a single editor.** Pro allows **1 editor seat**, so on the
  downgrade every editor/owner **except the org owner** (the workspace owner — the only user
  who can trigger a billing change) is **demoted to full viewer** across the org's Pulses.
  They keep access and their data; they lose edit until the org re-subscribes and the owner
  re-promotes them. Done **server-side** (SF3, or a companion, when the billing doc flips to
  Pro/canceled) so it happens regardless of client, keeping `workspace.ownerId` as the sole
  editor.
- **Collaborators are unaffected.** Viewers / my-beat viewers / task leads keep their access
  and roles even if the org is over the collaborator quota; only *adding new* collaborators is
  blocked while over.
- **Grace before enforcing.** Ride Stripe's dunning: treat `past_due` as still-paid for a
  short grace window before the org resolves to Pro.

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

1. **PL1 — Tiers & prices. → DECIDED (§2).** Pro/Teams/Business, **$0 / $6 / $12 per editor
   seat / month**, USD, billed monthly in arrears via Stripe, VAT-inclusive for MX.
2. **PL2 — Feature gating. → DECIDED: none.** All tiers have all features; tiers differ by
   quantity limits only (§3). No feature flags in `Entitlements`.
3. **PL3 — Quota numbers. → DECIDED (§3.2).** Pro 1 editor / 3 Pulses / 10 collaborators /
   20 resources; Teams (per seat) 5 / 20 / 40; Business unlimited. (Matches `entitlements.ts`.)
4. **PL4 — Downgrade behaviour. → DECIDED (§5.1).** Graceful, never destructive, and only on
   dropping to **Pro**: the **newest** over-limit Pulses go **read-only** (archive another to
   unlock — owner picks which 3 stay live); every editor **except the org owner** is **demoted
   to full viewer** (keep access, lose edit) server-side; **collaborators unaffected**; a grace
   window on `past_due`.
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
    only**; Organizations are Mexico-based (`country: "MX"`), priced in **USD** with **IVA
    (16%) included** (VAT-inclusive) via Stripe Tax. Additional countries are a later
    expansion (§9.4).
    - **PL10-a — CFDI/invoicing at launch. → DECIDED: none in Pulse; the factura global is
      issued MANUALLY, out of band.** No CFDI code, no PAC integration, no invoicing function
      is built — removed from scope. Customers get only the (non-fiscal) Stripe receipt;
      Mexican origin is inferred from **card country**; finance/the accountant reads the
      period's collections from the **Stripe dashboard** and files the SAT factura global
      themselves. Automating it (scheduled job and/or PAC) is a later, separate initiative.
      Full detail in §9.5.
11. **PL11 — Seat definition. → DECIDED: an editor seat.** A billable seat = one **editor**
    (role owner/editor) in the org; collaborators (viewers / task leads / my-beat viewers)
    are free and don't consume seats. `billing.seats` = purchased editor seats = Stripe
    subscription `quantity`. Pro is fixed at 1 editor; Teams/Business bill per editor.

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
- **Seats** (PL11) map to Stripe **quantity** on the per-seat price (Teams/Business);
  `quantity` = the org's editor count.

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

- **Currency:** USD, **VAT-inclusive** for MX. **Tax:** **IVA** (VAT) 16% — calculated by
  **Stripe Tax** (Mexico supported) and included in the $6/$12 price. No tax IDs collected
  in-app at launch (see below).
- **Stripe covers:** IVA calculation via Stripe Tax, USD charges, and hosted Checkout/Portal.
  That is the full extent of billing Pulse builds for Mexico at launch.

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

### 9.6 Stripe setup — concrete requirements

Everything that must exist in Stripe (and as function secrets) before SF3 / Checkout can
ship, grouped by owner. This is the prerequisite the build plan calls "Stripe account".

**A. Account & tax — product/finance**
- Activate the Stripe account for **Mexico**: **USD** charges, business verification, payout.
- Enable **Stripe Tax**; register the **Mexico IVA (16%)** obligation; set the SaaS tax
  category; use **tax-inclusive** pricing so the $6/$12 already includes IVA for MX (PL1).
- (Reminder — PL10-a) Stripe does not issue CFDIs; the factura global stays **manual**.

**B. Product catalog — product (Stripe dashboard)**
- Product **"Pulse Teams"** → recurring **per-seat** Price billed by `quantity`:
  **$6 USD / editor / month**.
- Product **"Pulse Business"** → recurring **per-seat** Price billed by `quantity`:
  **$12 USD / editor / month**.
- **No Pro product** — Pro is the free default (absence of a subscription; 1 editor).
- Monthly billing **in arrears** (usage/quantity finalized at period end — "mass billing").
- On **every Price**, set metadata **`tier`** (`teams`|`business`) so SF3 maps a
  subscription's price → our tier without hard-coding Price ids. The subscription
  `quantity` = editor seats (PL11).

**C. Integration surfaces — eng**
- **Checkout (hosted)** — a callable creates a Checkout Session: `mode: "subscription"`,
  the chosen Price, `client_reference_id = workspaceId`, and the workspace's
  `stripeCustomerId` (create the Customer on first checkout, store it on the Workspace,
  set Customer metadata `workspaceId`). Success/cancel URLs return to the billing screen.
- **Customer Portal** — configure allowed actions (switch Teams↔Business, change seats/
  `quantity`, update card, cancel, view invoices). The account-menu **"Billing & payment"**
  deep-links to a portal session (a second callable).
- **Webhook → SF3** (the HTTPS function URL). Subscribe to:
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
  `invoice.payment_failed`. SF3 verifies the signature, maps the subscription's
  price-metadata → `{ tier, status, currentPeriodEnd, seats, currency, … }`, and writes
  `billing/{workspaceId}` (workspace resolved from the Customer). Idempotent by event id
  (at-least-once delivery).

**D. Secrets — eng (Firebase Functions secrets, test + live)**
- `STRIPE_SECRET_KEY` — for the Checkout/Portal callables.
- `STRIPE_WEBHOOK_SECRET` — for SF3 signature verification.
- Set via `firebase functions:secrets:set …`; QA with **test** keys + Stripe **test
  clocks** before switching to live.

**E. Data mapping — already scaffolded (Phase 3 groundwork)**
- `Workspace.stripeCustomerId` / `stripeSubscriptionId` (types shipped).
- Customer metadata `workspaceId` ↔ our workspace; Price metadata `tier` ↔ our tier.
- Seats (PL11): subscription `quantity` = unique users across the org's Pulses.
