# Pulse — Billing & Backend Functions Build Plan

Companion to **`Plans-Spec.md`**, **`Server-Functions-Spec.md`**, and
**`Backend-Architecture-Spec.md`** (what to build and why). This is the **how**, in order,
against the codebase as it stands at `8fed153`.

**Framing — one program, not two builds.** The Plans/Billing spec is *delivered through*
backend functions (SF3 + rules + client UX), so it shares the Functions foundation with the
hardening functions. Sequence everything by dependency and risk on one timeline.

**Today's baseline:** Pulse is **100% serverless** — a React client talking straight to
Firestore. There are **no Cloud Functions** (`functions/` doesn't exist; `firebase.json`
has only `hosting`, `firestore`, `emulators`). Phase 0 stands the runtime up; nothing
server-side can precede it.

Sizes are rough calibration, not commitments: **S** ≈ half a day, **M** ≈ 1–2 days,
**L** ≈ 3–4 days, **XL** ≈ a week+.

---

## Start now — non-code prerequisites with real lead time

These gate the billing phases and are **not** engineering tasks. Kick them off on day 0, in
parallel with Phase 0–2, so Phase 3 isn't blocked when it's ready.

- **Close PL1–PL3** — tier names/prices, which features are gated (§3.1), quota numbers
  (§3.2). Product-owned; blocks the entitlement model, so nothing in Phase 3 is real until
  these are frozen.
- **Stripe account** — test + live, products/prices matching the tiers, a webhook endpoint,
  **Stripe Tax** enabled for Mexico.
- **Mexico tax registration** — a finance/legal task. Note per PL10-a there is **no PAC and
  no invoicing code**: the SAT *factura global* is filed **manually, out of band** from the
  Stripe dashboard (Plans-Spec §9.5). The only "invoicing" prerequisite is that a human
  process exists to do it.

---

## Phase 0 — Functions foundation (M)

Stand up the runtime once; everything else rides on it. Firebase Cloud Functions 2nd-gen,
TypeScript, Admin SDK, same `pulse-b9d96` project, **region co-located with Firestore**.

**New**

- `functions/` package (own `package.json`, `tsconfig`, `src/index.ts`), added to
  `firebase.json` (`functions` block) and the emulator suite.
- A trivial `onDocumentWritten` no-op (or a `ping` callable) deployed to prove the pipeline
  end-to-end: emulator run, `firebase deploy --only functions`, logs visible.
- Shared conventions module: idempotency helpers (deterministic ids, "recompute-from-source,
  never increment"), a **skip-own-writes / denorm-only** guard, and structured logging —
  the disciplines every function in `Server-Functions-Spec.md §1` must follow.

**Exit:** a function deploys and runs in the emulator and in `pulse-b9d96`; CI builds the
`functions/` package.

---

## Phase 1 — SF1 denorm maintainer (M)

First *real* function, chosen deliberately: **low-risk** (the client interim already works
and fails **closed** — a stale denorm shows a beat viewer *fewer* tasks, never more), it
**hardens the already-shipped granular permissions**, and it exercises the whole pipeline on
data that already exists.

**New** `functions/src/denorm.ts` — owns `Feature.assignedUids` / `leadUid`. Mirror the
existing client logic in `src/domain/denorm.ts` (`featureDenorm`) and the store's
`reconcileDenorms(get)` loop.

- Trigger `onDocumentWritten pulses/{p}/features/{f}` — recompute from the feature's own
  `resources`, `children[].resources`, `lead`. Skip the write if it's the function's own
  denorm-only change (before/after diff) — avoids loops.
- Trigger `onDocumentWritten pulses/{p}/resources/{r}` — on `linkedUid` change, **fan out**:
  recompute every feature in the Pulse referencing `r`.

**Rules** — no change; `firestore.rules` already reads `assignedUids`/`leadUid`. Client keeps
writing them optimistically (SF1 reconciles) — decide at build time whether to stop the
client write or leave it as an optimistic hint.

**Exit:** for any assignment / lead / `linkedUid` change, the denorms match the algorithm
within one invocation; unlinking a resource removes it from every affected feature.

---

## Phase 2 — Cross-user integrity & cleanup — SF6–SF9 (L)

The **server-mandatory** work: a client **cannot** write another user's self-owned docs
(`users/{uid}/myPulses`, `notifications`, `presence`), so these gaps have **no safe client
interim** — today only the dashboard's `myPulses` self-heal papers over part of it. Higher
priority than the log/notification hardening in Phase 4, and unblocked by anything external.

**New** `functions/src/cascade.ts`

- **SF6 — Pulse delete cascade** (`onDocumentDeleted pulses/{p}`): purge all subcollections
  (features, epics, resources, comments, notifications, presence, activity, pulseMembers,
  billing is separate) and every member's `users/{uid}/myPulses/{p}`.
- **SF7 — Membership-removal cascade** (`onDocumentDeleted pulses/{p}/pulseMembers/{uid}`):
  clean the removed member's `myPulses` entry, their notifications/presence in that Pulse,
  and unlink them from resources (`linkedUid`).
- **SF8 — Resource-delete integrity** (`onDocumentDeleted …/resources/{r}`): strip `r` from
  every feature's `resources`/`children[].resources`/`lead` (SF1 then re-derives the
  denorms).
- **SF9 — Epic-delete integrity** (`onDocumentDeleted …/epics/{e}`): clear `epicId` on
  features that pointed at it.

All idempotent (re-deletion is a no-op) and batched.

**Exit:** deleting a Pulse / removing a member / deleting a resource or epic leaves no
dangling cross-user or cross-doc references; a removed member's dashboard shows nothing
stale even before their own self-heal runs.

---

## Phase 3 — Billing core: the revenue path — SF3 + rules + UX (XL)

The **hard security boundary**. The plan must never be client-writable. Gated on Phase 0,
frozen PL1–3, and the Stripe account. Billing is keyed by **Organization = Workspace**
(`orgId === workspaceId`, PL6) — there is **no** separate org entity or roster.

**Edit** `src/types/index.ts` — extend `Workspace` with `country` (ISO-2), `countries?`,
`stripeCustomerId?`, `stripeSubscriptionId?`. Add a `Billing`/entitlements type. **No MX
fiscal fields** (`rfc`, `taxRegime`, …) — invoicing is manual (PL10-a).

**New** `functions/src/billing.ts`

- **SF3 — Stripe webhook** (`onRequest`): verify the Stripe signature, map subscription
  create/update/cancel/renew (+ tax events) to `billing/{workspaceId} = { tier, status,
  currentPeriodEnd, seats?, stripeCustomerId, stripeSubscriptionId, country, currency,
  source, updatedAt }`, write via Admin SDK. Idempotent: recompute from the event's *current*
  subscription state; resolve the workspace from the Stripe Customer
  (`Workspace.stripeCustomerId ↔ workspaceId`).
- A **callable** to create a Checkout session / Customer-Portal link (client never handles
  card data — hosted Stripe flows only).

**Edit** `firestore.rules`

- `match /billing/{orgId}` — `read: if isOrgAdmin(orgId)` (an `owner` in that workspace's
  `WorkspaceMember`); `write: if false`.
- Gate the plan-relevant writes on entitlements: a scoped-role assignment (Permissions-Spec
  §6.5) is allowed only if `entitlements(pulse.workspaceId).scopedRoles == true` **and** the
  actor's caps allow it. Cheap quotas (array-length in the same doc) go in rules; collection
  counts are **client-guarded for v1** (PL5), a counter function later (SF11).

**Edit** `rules/security.test.ts` — a `describe("billing")`: only an org admin reads
`billing/{ws}`; no client can write it; a scoped-role write is rejected when the (seeded)
billing doc lacks `scopedRoles` and allowed when it has it; absent doc ⇒ Free.

**Edit** client

- An entitlement hook reading `billing/{workspaceId}` (absent ⇒ Free).
- Turn the account-menu **"Billing & payment"** stub (`AccountMenu.tsx:92`, currently `soon`)
  into the real screen: current tier, usage vs. quota, upgrade/manage → Stripe portal.
- **Upsell** affordance on gated controls (CollaboratorsDialog role picker, etc.) instead of
  silently hiding them.
- **i18n** — every new string into **all six** dictionaries (`Dict` is exact; a missing key
  is a compile error).

**Mexico specifics (launch):** Stripe Tax computes IVA (16%), charges in MXN, origin inferred
from card country. **No invoicing built** (PL10-a).

> ⚠️ **This phase's rules changes must be deployed with `firebase deploy --only firestore`.**
> The billing gate is only real once the *live* rules read `billing/…`. Client gating is UX,
> not the security boundary. Audit what else a firestore deploy carries.

**Exit:** an org admin can subscribe through Stripe, the tier lands in `billing/{ws}` via
SF3, a gated feature unlocks only on the right tier (enforced in rules), and a self-upgrade
attempt by writing the billing doc is rejected.

---

## Phase 4 — Authoritative logs & reliability tail (L, ongoing)

**Harden-in-place** — each replaces a client interim that already works, so lowest urgency;
sequence by value and shared triggers. Each ships with its rule flip.

- **SF4 — Activity authoring** (authoritative): flip `activity` rules to reject
  `source:'client'`; the function diffs before→after and writes `source:'server'`. Dedupe
  against client drafts by `clientKey` during the overlap.
- **SF2 — Notifications**: server-authored, deduped/batched. Shares the features-write
  trigger with SF4. *Note it's reliability hardening, not a security boundary — shipped
  notifications already allow member-to-member client writes.*
- **SF11 — Quota counters** (only if PL5 needs server-maintained counts).
- **SF5** member profile denorm sync · **SF12** presence GC (scheduled) · **SF13** invite
  lifecycle cleanup (scheduled) · **SF14/SF15** auth lifecycle (user provisioning /
  account-deletion cleanup) · **SF16** activity retention (native TTL preferred) · **SF10**
  email/push transport — **last**.

**Exit:** the log/notification trust path no longer depends on a cooperating client;
scheduled hygiene runs; account deletion leaves nothing behind.

---

## Dependency order

```
            ┌─→ Phase 1 (SF1 denorm) ──┐
Phase 0 ────┤                          ├─→ Phase 4 (SF4/2/11/5/12/13/14/15/16/10)
foundation  └─→ Phase 2 (SF6–9 cleanup)┘
            │
   (PL1–3, Stripe, MX tax — in parallel)
            └─────────────────────────→ Phase 3 (SF3 + rules + UX)  ──→ Phase 4
```

Phase 0 gates everything. Phases 1 and 2 are independent of billing and of each other —
parallelizable across two people. Phase 3 waits on its non-code prerequisites, not on
Phase 1/2. Phase 4 is a long tail that starts once 1–3 have proven the patterns.

## The one judgment call

If **shipping revenue ASAP** is the priority, pull **Phase 3 ahead of Phase 2** (accept the
existing self-heal for cross-user cleanup a while longer). If **correctness/scale hardening**
matters more, or you're not ready to charge, keep 2 before 3. The default above closes the
cross-user gaps first because they're cheap and unblocked while billing's external
prerequisites are still in flight.

## Decisions this plan carries

**Resolved** (baked into the plan): PL6 (Org = Workspace), PL8 (Stripe), PL10 (Mexico),
PL10-a (manual invoicing — no PAC/CFDI/invoicer code).

**Resolve in-phase** (none blocking, but PL1–3 gate Phase 3):

| Decision | Resolve in |
|---|---|
| **PL1/PL2/PL3** — tiers, gated features, quota numbers | **Before Phase 3** (product; prerequisites list) |
| **PL4** — graceful/read-only downgrade | Phase 3, in the rules + client gating |
| **PL5** — collection-count quotas: client-guard v1 | Phase 3 (client), SF11 later if needed |
| **PL7** — transfer moves `workspaceId` | Phase 3, in the transfer flow |
| **PL9** — org role names (`owner/member` vs `admin/member`) | Phase 0/3, in `isOrgAdmin` |
| **PL11** — seat definition (unique users across the org's Pulses) | Phase 3, drives `billing.seats` |

## Risk register

| Risk | Mitigation |
|---|---|
| Plan is a **security boundary** — client gating isn't enough | Enforce entitlements in `firestore.rules`; `billing` doc is `write: false`, Stripe-only (SF3) |
| Billing rules only real once **deployed** | `firebase deploy --only firestore` in Phase 3 (not `--only hosting`); audit the diff |
| Stripe delivers webhooks **at-least-once** | SF3 recomputes from current subscription state; ignore out-of-order by `updatedAt`/event id |
| Cross-user cleanup **can't** be client-side | Ship SF6–9 (Phase 2); until then self-heal is the only cover — a known, bounded gap |
| **Mexico invoicing is manual** | Operational, not code: ensure a finance process files the factura global from Stripe; billing UI must not imply the Stripe receipt is a tax invoice |
| Org drift (Pulse ↔ billing) | Resolve org via `Pulse.workspaceId` only; never a separate `billingOrgId` |
| Denorm/log flips introducing loops | Skip-own-writes + denorm-only guard from Phase 0; before/after diffs |
| Account deletion orphaning data | SF15 (Phase 4); until then, deletion is rare and manually recoverable |
