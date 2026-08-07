# Pulse — Server Functions Spec

Status: **Registry — open** · Owner: product + eng · Related: `Permissions-Spec.md`, `Plans-Spec.md`, `Collaboration-Spec.md`, `Changelog-Spec.md`

**Shipped so far:** SF1 (feature denorm), the SF6–SF9 delete cascades (architecture-spec
numbering — see the note in §2), and SF3 (billing). All deployed to `us-central1`. Everything
else in the registry below is still deferred.

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
| **SF1** | Feature denormalization maintainer | `Feature.assignedUids`, `Feature.leadUid` | write of features / resources / subtasks | `Permissions-Spec.md` §4.2, §7, P2/P12 | **Shipped & deployed** (`onFeatureWriteDenorm`, `onResourceWriteFanout`; client reconcile removed) |
| **SF2** | Assignment & comment notifications | server-authored `notifications/*` (dedupe, batching, email later) | write of features (assignment) / comments | `Collaboration-Spec.md` §3.6 | Deferred (client-created notifications interim) |
| **SF3** | Billing / plan sync | `billing/{orgId}` (tier, status, period, Stripe ids) — the **only** writer | **Stripe** webhook (HTTPS) + two callables | `Plans-Spec.md` §4, §8 (PL8 decided), §9 | **Shipped & deployed** (`stripeWebhook`, `createCheckoutSession`, `createPortalSession`; quota *enforcement* still pending — see §SF3) |
| **SF4** | Activity-log authoring (authoritative) | `pulses/{p}/activity/*` (server-written audit entries) | write of features / epics / resources / pulseMembers / pulse doc | `Changelog-Spec.md` §4.3, §4.5, CL4 | Deferred (client-emitted activity-log interim) |
| **SF5** | Storage OAuth broker | the provider refresh token (Secret Manager / `storageSecrets/{pulseId}`) + `storage/connection.status` — the **only** reader/writer of credentials | HTTPS (OAuth redirect, disconnect, token refresh) | `Storage-Spec.md` §4 | Deferred (**no client interim possible**) |
| **SF6** | Storage folder-tree reconciler | `pulses/{p}/storageNodes/*` and the remote folder tree | write of features / epics / pulse doc; `storageJobs/*` | `Storage-Spec.md` §5, §6 | Deferred (**no client interim possible**) |
| **SF7** | Attachment upload/download broker | issues per-file upload sessions; membership-checked downloads | HTTPS (callable) | `Storage-Spec.md` §7, §10 | Deferred (**no client interim possible**) |

> ⚠️ **Numbering conflict — unresolved.** This registry numbers the Storage functions
> **SF5–SF7**, but `Backend-Architecture-Spec.md` §B numbers **SF6** Pulse-cascade-delete,
> **SF7** membership-removal, **SF8** resource-delete, **SF9** epic-delete and **SF11**
> quota counters. **The deployed code follows the architecture spec's numbering** —
> `functions/src/cascade.ts` exports SF6–SF9 as the delete cascades, and they are live in
> `us-central1`. So SF6/SF7 mean two different things across the two documents. The four
> cascade functions are deliberately **not** added to the table above, because doing so
> would collide with the Storage rows. Pick one scheme and renumber both docs (plus the
> code comments) before adding more entries.

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

**Owns:** the `billing/{orgId}` doc (`{ tier, status, currentPeriodEnd, seats?, source,
updatedAt, stripeCustomerId, stripeSubscriptionId, country, currency }`) that
`Plans-Spec.md` reads to gate features/quotas. Keyed by **Organization** (the billing
entity — Plans-Spec §1), not by user. This is the **only writer** of that doc.

**Why server-side (mandatory, not just hardening):** the plan is a **security boundary** —
if the client could write it, any user would set themselves to Business. So unlike SF1/SF2,
there is **no acceptable client interim** for *writing* the plan.

**Status — shipped and deployed.** `functions/src/billing.ts` exports three functions:
`stripeWebhook` (this spec), plus `createCheckoutSession` / `createPortalSession`, which
mint hosted Stripe URLs so card details never touch the app (Plans-Spec §6). Neither
callable writes `billing/{orgId}` — a subscription change always arrives back through the
webhook, keeping it the single writer. The account-menu "Billing & payment" entry is now
the real screen (`BillingDialog.tsx`), not a stub.

**What is NOT yet enforced.** Paid tiers exist and resolve correctly, but the quota gates
are **client-side only**: `firestore.rules` still has no `editorUids` cap and no
Pulse/collaborator/resource limits, and **SF11** counters don't exist. Until both land, a
determined client can exceed a *commercial* limit — not a security boundary, since the
plan doc itself remains `write: if false`.

**Trigger:** an HTTPS webhook endpoint **Stripe** (PL8 — decided) calls on subscription
create/update/cancel/renew (and tax/invoice events, Plans-Spec §9). Verify the Stripe
signature **over the raw body**, then **refetch the subscription from Stripe** and
recompute `{ tier, status, currentPeriodEnd, seats, … }` from its current state before
writing via the Admin SDK (bypasses rules). Recomputing rather than reading the event
payload is what makes at-least-once and out-of-order delivery converge; on top of that a
replayed `event.id` is a no-op and a strictly older `event.created` is dropped
(`stripeEventId` / `stripeEventCreated` on the doc).

The org is resolved most-authoritative-first: subscription metadata → Customer metadata →
reverse lookup on `Workspace.stripeCustomerId` (**`orgId === workspaceId`**, PL6). Checkout
stamps `workspaceId` on all three, so the first path normally hits; the reverse lookup is
the self-heal for subscriptions created straight from the Stripe dashboard.

**Two 2025 Stripe API moves this depends on** (verified against `stripe@22`, not memory —
both silently read `undefined` otherwise): `current_period_end` and seat `quantity` live on
the subscription **item**, not the subscription; and `Invoice.subscription` is now
`invoice.parent.subscription_details.subscription`.

**PL4 downgrade (Plans-Spec §5.1).** When an org *flips off* a paid plan, SF3 demotes every
editor/owner across the org's Pulses except `workspace.ownerId` to full viewer and collapses
`editorUids` to `[ownerId]`. Nothing is deleted; collaborators are untouched. `past_due`
does **not** demote — it rides Stripe's dunning, and the client grants a matching **15-day**
grace window (`DELINQUENCY_GRACE_DAYS`) measured from `pastDueSince`, which SF3 stamps on the
first failed charge and carries across retries. Both sides of the flip test the same
"still holds its seats" predicate; testing only active/trialing on the *previous* state
would mean `active → past_due → canceled` — the usual involuntary-churn path — never demoted.

**Rules interaction:** `billing/{orgId}` is `read: if isOrgAdmin(orgId); write: if false`
(admin = an `owner` in that workspace's `WorkspaceMember`); security rules `get()` it
(bypassing the read rule) to gate Pulse actions on the Pulse's `workspaceId`. See
`Plans-Spec.md` §4–§5.

**Related future functions:** **SF11** quota counters (`workspace.pulseCount`,
`collaboratorUids[]`, `pulse.resourceCount`) — PL5 chose maintained counters, and the rules
gates above depend on them. Numbered in `Backend-Architecture-Spec.md` §B, not in the
registry here (see the numbering note under §2).

### SF4 — Change-log authoring (authoritative)

**Owns:** the durable per-Pulse change log `pulses/{p}/activity/{entryId}`
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
change writes the `activity` entry at the same logical-action boundary the undo engine
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

### SF5 — Storage OAuth broker

**Owns:** the customer's Google Drive / OneDrive **refresh token** and the derived
`storage/connection.status`. It is the only component that ever holds a credential.

**Why server-side (mandatory):** a refresh token is standing access to a customer's
entire connected drive. It must never reach the browser and must not be readable through
Firestore rules by anyone — including the Pulse owner who authorized it. **There is no
acceptable client interim**: until SF5 ships, BYOS does not exist and attachments remain
pasted links (`Storage-Spec.md` §1).

**Trigger:** HTTPS. Handles the OAuth redirect (authorization code + PKCE), token
exchange, refresh, and disconnect/revoke. Stores the refresh token in Secret Manager or
an Admin-SDK-only `storageSecrets/{pulseId}` doc (`allow read, write: if false`). Mints
short-lived access tokens for SF6/SF7 in-process; never returns one to a client.

**Rules interaction:** `storage/connection` is member-readable (status only, no
credentials) and function-written. `storageSecrets/*` is denied to every client.

**Acceptance:** no code path returns a token or scope to the browser; a revoked grant
flips the connection to `needs-reauth` rather than failing silently.

### SF6 — Storage folder-tree reconciler

**Owns:** `pulses/{p}/storageNodes/*` (entity id → provider folder id) and the remote
folder tree that mirrors the Pulse (`Storage-Spec.md` §5).

**Why server-side (mandatory):** it needs credentials (SF5), and it must keep running
after the browser tab closes. **No client interim.**

**Trigger:** writes to features / epics / the pulse doc, plus a per-Pulse
`storageJobs/*` queue that coalesces by entity id.

**Design — reconcile, never replay** (§1's "recompute from source"): compute the desired
name/parent for an entity from Firestore, compare against `StorageNode` + the provider,
and issue the minimum operation. Runs twice, late, or after a crash → same result. Folder
**identity is the provider id**, never a path, so a failed or skipped rename can't break
a single attachment link. Deletions **move to `_Archive/{YYYY-MM}/`** — the function must
never hard-delete customer content. Folders are created lazily on first upload. Honour
`Retry-After`; cap concurrency per connection.

**Acceptance:** renaming a task 5× produces ≤1 remote rename; a manual rename in Drive is
left alone; a folder deleted in Drive is re-created on next upload; a full re-sync from
scratch converges to the same tree.

### SF7 — Attachment upload/download broker

**Owns:** issuing per-file upload sessions and serving membership-checked downloads.

**Why server-side (mandatory):** it holds credentials and it is the **authorization
boundary** for file access. **No client interim.**

**Trigger:** HTTPS callable. On upload it verifies the caller's edit scope for the parent
feature, resolves/creates the task folder via SF6, and returns a **single-file** upload
session URL (Drive resumable / Graph `createUploadSession`) — deliberately not an access
token, so a leak costs one file rather than a drive. Bytes go browser → provider
directly. On download it verifies the caller's *read* scope for the parent feature, then
redirects (OneDrive's short-lived `downloadUrl`) or proxies the bytes (Drive — see
`Storage-Spec.md` ST7).

**Acceptance:** a non-member, and a My-Beat viewer outside their beat, cannot fetch a
file even with its id; an upload session URL cannot be reused for a second file.

---

## 4. Adding a server-delayed decision

When any spec would defer work to the server:
1. Add a row to the §2 registry (`SF#`, what it owns, trigger, referencing spec).
2. Add a short §3 entry: target server design + the interim client behaviour + why the
   interim is acceptable (must fail closed if it's security-relevant).
3. In the source spec, resolve the open decision to **"client-maintained now; server
   hardening tracked as Server-Functions-Spec SF#"** and link here — don't leave it as a
   standalone open decision.
