# Pulse — Backend Architecture Spec

Status: **Proposal — architecture + full server-function registry** · Owner: eng ·
Supersedes/expands: `Server-Functions-Spec.md` (SF1–SF4 carried forward verbatim in intent).
Related: `Permissions-Spec.md`, `Plans-Spec.md`, `Collaboration-Spec.md`, `Changelog-Spec.md`,
`Undo-Spec.md`, `firestore.rules`, `firestore.indexes.json`.

> **Relationship to `Server-Functions-Spec.md`.** That doc is the existing, deliberately
> minimal registry of the four "server-delayed" decisions the other specs made (SF1–SF4).
> This document is the **complete backend design**: it adopts SF1–SF4 unchanged (same IDs,
> same intent), then identifies **every additional server function the shipped code and the
> specs imply**, and wraps them in a coherent platform/convention/sequencing story. Where
> the two disagree, the SF1–SF4 *entries* in `Server-Functions-Spec.md §3` remain the
> normative per-function text for those four; this doc references them rather than rewriting
> them. New functions (SF5+) are normative here.

---

## A. Architecture overview

### A.1 Where we are today (the baseline every decision starts from)

Pulse is **fully serverless**: a React 19 + Vite client talks directly to Firestore
(+ Firebase Auth + Hosting), project `pulse-b9d96`. There is **no `functions/` directory and
no Cloud Functions**. Firestore security rules (`firestore.rules`) are the *only* server-side
trust boundary. Every capability that "should" be server work is currently done by the client
as an interim, and the codebase is honest about it (`// self-heal`, `// interim`,
`// Server-Functions-Spec SF#`). The concrete client-side "server work" inventory:

| Area | Client code doing server work | Failure posture today |
|---|---|---|
| Feature permission denorms (`assignedUids`/`leadUid`) | `pulseStore.reconcileDenorms` (`pulseStore.ts:95`) + `domain/denorm.ts` | **Fail-closed** (stale ⇒ fewer tasks visible) |
| Activity log authoring | `domain/activityRecorder.ts`, `services/firestore/activity.ts` | **Fail-open** (dropped entry) |
| Notifications authoring | `components/comments/notify.ts` → `services/firestore/notifications.ts` (path `pulses/{p}/notifications`) | Fail-open (missed ping) |
| Pulse cascade delete | `pulses.deletePulse` (`pulses.ts:213`) — deletes `invites/epics/features/resources`, pulse doc, `pulseMembers`, own `myPulses` | Leaves `activity/comments/notifications/presence/joinLinks` orphaned; other members' `myPulses` go stale |
| Resource-delete integrity | `pulseStore.removeResource` strips the id from every feature | Only runs on the deleting editor's client, with full roster in memory |
| Epic-delete integrity | `pulseStore.removeEpic` clears `epicId` on orphans | Same |
| Member profile denorm | `PulsePage.tsx:121` `syncMyMemberPhoto` (own `photoURL`, only for the open Pulse) | Stale/missing on other Pulses; `displayName` never denormed |
| `myPulses` self-heal | `DashboardPage.tsx:31`, `PulsePage.tsx:145`, `pulses.removeMyPulseEntry/updateMyPulseRole` | Only the *affected* user's own client can fix their index |
| Presence GC | `PresenceBar.tsx` client-side stale filter (`STALE_MS=45_000`) + `clearPresence` on unload | Dead tab ⇒ stale doc lingers forever |
| User provisioning | `authStore.bootstrap` → `users.ensureUserDoc` (creates `users/{uid}` + personal workspace) | Runs only if the client cooperates on first sign-in |
| Account deletion cleanup | **nothing** (`users` delete rule = `false`) | Orphaned data on account deletion |
| Billing / plan | **nothing** — account-menu "Billing & payment" is a stub (`AccountMenu.tsx:92`) | Everyone is Free; no paid tier exists |
| Invite resolution (legacy) | `users.resolvePendingInvites` (being retired, Collaboration-Spec §3.1) | Client-run on each sign-in |

The load-bearing invariant (`firestore.rules:1-25`, Collaboration-Spec §1.6): **a client can
never write another user's index/inbox**, and **there are no collection-group `list` queries**
(the emulator rejects them the instant a rule references `request.auth`). This is *exactly* why
some work is server-mandatory: reaching *another* user's `myPulses`/`notifications` to clean up
is impossible from any client, and possible only from the Admin SDK.

### A.2 Platform & runtime

- **Firebase Cloud Functions, 2nd gen, TypeScript**, deployed into the same `pulse-b9d96`
  project. New top-level `functions/` package (its own `package.json`, `tsconfig`, `firebase.json`
  `"functions"` block). `firebase-admin` (Admin SDK) — **bypasses security rules**, which is the
  whole point: it can write the server-authoritative fields and reach cross-user docs.
- **Trigger types used** (pick the narrowest per function):
  - Firestore: `onDocumentWritten` (created|updated|deleted), `onDocumentCreated`,
    `onDocumentDeleted`, on concrete paths under `pulses/{pulseId}/...`.
  - HTTPS `onRequest` (webhooks — payment provider) and `onCall` (authenticated client RPC where
    a transaction/secret is needed).
  - Scheduled `onSchedule` (pub/sub cron) — presence GC, expiry sweeps, retention fallback.
  - Auth blocking `beforeUserCreated` (provisioning) and the Identity-Platform/Auth
    `onUserDeleted`-style lifecycle (account teardown). *(2nd-gen exposes user lifecycle via
    blocking functions + an Auth event; see D-list for the exact API choice.)*
- **Region:** pin **all** functions and the Firestore trigger region to the **Firestore database
  location's region** (single region; co-locate to avoid cross-region latency/egress). Decide the
  concrete region in §D (default recommendation: whatever `pulse-b9d96`'s Firestore is in;
  `us-central1` if greenfield). Never leave a function on a different default region than the DB.
- **Min instances:** default 0 (cost). Set `minInstances: 1` only on the **billing webhook**
  (SF3) so a cold start never makes a provider retry a signature-verified event, and consider it
  for SF1 if denorm latency becomes user-visible. Everything else tolerates cold starts (they are
  write-triggered background work, not on a human's read path).

### A.3 Cross-cutting conventions (mandatory for every function)

1. **Idempotency (at-least-once delivery).** Firestore delivers events at-least-once. Every
   function must be safe to run twice on the same event. Two techniques, per
   `Server-Functions-Spec.md §1`:
   - **Recompute-from-source and write the result — never increment.** (SF1, SF5, SF8, SF9.)
   - **Deterministic doc ids** derived from the event (event id, or a hash of
     `pulseId+entityId+verb+beforeUpdateTime`) so re-delivery overwrites rather than duplicates.
     (SF4 activity, SF2 notifications.)
   - Counters that *must* aggregate (SF11 quotas) use a Firestore **transaction** that
     recomputes from the collection or reconciles against a processed-event marker, never a blind
     `FieldValue.increment` on a raw event.
2. **Loop avoidance / write authority.** A function that writes docs of a type it also triggers on
   **must skip its own writes and denorm-only writes**:
   - Compare `event.data.before` vs `after`; if the only changed keys are the fields this function
     owns, return. (SF1's rule: skip a features write whose `affectedKeys() ⊆ {assignedUids, leadUid}`;
     SF4 reproduces this exact exclusion — Changelog-Spec §4.4.)
   - A function **owns** the fields it writes. Once it ships it is the authoritative maintainer;
     the client either stops writing that field or writes it only as an **optimistic hint the
     function overwrites** (decided per function at build time — see SF1's migration note).
3. **Fail-closed vs fail-open — decided per function, driven by the security model:**
   - **Hard security boundary → server is the *only* writer, no client interim exists**
     (SF3 billing). A wrong value would *grant* access/entitlement.
   - **Fail-closed hardening → a stale value denies, never leaks** (SF1 denorms: a My-Beat Viewer
     sees *fewer* tasks; SF11 quota counters block at the limit). A client interim is acceptable
     because it can only under-grant.
   - **Fail-open trust/completeness → a dropped write loses information but gates nothing**
     (SF4 activity, SF2 notifications, SF12 presence GC). A client interim is acceptable and the
     server upgrade is about *completeness/reliability*, not access.
4. **Batching & transactions.** Fan-out writes (SF1 `linkedUid` change, SF8 resource delete, SF6
   cascade) read the affected set once and commit in chunked batches (**≤ 450 writes/batch**, the
   limit `pulses.deleteInChunks` already respects, `pulses.ts:231`). Cross-doc invariants (SF11
   counters) use transactions.
5. **Cost / hot-path avoidance.** These are **low-frequency, write-triggered** functions
   (`Server-Functions-Spec.md §1`). Never put a function on a read/subscribe path. The activity
   log's own volume control is upstream (one entry per settled gesture, Changelog-Spec §7.1), so
   SF4 inherits low volume. Scheduled sweeps run infrequently (presence GC every 1–2 min; expiry
   sweeps hourly/daily).
6. **Structured logging & observability.** Log one structured line per invocation with
   `{ fn, eventId, pulseId, entityId, action, skipped?, writes }`. Alert on error-rate and on the
   billing webhook's signature-verification failures. Use Cloud Functions' built-in retry (set
   `retry: true` only where at-least-once + idempotency make retries safe — SF3, SF7, SF15; leave
   `retry: false` where a poison event could loop, and dead-letter instead).
7. **Local dev & testing.** Extend the existing emulator setup (`firebase.json` already runs Auth
   + Firestore emulators; README documents `npm run emulators`). Add the **Functions emulator**;
   keep the existing rules-test harness (`vitest.rules.config.ts`, `npm run test:rules`) and add
   function unit tests (pure diff/denorm logic extracted so it's testable without the emulator —
   mirror `domain/denorm.ts`, which is already pure and unit-testable). Reuse `domain/denorm.ts`
   and `domain/activityRecorder.ts` diff logic **verbatim in the functions package** where
   possible so client interim and server authority can't drift.
8. **Deployment & rollout (interim → server flip).** Each function ships behind the pattern the
   specs already use: (1) client interim runs; (2) deploy the function so it runs in parallel and
   **reconciles** (client writes optimistic, server overwrites); (3) once proven, **flip the rule**
   that rejects the now-redundant client write (SF4: `create: source=='server'` only; SF3: already
   `write:false`). Rollback = stop the rule flip / disable the function; the client interim resumes.
9. **No breaking data migrations.** Every function is additive; historical backfill is opt-in and
   idempotent (SF1 backfills denorms by recompute; SF4 explicitly does *no* historical backfill —
   the log starts when it starts, Changelog-Spec §8).

### A.4 Security boundary — what becomes server-authoritative, and why

| Field / collection | Classification | Owner once shipped | Rule change on ship |
|---|---|---|---|
| `billing/{uid}` (tier/status/period/seats) | **Hard security boundary** | **SF3 only** (Admin SDK) | Already `write: if false`; rules `get()` it to gate — no change needed (Plans-Spec §4) |
| Quota counters (e.g. `pulses`/member counts) | Fail-closed hardening | SF11 | Optional: rules read a stored counter for cheap quota gates (Plans-Spec §5, PL5) |
| `Feature.assignedUids` / `leadUid` | Fail-closed hardening | SF1 (client optimistic hint until flip) | None required — rules already read them (`firestore.rules:227,236`); optionally later reject client writes of these keys |
| `pulses/{p}/activity/*` | Trust / completeness | SF4 | Flip `create` to `source=='server'` only (`firestore.rules:267-269`) |
| `pulses/{p}/notifications/*` | Reliability (not a boundary — see note) | SF2 | Optionally tighten `create` to server-only once SF2 ships |
| `PulseMember.photoURL` / `displayName` denorm | Cosmetic hardening | SF5 | None (self-write of `photoURL` already allowed) |
| Cross-user cleanup (`myPulses`, `notifications`, `presence` of *other* users) | **Server-mandatory by construction** | SF6/SF7/SF15 | None — the Admin SDK is the *only* actor that can reach another user's self-owned docs |

**Note on notifications:** the *shipped* model is `pulses/{pulseId}/notifications/*` with
member-to-member **client** writes permitted by rules (`firestore.rules:198-207`: create allowed
for a member, `actorUid` pinned to self, `targetUid` must be a member). This differs from
Collaboration-Spec §3.6/D6's envisioned self-owned `users/{uid}/notifications` (which *would* be
server-mandatory). Because today's notifications live inside the Pulse the actor can already
write, SF2 is **reliability/dedupe/batching/transport hardening, not a security boundary** — the
same posture as SF4. If notifications ever move to the self-owned per-user path, they become
server-mandatory (like SF7's cross-user cleanup). Called out so SF2's scope isn't overstated.

---

## B. The server-function registry

### B.1 Registry table

Pre-existing (carried from `Server-Functions-Spec.md`) marked ★. Everything else is newly
identified here.

| ID | Function | Owns / does | Trigger | Class | Priority |
|---|---|---|---|---|---|
| **SF1** ★ | Feature denormalization maintainer | `Feature.assignedUids`, `leadUid` (+ `linkedUid` fan-out) | `onWritten` features, resources | Fail-closed hardening | **High** |
| **SF2** ★ | Notification authoring | dedupe/batch `notifications/*` (+ transport handoff to SF10) | `onWritten` features (assign/status), `onCreated` comments | Reliability | Medium |
| **SF3** ★ | Billing / plan sync | `billing/{uid}` — the **only** writer | HTTPS webhook (payment provider) | **Hard security boundary** | **High (at monetization)** |
| **SF4** ★ | Activity-log authoring (authoritative) | `pulses/{p}/activity/*` server-written | `onWritten` features/epics/resources/pulseMembers/pulse | Trust/completeness | Medium |
| **SF5** | Member profile denorm sync | `PulseMember.photoURL`/`displayName` across all a user's Pulses (+ linked `Resource` display) | `onWritten` `users/{uid}` | Cosmetic hardening | Low |
| **SF6** | Pulse cascade delete | purge **all** subcollections + every member's `myPulses` | `onDeleted` `pulses/{p}` | Integrity (cross-user) | High |
| **SF7** | Membership removal cascade | on member remove/leave: clean their `notifications`, `presence`, unlink `Resource.linkedUid`, drop their `myPulses` | `onDeleted` `pulseMembers/{uid}` | Integrity (cross-user) | High |
| **SF8** | Resource-delete integrity | strip a deleted resource id from every feature's `resources`/`children`/`alloc`/`lead` | `onDeleted` `resources/{r}` | Fail-closed hardening | Medium |
| **SF9** | Epic-delete integrity | clear/re-parent `epicId` on orphaned features | `onDeleted` `epics/{e}` | Hardening | Medium |
| **SF10** | Notification transport | email/push delivery of `notifications/*` | `onCreated` `notifications/*` | Delivery | Low (needs provider) |
| **SF11** | Entitlement / quota counters | maintained collection counts + seat counts for rule-cheap quota gates | `onWritten` pulses/pulseMembers/resources | Fail-closed hardening | Medium (with SF3) |
| **SF12** | Presence GC | delete stale `presence/*` heartbeats | `onSchedule` (~1–2 min) | Cost/hygiene | Low |
| **SF13** | Join-link / invite lifecycle cleanup | delete expired/disabled `joinLinks`; retire `inviteIndex`/`invites` | `onSchedule` (daily) + one-shot | Hygiene | Low |
| **SF14** | User provisioning | create `users/{uid}` + personal workspace on account creation | Auth `beforeUserCreated` | Reliability | Medium |
| **SF15** | Account deletion cleanup | tear down a deleted user's owned Pulses, memberships, indexes, billing, workspace | Auth user-deleted lifecycle | Compliance/integrity | Medium |
| **SF16** | Activity retention (fallback sweeper) | prune `activity/*` past plan retention **if** native TTL is insufficient | `onSchedule` (daily) | Hygiene | Low (prefer native TTL) |

**Deliberately excluded (with justification):**

- **Dashboard / capacity aggregation function.** The Capacity tab (`CapacityTab.tsx`,
  `domain/assignments.ts`) and dashboard summaries (`usePulseSummary.ts`) compute over a single
  Pulse's already-subscribed, bounded data (features/resources) on the client. Moving them
  server-side adds cost and a read-path function for no security or correctness gain. **Excluded**;
  revisit only if a cross-Pulse/workspace rollup (Changelog CL10) is ever built.
- **Search index (e.g. Algolia/Typesense sync).** No full-text search feature exists or is
  specced. **Excluded** until a search feature is on the roadmap.
- **`myPulses` write-through on grant/rename.** Tempting to have a function keep every member's
  `myPulses` label live, but the self-heal pattern (Collaboration-Spec §1.6) already covers it
  fail-closed and is a *load-bearing invariant* the specs want preserved. The only cross-user
  `myPulses` writes we add are **deletions** on teardown (SF6/SF7/SF15), where self-heal is
  strictly worse (a card pointing at a deleted Pulse). **Excluded** for the update case; included
  only for the delete case.
- **Undo/redo server history.** Explicit non-goal (Undo-Spec §10, Collaboration-Spec §3.4): undo
  stays single-user, in-memory, client-only. **Excluded.**
- **Email-invite delivery function.** Invites went link-only and serverless (Collaboration-Spec
  §3.1/D1); nothing delivers email. **Excluded** (SF10 is the only place email re-enters, and
  only for notifications, deferred).

### B.2 Per-function detail

Format mirrors `Server-Functions-Spec.md §3`: *Owns · Why server-side · Trigger · Current interim
(fail open/closed) · Idempotency · Rules interaction · Dependencies/ordering · Acceptance.*

---

#### SF1 — Feature denormalization maintainer ★ (carried from Server-Functions-Spec §3)

Adopted **unchanged**; see `Server-Functions-Spec.md §3 SF1` for the normative text. Summary for
this doc's completeness:

- **Owns:** `Feature.assignedUids: string[]` and `Feature.leadUid: string|null`, derived from each
  assigned/subtask-assigned `Resource.linkedUid` and from `feature.lead` (algorithm =
  `domain/denorm.ts:featureDenorm`, which the function should reuse verbatim).
- **Trigger:** `onDocumentWritten` on `features/{f}` (recompute self) and `resources/{r}`
  (on `linkedUid` change, **fan out** to every feature referencing `r` directly, via a subtask,
  or as `lead`).
- **Interim (fail-closed):** `pulseStore.reconcileDenorms` (`pulseStore.ts:95-106`) recomputes and
  writes drifted features; runs only for a full editor. Stale ⇒ a My-Beat Viewer sees *fewer*
  tasks — never a leak (Permissions-Spec §4.7).
- **Idempotency:** recompute-from-source; write only when computed ≠ stored (`denormMatches`).
- **Loop avoidance:** skip a features write whose changed keys ⊆ `{assignedUids, leadUid}`.
- **Rules interaction:** rules **already** read these (`firestore.rules:227,236`). On ship, keep
  the client optimistic write (SF1 reconciles) **or** flip to reject client writes of these two
  keys — decided at build time; recommendation: keep client-optimistic for latency, SF1 as the
  authority that heals partial fan-outs.
- **Dependencies:** SF4 must exclude SF1's denorm-only writes from the activity log (already
  specified, Changelog-Spec §4.4). SF8 (resource delete) and SF1 overlap on `linkedUid`/roster
  changes — SF1 recomputes `assignedUids`; SF8 strips the raw id. They compose (both must run);
  order-independent because each is recompute-from-source and idempotent.
- **Acceptance:** for any feature, denorms equal `featureDenorm` output within one invocation of
  any assignment/lead/`linkedUid` change; an unlinked resource is removed from every affected
  `assignedUids`.

---

#### SF2 — Notification authoring ★ (expanded from Server-Functions-Spec §3)

- **Owns:** authoritative, de-duplicated authoring of `pulses/{pulseId}/notifications/*`.
- **What it does (target):** react to the triggering write and author one notification per
  intended recipient, de-duplicated and batched (e.g. collapse "assigned + status change" bursts;
  suppress a self-notification). Recipients per Collaboration-Spec §3.6 / the shipped
  `notify.ts`: comment-thread participants (shipped), plus **assignment** (a feature's
  `resources`/`lead` change ⇒ notify the linked account, keyed off `Resource.linkedUid` — the
  currently-unused "read side" of the link, Collaboration-Spec §1.9/D10) and **status-change /
  role-change / removed** (Collaboration-Spec §5 type set). Only the "comment" type ships today
  (`Notification.type: "comment"`, `types/index.ts:203`).
- **Why server-side:** reliability, dedupe, batching, and email/push (SF10) — *not* a security
  boundary, because the shipped notifications collection is a member-writable Pulse subcollection
  (§A.4 note). A function removes the client from the "did the author's browser stay open long
  enough to write all N notifications" path.
- **Trigger:** `onDocumentWritten` features (assignment/status), `onDocumentCreated` comments.
  **Shares SF4's features/comments trigger surface** — if SF2 and SF4 ship together, register one
  features trigger and fan out to both (Server-Functions-Spec §3 SF2/SF4, Changelog-Spec §4.3).
- **Interim (fail-open):** `components/comments/notify.ts` → `createNotification`
  (`notifications.ts:20`) authors comment notifications client-side; a dropped write is a missed
  ping. Assignment/status/role notifications are **not authored at all today** — SF2 adds them.
- **Idempotency:** deterministic id from `(pulseId, sourceEventId, targetUid)` so re-delivery
  overwrites; a notification already marked `read` by the recipient must not be resurrected (skip
  if a doc with the deterministic id already exists and is read).
- **Rules interaction:** optionally tighten `notifications` `create` to server-only once SF2 is
  authoritative; not required.
- **Dependencies:** SF10 (transport) consumes SF2's output. Keys off SF1's `linkedUid`-derived
  target resolution.
- **Acceptance:** each assignment/mention/status/role event yields exactly one notification per
  distinct valid recipient within one invocation; no self-notifications; re-delivery never
  duplicates.

---

#### SF3 — Billing / plan sync ★ (carried from Server-Functions-Spec §3)

Adopted **unchanged**; normative text in `Server-Functions-Spec.md §3 SF3` and `Plans-Spec.md
§4–§5, §8 PL8`. Summary:

- **Owns:** `billing/{orgId} = { tier, status, currentPeriodEnd, seats?, source, updatedAt,
  stripeCustomerId, stripeSubscriptionId, country, currency }`, the **only** writer. Keyed by
  **Organization**, and **`orgId === workspaceId`** (Plans-Spec §1, PL6) — a Pulse's org is its
  `workspaceId`, which selects whose billing doc gates the Pulse.
- **Why server-side (mandatory):** the plan is a **hard security boundary** — a client-writable
  plan lets anyone self-upgrade to Pro. **No client interim for *writing* the plan exists**; until
  SF3 ships, absent doc ⇒ Free (Plans-Spec §4), i.e. paid tiers don't exist and the account-menu
  entry stays a stub (`AccountMenu.tsx:92`).
- **Trigger:** HTTPS webhook (`onRequest`) **Stripe** (PL8 — decided) calls on subscription
  create/update/cancel/renew (and tax/invoice events, Plans-Spec §9). **Verify the Stripe
  signature**, map to `{ tier, status, currentPeriodEnd }`, write via Admin SDK; resolve the org
  from the Stripe Customer (`Workspace.stripeCustomerId` ↔ `orgId`).
- **Idempotency:** recompute the doc from the event's *current* subscription state; ignore
  out-of-order/duplicate deliveries by event id / `updatedAt`. `minInstances: 1` so a cold start
  doesn't force a provider retry.
- **Rules interaction:** `billing/{orgId}` is `read: if isOrgAdmin(orgId)` (an `owner` in that
  workspace's `WorkspaceMember`)`; write: if false`; rules `get()` it (bypassing its read rule) to
  gate Pulse actions on `pulse.workspaceId` — the `entitlement ∧ capability` seam
  (Permissions-Spec §6.5, Plans-Spec §5).
- **Dependencies:** SF11 (quota counters) pairs with it; ownership-transfer moving a Pulse's
  `workspaceId` (PL7) must not orphan entitlements.
- **Acceptance:** every provider event lands as the correct `billing/{orgId}` state within one call;
  replays/out-of-order deliveries never regress a newer state; an unsigned/invalid request is
  rejected and logged.

---

#### SF4 — Activity-log authoring (authoritative) ★ (carried from Server-Functions-Spec §3)

Adopted **unchanged**; normative text in `Server-Functions-Spec.md §3 SF4` and `Changelog-Spec.md
§4.3–§4.5, §8`. Summary:

- **Owns:** `pulses/{p}/activity/*` as the **only trusted writer** once shipped; rules flip to
  reject `source:'client'` creates (`firestore.rules:267-269`).
- **Why server-side:** a log a client can omit/mis-summarize/spam is not an audit; server-side
  before→after diffing removes the client from the trust path (Changelog-Spec §4.3).
- **Trigger:** `onDocumentWritten` features/epics/resources/pulseMembers/pulse doc (no comments —
  CL7). Reuse the client's projection logic (`domain/activityRecorder.ts`) server-side for
  summary/deltas/`scopeUids`.
- **Must-skip:** denorm-only reconcile writes (`affectedKeys() ⊆ {assignedUids, leadUid}`), no-ops,
  and SF4's own writes (Changelog-Spec §4.4 — the direct analogue of SF1's loop avoidance).
- **Interim (fail-open):** `activityRecorder.ts` emits client entries at the
  `recordSingle`/`recordMany` boundary; `source:'client'`, immutable via rules. A dropped write
  silently loses one entry — acceptable because the log gates nothing.
- **Idempotency:** deterministic `entryId` from the event; replace a matching `source:'client'`
  draft (`clientKey`) in place during the overlap window.
- **Dependencies:** shares SF2's trigger surface; excludes SF1's denorm writes; retention handled
  by native TTL on `expireAt` (Changelog-Spec §7.2) with **SF16** as the scheduled fallback.
- **Acceptance:** every logged mutation ⇒ exactly one entry within one invocation; denorm-only and
  no-op writes ⇒ none; re-delivery never duplicates.

---

#### SF5 — Member profile denorm sync

- **Owns:** the denormalized copies of a user's profile that other members are allowed to read —
  `PulseMember.photoURL` (and `displayName`, if we add it) on **every** Pulse the user is a member
  of, and (optionally) the display fields shown on a `Resource` linked to that account.
- **Why server-side:** members can't read each other's `users/{uid}` docs (`firestore.rules:95`),
  so the avatar/name must be denormalized onto member-readable docs. Today the client self-syncs
  **only its own `photoURL`, and only for the currently-open Pulse** (`PulsePage.tsx:121`); a user
  who is a member of 20 Pulses but opens one leaves the other 19 stale, and `displayName` is never
  denormed. A function fans a `users/{uid}` profile change out to all the user's `pulseMembers`
  docs (which it can find via the Admin SDK — the client can't, without a collection-group query).
- **Trigger:** `onDocumentWritten` `users/{uid}` when `photoURL`/`displayName` changes. To find the
  user's memberships without a collection-group query on the client, the server either uses a
  collection-group query (Admin SDK is unaffected by the rule limitation — that ban is a client
  read-rule constraint, not a server one) **or** reads the user's `myPulses` index (self-owned,
  server-readable) and updates each `pulseMembers/{uid}`.
- **Interim (fail-open, cosmetic):** self-sync on Pulse open. A stale avatar is a cosmetic glitch,
  gates nothing.
- **Idempotency:** recompute-from-source (copy the current profile values); write only on diff.
- **Rules interaction:** none — `photoURL` self-write is already allowed; the server write bypasses
  rules anyway.
- **Dependencies:** none hard. Complements SF1 (both denorm maintainers).
- **Acceptance:** within one invocation of a profile change, every one of the user's `pulseMembers`
  docs reflects the new `photoURL`/`displayName`.

---

#### SF6 — Pulse cascade delete

- **Owns/does:** on Pulse deletion, **purge every subcollection** and **every member's `myPulses`
  entry**, atomically-enough that no orphan remains readable by path.
- **Why server-side:** two gaps in the client interim (`pulses.deletePulse`, `pulses.ts:213`):
  1. It deletes only `invites/epics/features/resources` + `pulseMembers` + the deleter's *own*
     `myPulses`. It **leaves `activity`, `comments`, `notifications`, `presence`, `joinLinks`
     orphaned** — and while the pulse doc is gone, orphaned subcollection docs can linger (cost,
     and a former path-reader risk if the pulse doc is ever recreated with the same id).
  2. It **cannot** clean *other* members' `myPulses` (a client can't write another user's index) —
     those go stale and rely on each member's dashboard self-heal (Collaboration-Spec §1.8). A
     function can and should clean them via the Admin SDK, so a deleted Pulse leaves *no* stale
     cards anywhere.
- **Trigger:** `onDocumentDeleted` `pulses/{p}`. (Alternatively an `onCall` "deletePulse" that
  does the whole teardown transactionally and then deletes the doc — see D-list; recommendation:
  `onCall` so the client gets a completion signal and the ordering is controlled, with an
  `onDeleted` backstop for direct deletes.)
- **Interim (fail-open on completeness, fail-closed on access):** the client cascade removes access
  (deletes `pulseMembers`, so rules deny) but not all data. Access is safe; completeness isn't.
- **Idempotency:** deletes are naturally idempotent; re-running purges whatever remains. Chunk at
  ≤450/batch (reuse `deleteInChunks`).
- **Rules interaction:** none (Admin SDK). The client keeps its interim delete for responsiveness;
  the function guarantees full teardown.
- **Dependencies:** shares teardown logic with SF15 (account deletion deletes the user's owned
  Pulses). Must enumerate members **before** deleting `pulseMembers` to know whose `myPulses` to
  clean.
- **Acceptance:** after deletion, no doc under `pulses/{p}/**` remains, and no `users/*/myPulses/{p}`
  entry survives, within one invocation.

---

#### SF7 — Membership removal cascade

- **Owns/does:** when a `pulseMembers/{uid}` doc is deleted (owner removes a member, or a member
  leaves — `memberships.removeMember`/`leavePulse`), clean up everything keyed to that member in
  that Pulse: their `notifications` (target or actor), their `presence/{uid}` heartbeat, **unlink**
  any `Resource.linkedUid == uid` (the resource stays; the account link clears), and drop their
  `users/{uid}/myPulses/{p}` entry.
- **Why server-side:** the client interim only covers the *self* case: `leavePulse` deletes the
  member's own `myPulses`; an **owner removing someone else** (`removeMember`, `memberships.ts:37`)
  deletes only the membership doc and **cannot** touch the removed user's `notifications`,
  `presence`, or `myPulses` (all self-owned) — those dangle until that user's own client
  self-heals `myPulses` (and `notifications`/`presence` are never cleaned at all). Only the Admin
  SDK can reach another user's self-owned docs. Unlinking the resource is an editor-write the
  removing owner *could* do, but tying it to the membership-delete event guarantees it.
- **Trigger:** `onDocumentDeleted` `pulseMembers/{uid}`.
- **Interim (fail-closed on access):** removal revokes access immediately (rules deny once the
  member doc is gone); the leftover `notifications`/`presence`/`linkedUid` are stale data, not a
  leak. So the interim is safe; SF7 is cleanup/hygiene + correctness of the resource link.
- **Idempotency:** all deletes/unlinks are recompute-from-absence; re-running is a no-op.
- **Rules interaction:** none (Admin SDK).
- **Dependencies:** SF1 must re-run after SF7 unlinks a resource (unlinking clears `linkedUid`,
  which changes affected features' `assignedUids`/`leadUid`) — SF7 writing the resource triggers
  SF1's resource trigger, so they compose automatically. SF15 (account deletion) reuses this per
  membership.
- **Acceptance:** within one invocation of a membership deletion, the member's `presence`,
  `notifications`, and `myPulses` for that Pulse are gone and any resource linked to them is
  unlinked.

---

#### SF8 — Resource-delete integrity

- **Owns/does:** when a `resources/{r}` doc is deleted, strip `r` from every feature's `resources`,
  each `children[].resources`, the corresponding `alloc` maps, and clear `lead` where
  `lead == r`.
- **Why server-side:** the client interim (`pulseStore.removeResource`, `pulseStore.ts:344-372`)
  does exactly this fan-out, but **only on the deleting editor's client** and only over the
  features currently in memory — a partial/interrupted run leaves a feature pointing at a
  nonexistent resource id. A function guarantees completeness regardless of which client deleted
  the resource. It is the raw-array analogue of SF1 (which recomputes the *derived* `assignedUids`
  but not the source `resources` array).
- **Trigger:** `onDocumentDeleted` `resources/{r}`.
- **Interim (fail-closed-ish):** a dangling resource id renders as an unknown badge; it does not
  grant access. Safe but untidy.
- **Idempotency:** recompute-from-source (filter the id out); write only affected features; batch.
- **Rules interaction:** none (Admin SDK).
- **Dependencies:** triggers SF1 recompute on each touched feature (composes automatically). Runs
  after / alongside SF7's unlink (a removed member's linked resource may then be deleted).
- **Acceptance:** after a resource delete, no feature references the deleted id in `resources`,
  `children[].resources`, `alloc`, or `lead`, within one invocation.

---

#### SF9 — Epic-delete integrity

- **Owns/does:** when an `epics/{e}` doc is deleted, clear `epicId` on every feature where
  `epicId == e` (re-parent to "no epic").
- **Why server-side:** the client interim (`pulseStore.removeEpic`, `pulseStore.ts:215-229`)
  clears `epicId` on orphans from the deleting client only; a partial run leaves features pointing
  at a deleted epic (they'd render unparented but carry a dangling id). Same completeness argument
  as SF8, lower stakes.
- **Trigger:** `onDocumentDeleted` `epics/{e}`.
- **Interim (fail-closed-ish):** dangling `epicId` is cosmetic; gates nothing.
- **Idempotency:** recompute; write only features still pointing at the dead epic.
- **Rules interaction:** none.
- **Dependencies:** independent; groups with SF8 (both are `onDeleted` integrity sweeps and can
  live in one deploy). Does **not** trigger SF1 (epic change doesn't affect the permission denorms).
- **Acceptance:** after an epic delete, no feature has `epicId == e`, within one invocation.

---

#### SF10 — Notification transport (email / push)

- **Owns/does:** deliver a just-authored notification through an out-of-app channel (email and/or
  push), respecting per-user preferences and de-duplication/batching (digest rather than one email
  per event).
- **Why server-side:** email/push requires provider credentials that can't live in a client;
  Collaboration-Spec §3.6/D12 explicitly keeps email **out of v1** ("in-app only") — so this is the
  *latest* function to build and gated on a provider decision.
- **Trigger:** `onDocumentCreated` `notifications/*` (consumes SF2's output). Batch via a short
  debounce / scheduled digest to avoid one email per rapid event.
- **Interim:** none needed — in-app inbox is the v1 channel; SF10 is purely additive.
- **Idempotency:** track a `deliveredAt`/`transportId` on the notification (or a side collection)
  so a re-delivered event doesn't re-send.
- **Rules interaction:** none.
- **Dependencies:** SF2 authors the notifications it sends; needs an email/push provider (D-list).
- **Acceptance:** each notification eligible for transport is delivered at most once per channel,
  honoring user preferences.

---

#### SF11 — Entitlement / quota counters

- **Owns/does (PL5 = Option b, decided):** maintain the counters Firestore rules **cannot** compute
  so quota gates are cheap: `workspace.pulseCount`, `workspace.collaboratorUids[]`, and
  `pulse.resourceCount` (Plans-Spec §3.2/§5). **Not editor seats** — those are the owner-managed
  `Workspace.editorUids[]` array, capped directly in rules (PL9 option B).
- **Why server-side:** rules can't count a collection; a maintained counter lets a rule do
  `count < quota` in O(1) via `get()`. Server-maintained only — a client-written counter could be
  forged. Fail-closed on lag-high (wrongly blocks a create — annoying, safe), and the plan tier
  itself (the real boundary) is SF3.
- **Trigger:** `onDocumentWritten` on the counted collections (pulses / pulseMembers / resources),
  updating the counter **in a transaction that reconciles** (recompute-from-source on drift; guard by
  event id) rather than a blind increment. The `editorUids`/`collaboratorUids` sets are recomputed
  from the org's pulseMembers so distinct-user counting stays correct.
- **Async note:** the counter lags the write it counts, so a rapid burst can transiently allow **one**
  over the limit; it converges and blocks steady-state — acceptable for a commercial quota.
- **Rules interaction:** rules read the counter (+ tier cap from `billing/{ws}`) to gate growth
  (Plans-Spec §5). Ships **with SF3 in Phase 3** — both are the plan layer.
- **Dependencies:** SF3 (tier ⇒ quota numbers); ownership transfer (PL7) reassigns which owner's
  counters apply.
- **Acceptance:** each counter equals the true collection count within one invocation of a
  create/delete; a rule-enforced quota blocks the (count+1)th create.

---

#### SF12 — Presence GC

- **Owns/does:** delete `presence/{uid}` heartbeats whose `lastSeen` is older than the stale
  threshold, so dead docs don't accumulate.
- **Why server-side:** presence is a client heartbeat (`PresenceBar.tsx`) with a client-side stale
  **filter** (`STALE_MS=45_000`) and a best-effort `clearPresence` on unload. A tab that dies
  (crash, network drop, mobile background-kill) never fires unload, leaving a stale doc forever;
  clients filter it out on read, but it lingers as cost/clutter and can mislead any raw reader. A
  scheduled sweep deletes anything older than, say, 2–3× the heartbeat interval.
- **Trigger:** `onSchedule` every 1–2 minutes (cheap: query stale, delete in batches). Scope by
  collection-group over `presence` (Admin SDK).
- **Interim (fail-open):** client-side filter already hides stale entries in the UI; SF12 is
  hygiene/cost only.
- **Idempotency:** deletes are idempotent.
- **Rules interaction:** none.
- **Dependencies:** none. Cheapest possible; low priority.
- **Acceptance:** no `presence` doc older than the threshold survives more than one sweep interval.

---

#### SF13 — Join-link / invite lifecycle cleanup

- **Owns/does:** (a) delete `joinLinks/{token}` docs past `expiresAt` or flagged `disabled` so
  revoked/expired links don't linger; (b) the one-shot retirement sweep of the legacy
  `pulses/{p}/invites` and `inviteIndex/**` trees after the copy-link deprecation window
  (Collaboration-Spec §3.1/D1 — "retire after one release").
- **Why server-side:** expiry is time-based, not event-based — no client reliably runs at the
  moment a link expires; and the legacy-invite retirement must reach docs across all users'
  `inviteIndex/{email}` shards, which only the Admin SDK can enumerate.
- **Trigger:** `onSchedule` daily (expiry sweep) + a manually-invoked one-shot (retirement).
  *(Note: the current `InviteLink` on the Pulse doc — `types/index.ts:221` — has no `expiresAt`;
  the richer `joinLinks/{token}` model with `expiresAt`/`disabled` is Collaboration-Spec §5. SF13
  targets that model; if links stay on the pulse doc it degrades to just the retirement sweep.)*
- **Interim:** revocation today = overwrite/clear the pulse `invite` field (immediate); expiry
  isn't modeled yet. Fail-closed (an expired link the rule still honored would be the risk — so if
  `expiresAt` is added, **the rule must check it**, `expiresAt == null || expiresAt > request.time`;
  SF13 is cleanup, the rule is the boundary).
- **Idempotency:** deletes are idempotent.
- **Rules interaction:** the join rule must enforce expiry/disabled (Collaboration-Spec §4); SF13
  only reclaims storage.
- **Dependencies:** none.
- **Acceptance:** no expired/disabled link survives a day; post-retirement, no `invites`/
  `inviteIndex` docs remain.

---

#### SF14 — User provisioning

- **Owns/does:** create `users/{uid}` and the personal workspace (`workspaces/personal-{uid}` +
  `workspaceMembers/{uid}` as owner) on account creation — the work `ensureUserDoc`
  (`users.ts:15`) + `createPersonalWorkspace` (`workspaces.ts:15`) do client-side today.
- **Why server-side:** provisioning currently runs only if the client's `bootstrap` cooperates on
  first sign-in; an interrupted first session (close the tab mid-bootstrap) can leave a signed-in
  user with **no** `users/{uid}` doc and no personal workspace, breaking the dashboard until they
  sign in again. An Auth-triggered function guarantees provisioning exactly once at account
  creation, independent of the client.
- **Trigger:** Auth **`beforeUserCreated`** blocking function (provision synchronously as part of
  account creation) — or the post-creation user event if we prefer non-blocking. Recommendation:
  blocking, so the `users` doc exists before the first client read; it can also enforce policy
  (e.g. allowed email domains) if ever needed.
- **Interim (fail-open):** `ensureUserDoc` is idempotent, so it stays as a client-side backstop
  (harmless double-create returns early). SF14 removes the "client never finished bootstrap" gap.
- **Idempotency:** `ensureUserDoc` already checks existence first; the function must too (the two
  sequential writes — workspace then member — must respect the rule ordering the client comment
  documents, though the Admin SDK bypasses it, so a batch is fine server-side).
- **Rules interaction:** none (Admin SDK); the client `users` create rule stays for the backstop.
- **Dependencies:** must run before anything reads `personalWorkspaceId`. SF15 is its inverse.
- **Acceptance:** every newly-created account has a `users/{uid}` doc and a personal workspace
  before its first authenticated client read.

---

#### SF15 — Account deletion cleanup

- **Owns/does:** when a user deletes their account, tear down their footprint: delete the Pulses
  they solely own (via SF6's cascade), remove their `pulseMembers` docs across all Pulses (via
  SF7's cascade per membership), delete their `users/{uid}` subtree (`myPulses`, `notifications`),
  their `billing/{uid}`, and their personal workspace. Handle sole-owner Pulses per policy
  (delete, or block deletion until ownership transferred — D-list).
- **Why server-side:** there is **no cleanup today** — `users` delete is `false`
  (`firestore.rules:96`), and a client can't reach cross-Pulse/cross-user docs anyway. Account
  deletion is a compliance/data-hygiene need (GDPR-style "delete my data"). Only the Admin SDK can
  enumerate and delete a user's footprint.
- **Trigger:** Auth user-deletion lifecycle event (the 2nd-gen analogue of `onUserDeleted`).
- **Interim:** none (feature doesn't exist).
- **Idempotency:** all deletes idempotent; safe to re-run.
- **Rules interaction:** none (Admin SDK). Enables a real "Delete account" UI later.
- **Dependencies:** reuses SF6 (owned-Pulse teardown) and SF7 (per-membership cleanup); interacts
  with the last-owner guard (must not orphan a shared Pulse — transfer or delete per policy).
- **Acceptance:** after account deletion, no doc keyed to that uid (owned Pulses, memberships,
  indexes, billing, personal workspace) remains, within the function's run.

---

#### SF16 — Activity retention (fallback sweeper)

- **Owns/does:** prune `pulses/{p}/activity/*` entries past their plan-tiered retention (Free
  30 days, Pro 1 year, Team 2 years — Changelog-Spec CL6).
- **Why server-side / recommendation:** **prefer native Firestore TTL** on an `expireAt` field
  stamped at write time (Changelog-Spec §7.2) — no function needed, Firestore auto-deletes. SF16
  exists **only** as the scheduled fallback for the case where retention must change *after* write
  (e.g. the owner's plan changes and we want already-written entries' lifetimes recomputed), which
  native TTL can't do. Register it so the option isn't a loose end; build it only if that
  requirement materializes.
- **Trigger:** `onSchedule` daily; query entries whose `expireAt < now` (or recompute against the
  owner's current plan) and delete in batches.
- **Idempotency:** deletes idempotent.
- **Rules interaction:** none.
- **Dependencies:** SF4 stamps `expireAt`; the native TTL policy is the primary mechanism.
- **Acceptance:** no entry older than its plan retention survives beyond one sweep (or the TTL
  window); the read-time depth gate (Changelog-Spec §5.3) is unaffected.

---

## C. Sequencing / phasing

Build order groups by **shared trigger** and by **risk class** (security-critical first, hygiene
last). Each group is independently shippable behind the interim→reconcile→flip pattern (§A.3.8).

**Phase 0 — Bootstrap (no functions).** Create the `functions/` package, wire the Functions
emulator into `firebase.json`, pin the region, extract the pure diff/denorm logic
(`domain/denorm.ts`, `domain/activityRecorder.ts`) into a shared module usable by both client and
functions, and add a function-test harness alongside `npm run test:rules`.

**Phase 1 — Fail-closed hardening of already-enforced permissions (High).**
- **SF1** (feature denorm maintainer). Rules *already* depend on `assignedUids`/`leadUid`, so this
  is the highest-value hardening: it heals partial `linkedUid` fan-outs the client can't guarantee.
  Ship reconciling (client keeps optimistic writes); do **not** flip to reject client writes yet.

**Phase 2 — Cross-user integrity the client physically cannot do (High).**
- **SF6** (Pulse cascade delete) + **SF7** (membership removal cascade). These clean *other* users'
  self-owned docs — impossible from any client. Group them; they share the Admin-SDK teardown
  helpers and SF15 will reuse both. Ship SF8/SF9 (resource/epic delete integrity) in the same
  deploy — all four are `onDeleted` integrity sweeps.

**Phase 3 — The plan layer (High, at monetization).**
- **SF3** (billing webhook) + **SF11** (quota counters), when paid tiers ship. SF3 is the only
  hard security boundary; nothing paid can exist without it. Provider choice (PL8) gates it. Flip
  the relevant rules to read `billing`/counters for `entitlement ∧ capability` gates
  (Permissions-Spec §6.5, Plans-Spec §5).

**Phase 4 — Trust/completeness of the feeds (Medium).**
- **SF4** (authoritative activity) — flip `activity.create` to `source=='server'` only once proven
  (Changelog-Spec §8 phase 3). **SF2** (notification authoring) — **shares SF4's features/comments
  trigger**; ship together to register one trigger surface. Adds the missing
  assignment/status/role notification types.

**Phase 5 — Reliability & hygiene (Low).**
- **SF14** (provisioning) and **SF15** (account deletion) — the Auth lifecycle pair; SF15 reuses
  SF6/SF7. **SF5** (profile denorm sync). **SF12** (presence GC), **SF13** (link/invite cleanup),
  **SF16** (retention fallback — only if native TTL proves insufficient). **SF10** (notification
  transport) last, gated on an email/push provider (D12).

**Migration/rollout notes.** No destructive migration anywhere. Each function runs in parallel with
its interim first (reconcile), then a rule flip retires the redundant client write where a boundary
tightens (only SF3 already-final `write:false`, and SF4's `source` flip). Rollback = disable the
function / revert the flip; the client interim resumes. Backfills are recompute-idempotent (SF1) or
explicitly none (SF4). SF6/SF7/SF15 change no rules — they're pure Admin-SDK cleanup layered over
the existing client behavior.

---

## D. Open questions / decisions

Each carries a **recommended default** so nothing blocks on it.

1. **Region.** Which region hosts functions + the Firestore triggers? *Recommend:* match
   `pulse-b9d96`'s existing Firestore location exactly (single region, co-located). Confirm the DB
   location before first deploy.
2. **Payment provider (PL8).** Stripe vs RevenueCat vs other — drives SF3's webhook shape and
   SF11's seat model. *Recommend:* Stripe for web-first SaaS (hosted checkout + billing portal +
   robust webhook signatures). Product/eng decision.
3. **Email/push provider (D12).** Needed only for SF10, which is deferred. *Recommend:* keep
   **in-app only** for the foreseeable roadmap; when email is wanted, a Firebase mail extension
   (Firestore-triggered) or a transactional provider (Resend/SendGrid) via SF10.
4. **Activity retention: native TTL vs sweeper.** *Recommend:* **native Firestore TTL** on
   `expireAt` stamped at write (Changelog-Spec §7.2); build **SF16** only if post-write retention
   recomputation is required. Confirm we accept "retention is fixed at write-time plan."
5. **Does the client keep writing optimistic denorms after SF1 ships?** *Recommend:* **yes** —
   client writes `assignedUids`/`leadUid` optimistically for latency; SF1 is the authority that
   reconciles/heals. Do **not** flip rules to reject client writes of these keys unless a concrete
   abuse appears (a scoped role already can't write features at all, Permissions-Spec §4.7).
6. **Pulse delete & account delete: `onCall` vs `onDeleted` trigger.** *Recommend:* an **`onCall`**
   entry point for user-initiated teardown (SF6/SF15) so the client gets a completion signal and
   ordering is controlled, **plus** an `onDeleted` backstop so a direct doc delete still triggers
   cleanup. Confirm.
7. **Sole-owner Pulses on account deletion (SF15).** Delete them outright, or block account
   deletion until ownership is transferred? *Recommend:* on account deletion, **delete** Pulses the
   user solely owns (they're the billing owner and no one else can own them) and cascade; surface a
   pre-deletion warning listing them. Confirm vs a transfer-first policy.
8. **Quota enforcement depth (PL5). → DECIDED: rule-enforced counters (SF11), Option b.**
   SF11 maintains `workspace.pulseCount` / `editorUids[]` / `collaboratorUids[]` /
   `pulse.resourceCount`; rules gate growth against them. Ships **with SF3 in Phase 3**.
9. **Cost ceilings / alerting.** Set a monthly functions budget alert and per-function error-rate
   alerts. *Recommend:* budget alert on the whole project; hard alert on SF3 signature failures and
   any function error rate > 1%. Confirm thresholds with infra.
10. **Notifications collection path.** Keep the shipped `pulses/{p}/notifications` (member-writable)
    or migrate to self-owned `users/{uid}/notifications` (Collaboration-Spec D6, server-mandatory)?
    *Recommend:* keep the shipped path for v1 (SF2 = reliability hardening); migrate to self-owned
    only if we need notifications a member can't forge/spam. Confirm.

---

## Appendix — traceability

| Server function | Spec / code origin |
|---|---|
| SF1 | Server-Functions-Spec §3 SF1; Permissions-Spec §4.2/§4.7 P12; `pulseStore.reconcileDenorms`, `domain/denorm.ts` |
| SF2 | Server-Functions-Spec §3 SF2; Collaboration-Spec §3.6/D6; `components/comments/notify.ts`, `services/firestore/notifications.ts` |
| SF3 | Server-Functions-Spec §3 SF3; Plans-Spec §4–§5, §8 PL8 |
| SF4 | Server-Functions-Spec §3 SF4; Changelog-Spec §4.3–§4.5, §8; `domain/activityRecorder.ts` |
| SF5 | `PulsePage.tsx:121` (`syncMyMemberPhoto`); `PulseMember.photoURL` (`types/index.ts:122`) |
| SF6 | `pulses.deletePulse` (`pulses.ts:213`); Collaboration-Spec §1.8 |
| SF7 | `memberships.removeMember`/`leavePulse`; Collaboration-Spec §1.6/§3.3; `Resource.linkedUid` |
| SF8 | `pulseStore.removeResource` (`pulseStore.ts:344`) |
| SF9 | `pulseStore.removeEpic` (`pulseStore.ts:215`) |
| SF10 | Collaboration-Spec §3.6/D12 |
| SF11 | Plans-Spec §3.2/§5, PL5; Permissions-Spec §6.5 |
| SF12 | `PresenceBar.tsx` (`STALE_MS`), `services/firestore/presence.ts`; Collaboration-Spec §3.4/D4 |
| SF13 | Collaboration-Spec §3.1/D1; `services/firestore/joinLinks.ts`, `invites.ts`, `inviteIndex` |
| SF14 | `users.ensureUserDoc`, `workspaces.createPersonalWorkspace`; Collaboration-Spec §1.1 |
| SF15 | `firestore.rules:96` (`users` delete=false); Collaboration-Spec §1.6 invariant |
| SF16 | Changelog-Spec §7.2, CL6 |
