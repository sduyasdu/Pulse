# Pulse — Plans & Entitlements Spec

Status: **Proposal — decisions open (PL1–PL8)** · Owner: product + eng ·
Related: `Permissions-Spec.md` (§ Plan gating), `Server-Functions-Spec.md` (SF3 — billing/plan sync)

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

## 1. Who "the plan owner" is

A Pulse's entitlements come from a **single billing owner account**, not from each
member's own plan.

- The billing owner is the account tracked in **`Pulse.billingOwnerUid`** (new field;
  default = creator). It follows an **ownership transfer** (the "Make owner" flow already
  in `CollaboratorsDialog`) — transferring billing ownership is part of that action
  (**PL7**: confirm transfer moves billing, or keep billing with the original owner).
- Members' own plans are irrelevant to a Pulse they don't own. A Free-plan member can
  fully use a Pro owner's Pulse; that's intended (the owner pays for the workspace).
- For a Pulse inside a **Team/workspace**, the entitlement source may be the *workspace's*
  plan rather than an individual (**PL6** — recommend: workspace plan when
  `workspaceId` is a real team; personal-workspace Pulses use the owner's personal plan).

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

- A locked doc **`billing/{ownerUid}`** (or `plans/{uid}`): `{ tier, status, currentPeriodEnd, seats?, updatedAt, source }`.
- **Written only by the payment webhook** via the Admin SDK (bypasses rules) — see
  `Server-Functions-Spec.md` **SF3**. Rules: `allow read: if request.auth.uid == uid`
  (owner reads their own for UI); `allow write: if false` (no client writes ever).
- Rules gating a Pulse action read it with `get(/databases/$(db)/documents/billing/$(pulse.billingOwnerUid))`
  — security-rules `get()` bypasses the doc's own read rule, so the doc stays private but
  still gate-able.
- **Absent doc = Free** (new accounts have no billing doc until they subscribe).

## 5. Enforcement

Mirror the Permissions-Spec `entitlement ∧ capability` model at every layer.

- **Firestore rules (authoritative for anything security/quota-relevant).** A gated
  write does `planOf(pulse) has flag X` **and** the caller's `caps` allow it. Example:
  assigning a scoped role to a member is allowed only if
  `entitlements(billingOwnerUid).scopedRoles == true` **and** the actor is owner.
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

- **`Pulse.billingOwnerUid: string`** — the account whose plan entitles this Pulse
  (default = creator; moves on ownership transfer, PL7).
- **`billing/{uid}` doc** (§4): `{ tier, status, currentPeriodEnd, seats?, source, updatedAt }`.
- No change to `PulseMember`/`Resource`/`Feature`. Entitlements are read, never stored on
  those.

## 8. Open decisions (PL1–PL8)

1. **PL1 — Tier names, count, prices.** Product-owned. Recommend 3 tiers (Free/Pro/Team).
2. **PL2 — Feature-flag split.** Which features are gated (esp. `scopedRoles`, `teams`,
   `advancedCaps`). *Recommend the §3.1 split; confirm.*
3. **PL3 — Quota numbers.** The actual limits per tier (§3.2). Product-owned.
4. **PL4 — Downgrade behaviour.** *Recommend:* graceful/read-only, never destructive.
   *Confirm.*
5. **PL5 — Collection-count quotas.** Rules can't count a collection; do we (a) store a
   maintained counter (needs a function), or (b) client-guard only for v1? *Recommend
   client-guard v1, add a counter function later (register in Server-Functions-Spec).*
6. **PL6 — Personal vs workspace billing.** Whose plan entitles a team Pulse — the
   workspace's or the individual owner's? *Recommend: workspace plan for team Pulses,
   personal plan for personal-workspace Pulses.*
7. **PL7 — Ownership transfer moves billing?** Does "Make owner" also move
   `billingOwnerUid`? *Recommend yes (billing follows control); confirm.*
8. **PL8 — Payment provider.** Stripe vs. RevenueCat vs. other; drives SF3's webhook
   shape. Product/eng decision.

> **Cross-refs:** this layer is referenced from `Permissions-Spec.md` (§ Plan gating,
> `entitlement ∧ capability`), and its server side is `Server-Functions-Spec.md` **SF3**
> (billing/plan sync — webhook writes `billing/{uid}`, the only writer).
