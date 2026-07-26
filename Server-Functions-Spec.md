# Pulse — Server Functions Spec

Status: **Registry — open** · Owner: product + eng · Related: `Permissions-Spec.md`, `Plans-Spec.md`, `Collaboration-Spec.md`, `Changelog-Spec.md`

## 0. Purpose

Pulse ships **fully serverless today**: a React client talking directly to Firestore
(+ Firebase Auth + Hosting). There are **no Cloud Functions** yet.

This document is the **single registry for every capability that is deferred to
server-side execution** — the "server-delayed" decisions from the other specs. For
each such capability the client does the work as an **interim** (good enough for v1),
and this doc records the **target server design** plus the interim, so the migration is
a known, bounded piece of work rather than a scattered set of TODOs.

**Rule of thumb:** whenever another spec says "…do this on the server / a Cloud
Function later", it must **not** leave that as a loose open decision — it adds an entry
here (an `SF#`) and references it. See §4 (Adding an entry).

## 1. Platform & conventions

- **Runtime:** Firebase Cloud Functions (2nd gen), TypeScript, deployed to the same
  `pulse-b9d96` project. Triggered by Firestore document writes
  (`onDocumentWritten`/`onDocumentCreated`) unless noted.
- **Idempotency:** every function must be safe to run twice on the same event (Firestore
  delivers at-least-once). Recompute-from-source and write the result; never increment.
- **Authority:** a server function is the *authoritative* maintainer of any field it
  owns. Once a function ships, the client stops writing that field (or writes it only as
  an optimistic hint the function overwrites).
- **Interim before it ships:** the client maintains the field/behaviour. The interim is
  acceptable only where a wrong/stale value **fails closed** (denies access) rather than
  leaking — noted per entry.
- **Cost:** these are low-frequency, write-triggered functions; keep them off any
  read/hot path.

## 2. Registry

| ID | Function | Owns | Trigger | Referenced by | Status |
|---|---|---|---|---|---|
| **SF1** | Feature denormalization maintainer | `Feature.assignedUids`, `Feature.leadUid` | write of features / resources / subtasks | `Permissions-Spec.md` §4.2, §7, P2/P12 | Deferred (client-maintained interim shipping) |
| **SF2** | Assignment & comment notifications | server-authored `notifications/*` (dedupe, batching, email later) | write of features (assignment) / comments | `Collaboration-Spec.md` §3.6 | Deferred (client-created notifications interim) |
| **SF3** | Billing / plan sync | `billing/{uid}` (tier, status, period) — the **only** writer | payment-provider webhook (HTTPS) | `Plans-Spec.md` §4, §8 (PL8) | Deferred (no billing yet; account menu stub) |
| **SF4** | Change-log authoring (authoritative) | `pulses/{p}/changeLog/*` (server-written audit entries) | write of features / epics / resources / pulseMembers / pulse doc / comments | `Changelog-Spec.md` §4.3, §4.5, CL4 | Deferred (client-emitted change-log interim) |

---

## 3. Function specs

### SF1 — Feature denormalization maintainer

**Owns:** the two scalar fields the permission rules read to enforce the scoped roles:
- `Feature.assignedUids: string[]` — the linked account uid of **every** resource
  assigned to the feature **or any of its subtasks** (`Resource.linkedUid` for each
  `resources[]` entry, deduped; excludes unlinked resources).
- `Feature.leadUid: string | null` — the linked account uid of the resource in
  `feature.lead` (or `null` if unset / the lead resource is unlinked).

**Why server-side (target):** these are derived from data on other documents
(`Resource.linkedUid`) and from arrays the rules can't iterate. A function guarantees
they stay correct across **all** the events that change them, atomically, regardless of
which client made the change — including the **`linkedUid` fan-out**: when a resource is
linked/unlinked to an account, *every* feature that resource appears on (directly or via
a subtask, or as `lead`) must be recomputed.

**Triggers (onDocumentWritten):**
1. `pulses/{p}/features/{f}` — recompute that feature's `assignedUids`/`leadUid` from its
   own `resources`, `children[].resources`, and `lead`. (Skip if the write was the
   function's own denorm-only update — compare before/after to avoid loops.)
2. `pulses/{p}/resources/{r}` — if `linkedUid` changed, **fan out**: find every feature
   in the Pulse whose `resources`, any `children[].resources`, or `lead` references `r`,
   and recompute each. (Read the Pulse's features once; batch the updates.)

**Algorithm (per feature):**
```
assignedUids = unique( [ ...resources, ...children.flatMap(c => c.resources) ]
                         .map(rid => resourceById[rid]?.linkedUid)
                         .filter(Boolean) )
leadUid      = resourceById[feature.lead]?.linkedUid ?? null
```
Write only when the computed values differ from the stored ones (idempotent, no loop).

**Interim (ships now — Permissions-Spec P12 resolved to client-maintained):** the
client writes `assignedUids`/`leadUid` on every feature write, and performs the
`linkedUid` fan-out from the linking client (it already has the full resource roster in
`pulseStore` and already fans out `myResourceIds`). Safe because only **editors**
(`editScope:'all'`) can write features — a scoped-role user can't write features and so
can't forge their own inclusion/lead; and a stale denorm **fails closed** (a My-Beat
Viewer sees *fewer* tasks, never more). The only real gap the interim leaves is the
fan-out being interrupted mid-write (partial update) — which SF1 removes.

**Migration:** ship the client interim first (Permissions phase 2 backfills existing
features). When SF1 deploys, it becomes authoritative; the client keeps writing the
field optimistically (SF1 reconciles) or stops — decided at SF1 build time.

**Acceptance:** for any feature, `assignedUids`/`leadUid` equal the algorithm output
within one function invocation of any assignment/lead/`linkedUid` change; a resource
unlinked from an account is removed from every affected feature's `assignedUids`.

### SF2 — Assignment & comment notifications (placeholder)

Notifications are **currently created client-side** (`src/components/comments/notify.ts`,
`services/firestore/notifications.ts`). `Collaboration-Spec.md` §3.6 anticipates moving
notification authoring server-side for reliability, de-duplication, batching, and
(later) email/push. Captured here so it isn't a loose end; **not scheduled** — expand
into a full SF spec when notifications move server-side. If SF1 and SF2 ship together,
share the features-write trigger.

### SF3 — Billing / plan sync

**Owns:** the `billing/{ownerUid}` doc (`{ tier, status, currentPeriodEnd, seats?,
source, updatedAt }`) that `Plans-Spec.md` reads to gate features/quotas. This is the
**only writer** of that doc.

**Why server-side (mandatory, not just hardening):** the plan is a **security boundary** —
if the client could write it, any user would set themselves to Pro. So unlike SF1/SF2,
there is **no acceptable client interim** for *writing* the plan. Until SF3 ships,
everyone is effectively **Free** (absent `billing` doc = Free, per Plans-Spec §4); paid
tiers simply don't exist yet. The account-menu "Billing & payment" entry stays a stub
until then.

**Trigger:** an HTTPS webhook endpoint the payment provider (Stripe / RevenueCat / …,
PL8) calls on subscription create/update/cancel/renew. Verify the provider signature,
map the event to `{ tier, status, currentPeriodEnd }`, and write `billing/{uid}` via the
Admin SDK (bypasses rules). Idempotent: recompute the doc from the event's current
subscription state; ignore out-of-order/duplicate deliveries by `updatedAt`/event id.

**Rules interaction:** `billing/{uid}` is `read: if self; write: if false`; security
rules `get()` it (bypassing the read rule) to gate Pulse actions on the Pulse's
`billingOwnerUid`. See `Plans-Spec.md` §4–§5.

**Related future functions (not yet SF-numbered):** collection-count quota counters
(Plans-Spec PL5) if quotas need server-maintained counts.

### SF4 — Change-log authoring (authoritative)

**Owns:** the durable per-Pulse change log `pulses/{p}/changeLog/{entryId}`
(`ChangeEntry`, `Changelog-Spec.md` §3). When SF4 ships it is the **only** trusted writer;
rules reject client-authored (`source:'client'`) creates and the log becomes genuinely
append-only-by-the-server.

**Why server-side (target):** a change log a client can **omit** (do the mutation, skip
the log write), **mis-summarize**, or **spam** is not an audit. Diffing before→after on
the server removes the client from the trust path — completeness and truthfulness no
longer depend on a cooperating client. Same reliability argument as SF2 (notifications);
if both ship together they share the `features`/`comments` write triggers.

**Triggers (onDocumentWritten):** `pulses/{p}/features/{f}`, `.../epics/{e}`,
`.../resources/{r}`, `.../pulseMembers/{uid}`, the `pulses/{p}` doc itself
(`invite`/`name`/statuses/resourceTypes/graphConfig), and `.../comments/{c}`. Map each
before→after to a `ChangeEntry` (`entityKind`/`verb`/`summary`/curated `deltas`), stamp
`source:'server'`, `at = serverTimestamp()`, and `scopeUids` (from the feature's
`assignedUids`) for read-scoping (Changelog-Spec §5.2).

**Must-skip writes (mirrors SF1's loop-avoidance):**
- **Denorm-only reconcile writes** — skip any features write whose `affectedKeys()` ⊆
  `{assignedUids, leadUid}` (the SF1/client denorm maintenance, not a user change);
  otherwise every assignment double-logs (Changelog-Spec §4.4).
- **No-op writes** where nothing meaningful changed, and SF4's own prior writes.

**Idempotency:** Firestore delivers at-least-once, so derive `entryId` deterministically
from the event (event id, or a hash of `pulseId+entityId+verb+beforeUpdateTime`) and write
with a fixed doc id — re-delivery overwrites, never duplicates (§1). If a client draft
(`source:'client'`) with a matching `clientKey` already exists, **replace it in place**
with the authoritative `source:'server'` entry so the timeline never double-shows a change
during the overlap window.

**Interim (ships now — Changelog-Spec CL4 = client-emitted):** the client that made the
change writes the `changeLog` entry at the same logical-action boundary the undo engine
records at (`recordSingle`/`recordMany`), create-only and immutable via rules
(`actorUid` pinned to the caller; `update`/`delete` = `false`). This is the **same trust
posture as the already-shipped client-authored notifications** (`notify.ts`) and is
acceptable for a collaboration/activity feed — the gap it leaves (a malicious client can
omit or mis-summarize entries) is exactly what SF4 closes. Note the interim **fails open**
(a dropped log write silently loses one entry), unlike the security-relevant SF1/SF3 which
must fail closed — acceptable because the log grants no access and gates nothing.

**Migration:** ship the client interim (Changelog-Spec phase 1). When SF4 deploys, flip
the rules to reject `source:'client'` creates, let SF4 backfill from its triggers going
forward (no historical backfill — the log starts when it starts), and dedupe/replace any
client drafts during a short overlap.

**Acceptance:** every logged mutation produces exactly one `ChangeEntry` within one
function invocation; denorm-only reconcile writes and no-ops produce none; re-delivered
events never duplicate an entry.

---

## 4. Adding a server-delayed decision

When any spec would defer work to the server:
1. Add a row to the §2 registry (`SF#`, what it owns, trigger, referencing spec).
2. Add a short §3 entry: target server design + the interim client behaviour + why the
   interim is acceptable (must fail closed if it's security-relevant).
3. In the source spec, resolve the open decision to **"client-maintained now; server
   hardening tracked as Server-Functions-Spec SF#"** and link here — don't leave it as a
   standalone open decision.
