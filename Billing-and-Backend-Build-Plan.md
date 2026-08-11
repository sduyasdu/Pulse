# Pulse — Billing & Backend Functions Build Plan

Companion to **`Plans-Spec.md`**, **`Server-Functions-Spec.md`**, and
**`Backend-Architecture-Spec.md`** (what to build and why). This is the **how**, in order,
against the codebase. *Written at `8fed153`; status blocks below refreshed at `9c9d838`.*

**Framing — one program, not two builds.** The Plans/Billing spec is *delivered through*
backend functions (SF3 + rules + client UX), so it shares the Functions foundation with the
hardening functions. Sequence everything by dependency and risk on one timeline.

**Original baseline (historical):** Pulse was **100% serverless** — a React client talking
straight to Firestore, with no Cloud Functions at all. Phase 0 stood the runtime up; nothing
server-side could precede it.

**Where it actually stands now — Phases 0, 1, 2 and most of 3 are done and deployed.**
`functions/` exists and ten functions run in `us-central1`: `ping`; SF1
(`onFeatureWriteDenorm`, `onResourceWriteFanout`); the SF6–SF9 cascades (`onPulseDelete`,
`onMemberRemoved`, `onResourceDelete`, `onEpicDelete`); and SF3 (`stripeWebhook`,
`createCheckoutSession`, `createPortalSession`). See the Phase 3 status block below for
what remains.

Sizes are rough calibration, not commitments: **S** ≈ half a day, **M** ≈ 1–2 days,
**L** ≈ 3–4 days, **XL** ≈ a week+.

---

## Custom domain — `pulse.yasdu.com` (decided 2026-08-10)

Console and DNS work, not engineering. **The code side is already done and deployed** — the
Checkout/Portal return-URL allowlist in `functions/src/billing.ts` pre-authorises the origin,
so the cutover needs no release.

1. **Firebase Console → Hosting → `pulse-b9d96` → Add custom domain** → `pulse.yasdu.com`.
   Add the TXT/A (or CNAME) records it gives you — **use the console's values**, not any
   published IP list, which goes stale.
2. **DNS on `yasdu.com`** — add those records for the `pulse` subdomain. Verification is
   minutes; SSL provisioning can take **up to ~24h**, during which the domain may serve a
   certificate warning. Don't announce the URL until Hosting shows *Connected* with a clean
   padlock.
3. **Firebase Console → Authentication → Settings → Authorized domains** → add
   `pulse.yasdu.com`. ⚠️ **Miss this and Google sign-in breaks on the new domain**
   (`auth/unauthorized-domain`). Email/password keeps working, so a quick smoke test won't
   catch it.
4. **Leave `VITE_FIREBASE_AUTH_DOMAIN` as `pulse-b9d96.firebaseapp.com`.** That's the OAuth
   handler domain, not the app URL; repointing it needs extra setup and buys nothing. No
   Google Cloud OAuth client changes are needed — the handler URL is unchanged.
5. **After it resolves:** switch `DEFAULT_RETURN_ORIGIN` in `functions/src/billing.ts` from the
   Firebase URL to `https://pulse.yasdu.com` and redeploy the two callables. It is deliberately
   still the Firebase URL, because a fallback pointing at a hostname that doesn't resolve turns
   a recoverable redirect into a dead end.
6. **Then** publish the URL on the Yasdu site — see `Yasdu-Site-Pulse-Listing-Spec.md` §3.5.

**Both Firebase domains keep serving the app.** Two consequences to expect rather than debug:
existing sessions **do not carry over** (Firebase Auth state is per-origin, so everyone signs
in again on the new domain), and Firebase Hosting cannot host-conditionally redirect
`.web.app` → the custom domain from `firebase.json`, so retiring the old URL needs a
client-side redirect or simply letting it fall out of use.

---

## Start now — non-code prerequisites with real lead time

These gate the billing phases and are **not** engineering tasks. Kick them off on day 0, in
parallel with Phase 0–2, so Phase 3 isn't blocked when it's ready.

- **PL1–PL3 — DONE.** Tiers/prices/quotas are decided (Plans-Spec §2/§3): Starter/Pro/Business,
  $0/$6/$12 per **editor seat**/mo (USD), quota-only (no feature gating). Encoded in
  `entitlements.ts`.
- **Stripe account** — *mostly done.* The two per-seat products ("Pulse Pro" $6, "Pulse
  Business" $12) exist **with `tier` metadata** (which is how SF3 and the Checkout callable
  both resolve a tier), and `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are in Secret
  Manager and bound to the deployed functions. **Still open:** point the webhook endpoint at
  the deployed URL (it was created with a placeholder), save the **Customer Portal**
  configuration once, and confirm **Stripe Tax** is active. Full checklist: Plans-Spec §9.6.
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

The **hard security boundary**. The plan must never be client-writable. Gated on Phase 0
and the Stripe account (PL1–3 are now **decided**, §2/§3). Billing is keyed by
**Organization = Workspace** (`orgId === workspaceId`, PL6). The model is **quota-only** —
no feature gating; tiers differ by editor seats / Pulses / collaborators / resources.

**Already shipped (Phase 3 groundwork, committed):** `Workspace.country`/`stripeCustomerId`/
`stripeSubscriptionId`; `PlanTier`/`BillingDoc`/`Entitlements` types; `domain/entitlements.ts`
(`TIER_ENTITLEMENTS`, `tierOf`, `entitlementsFor`, `editorSeatLimit`, unit-tested);
`services/firestore/billing.ts` (read-only); the `billing/{orgId}` **read** rule (owner-only)
+ `write:false` and its rules tests.

**✅ DONE and deployed — `functions/src/billing.ts`**
- **SF3 — Stripe webhook** (`stripeWebhook`, `onRequest`): signature-verified over the raw
  body, then **recomputes** `billing/{workspaceId}` from the subscription refetched from
  Stripe, so at-least-once and out-of-order deliveries converge. Duplicate `event.id` is a
  no-op; a strictly older `event.created` is dropped. Org resolved subscription-metadata →
  Customer-metadata → reverse lookup on `stripeCustomerId`.
- **PL4 downgrade (§5.1)** runs on a flip *off the seats*: demotes every editor/owner except
  `workspace.ownerId` to full viewer and collapses `editorUids` to `[ownerId]`. `past_due`
  rides dunning instead, with a **15-day** client-side grace window
  (`DELINQUENCY_GRACE_DAYS`) clocked from `pastDueSince`, stamped on the first failed charge.
- **Checkout + Portal callables** (`createCheckoutSession`, `createPortalSession`): hosted
  Stripe URLs only, owner-asserted, return URL matched against an origin allowlist. Neither
  writes the billing doc — the webhook stays the single writer. Stripe Tax is enabled for
  MX IVA.
- **Client:** `PlanBanner` (dismissible delinquency notice on the Dashboard) and
  `BillingDialog` (the real "Billing & payment" screen — tier, seats, quotas, renewal,
  upgrade/manage). Timestamps are plain epoch millis, matching `type Timestamp = number`.

> **Two Stripe-console steps are still required before a live purchase works:** save the
> **Customer Portal** configuration once, and confirm **Stripe Tax** is active (the callables
> fail with messages naming each). The webhook endpoint URL is
> `https://us-central1-pulse-b9d96.cloudfunctions.net/stripeWebhook`.

**What remains in Phase 3:**

**New** `functions/src/counters.ts` — **SF11** (quota counters, PL5 Option b). Maintain, on the
relevant create/delete/role-change writes, `workspace.pulseCount`, `workspace.collaboratorUids[]`,
and `pulse.resourceCount`, so the rules can gate growth against them (§5). Server-maintained only;
idempotent. (Editor seats are **not** counted here — they're the rules-native `editorUids` array,
PL9.)

**Edit** `firestore.rules` — add the **quota/licensing enforcement** gates (the read rule
already ships):
- **Editor roster (PL9, rules-native):** `Workspace.editorUids[]` writable only by the org
  owner, `.size() ≤ editorSeatLimit` (`get billing/{ws}`), owner always included — synchronous,
  race-free.
- **Pulse owner/editor**: allowed only when the target uid ∈ that org's `editorUids`.
- **Create-Pulse**: only a licensed editor of `pulse.workspaceId`, under `maxPulses`.
- **Add collaborator / resource**: under `maxCollaborators` / `maxResourcesPerPulse`.
- Count gates use **SF11 counters** (`workspace.pulseCount`, `collaboratorUids[]`,
  `pulse.resourceCount`) via `get()` (PL5 Option b). Editor seats are the `editorUids` array,
  not a counter. **No feature flags.**

**Edit** `rules/security.test.ts` — extend `describe("billing")` with the quota gates
(create-Pulse editor-only + cap, editor-seat cap, collaborator/resource caps; absent ⇒ Starter).

**Edit** client
- Consume `entitlementsFor(billing)` (already built) to soft-gate growth with an **upsell**
  ("You've hit your plan's limit — upgrade"). Collaborators don't see **New Pulse**.
- **PL4 read-only lock (§5.1):** on Starter, derive which Pulses are over the limit (non-archived,
  ordered by `createdAt`, newest beyond `maxPulses`) and render them **read-only** with an
  "archive another Pulse to edit this" affordance. Client-derived (rules can't sort/count).
- **Members & seats screen (PL9):** a new org-admin surface to manage `Workspace.editorUids[]`
  — add/remove licensed editors, showing seats used / purchased and a link to buy more (Stripe
  portal). This is net-new (today there's only per-Pulse Collaborators).
- **Dashboard grouped by Organization** (Plans-Spec §3.3): "Your Pulses" (orgs you edit) and
  "Shared with you" (orgs you collaborate in), grouped per org. When an editor belongs to
  **>1** org, **New Pulse prompts which org** (or derives it from the org section it was
  invoked in).
- ~~Turn the account-menu **"Billing & payment"** stub into the real screen.~~ **DONE** —
  `BillingDialog.tsx`, opened from `AccountMenu.tsx:94`; the `soon` flag is gone. Shows tier,
  seats, quota *limits*, renewal and delinquency. Usage-vs-limit still needs SF11 counts.
- **i18n** — every new string into **all six** dictionaries (`Dict` is exact).

**Mexico specifics (launch):** Stripe Tax computes IVA (16%, **VAT-inclusive**), charges in
**USD**, origin inferred from card country. **No invoicing built** (PL10-a).

> ⚠️ **This phase's rules changes must be deployed with `firebase deploy --only firestore`.**
> The gates are only real once the *live* rules enforce them. Client gating is UX, not the
> security boundary. The billing *read* rule already shipped (groundwork) but is **not yet
> deployed** — it goes out with this phase's firestore deploy.

**Exit:** an org admin subscribes through Stripe, the tier lands in `billing/{ws}` via SF3,
a growth action is blocked at the quota (enforced in rules) with an upsell, the dashboard
groups by org and prompts for the org on New Pulse, and a self-upgrade write is rejected.

*Progress against that exit:* the subscribe path and the SF3 write are **done**; the
self-upgrade write is **already rejected** (`billing/{orgId}` is `write: if false`). Still
open: quota blocking **enforced in rules** (needs SF11 + the gates), the org-grouped
dashboard, and the Members & seats screen. Quotas today are advisory — the UI shows the
right limits, but nothing server-side stops an org exceeding them.

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
- **SF11 — Quota counters** (moved up to **Phase 3** — PL5 chose maintained counters).
- **SF5** member profile denorm sync · **SF12** presence GC (scheduled) · **SF13** invite
  lifecycle cleanup (scheduled) · **SF14/SF15** auth lifecycle (user provisioning /
  account-deletion cleanup) · **SF16** activity retention (native TTL preferred) · **SF10**
  email/push transport — **last**.

**Exit:** the log/notification trust path no longer depends on a cooperating client;
scheduled hygiene runs; account deletion leaves nothing behind.

---

## Dependency order

```
            ┌─→ Phase 1 (SF1 denorm) ✅ ┐
Phase 0 ✅ ─┤                           ├─→ Phase 4 (SF4/2/11/5/12/13/14/15/16/10)
foundation  └─→ Phase 2 (SF6–9 cleanup)✅┘
            │
   (PL1–3 ✅, Stripe ~, MX tax — in parallel)
            └──────────────────────────→ Phase 3 (SF3 ✅ + rules ⬜ + UX ~) ──→ Phase 4
```

✅ done & deployed · ~ partly done · ⬜ not started. **The critical remaining item is the
rules half of Phase 3** — SF11 counters plus the quota/licensing gates. Without them the
plan is sold and displayed correctly but not *enforced*, which is the difference between a
commercial limit and a real one.

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

**All PL1–PL11 are resolved** (Plans-Spec §8):
- PL1 tiers/prices, PL2 no feature gating, PL3 quotas — quota-only model.
- PL4 downgrade (§5.1); PL5 SF11 counters (pulses/collaborators/resources); PL6 Org=Workspace.
- PL7 no cross-org transfer; PL8 Stripe; PL9 explicit editor roster (`editorUids[]`, option B).
- PL10/10-a Mexico + manual invoicing; PL11 a seat = a licensed editor.

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
