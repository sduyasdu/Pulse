# Pulse — Change-Log / Activity-Log Specification

Status: **Proposal — decisions open (CL1–CL12)** · Owner: product + eng · Scope:
designs a **durable, shared, per-Pulse change log** (activity trail) — *who changed
what, when*. Spec/design only, no application code changes.
Related: `Collaboration-Spec.md` (§3.6 notifications, **§3.7** which sketched this as
the `activity` placeholder — this spec supersedes and renames it), `Permissions-Spec.md`
(caps, `callerReadScope`, My-Beat), `Plans-Spec.md` (retention/history gating),
`Server-Functions-Spec.md` (server-authored logging is registered here as **SF4**),
and the client's existing undo engine (`src/stores/undoStore.ts`) and per-mutation
capture (`src/stores/pulseStore.ts`).

> **Naming note.** `Collaboration-Spec.md` §3.7 / D7 introduced an `Activity` type at
> `pulses/{pulseId}/activity/{id}` as a placeholder. This spec is the full design and
> **renames that collection to `changeLog`** (§3) — "change log" reads as the durable
> record of edits, and avoids collision with the ambient use of "activity" for presence
> (`presence/*`, `Collaboration-Spec` §3.4, shipped). Where this spec and
> Collaboration-Spec disagree, **this spec wins** for the log; the D7 row should be
> updated to point here.

---

## 1. Goals & scope

### 1.1 What a change log is *here*

A **durable, shared, append-only, per-Pulse audit/activity trail** recording, for every
meaningful change in a Pulse, **who** did it, **what** entity it touched, **what kind of
change** it was, **when**, and a **compact human-readable summary** (plus, for a small
set of high-value fields, a before→after). It is read by any member (subject to the caps
model, §5) and surfaces as an "Activity" timeline (§6). It is the answer to "who moved
this task / changed this status / removed this member, and when?".

### 1.2 It is distinct from the two existing per-change mechanisms

Pulse already captures per-change information twice. The change log is a **third,
deliberately different** record — the table is load-bearing for the whole design:

| Aspect | **Undo** (`undoStore.ts`) | **Notifications** (`notifications.ts`) | **Change log** (this spec) |
|---|---|---|---|
| Durability | Ephemeral (in-memory) | Durable | **Durable** |
| Scope | Per-user, per-tab | Per-recipient inbox | **Per-Pulse, shared** |
| Audience | Only the actor | The targeted member(s) | **All members** (caps-scoped) |
| Lifetime | Until reload / Pulse switch (`MAX_HISTORY=50`) | Until read/deleted | **Retention window** (§7) |
| Purpose | Reverse *my* last action | Tell *you* something happened | **Record that it happened, for everyone** |
| Direction | Inverse-command (before *and* after) | Forward event | **Forward, immutable** |

Undo is a *local* inverse-command stack (before/after diffs, `DocOp`, replayed through
the normal Firestore path). Notifications are a *targeted push* into one recipient's
self-owned inbox. The change log is the *shared, permanent record*. They share a capture
boundary (§4.1) but are three separate stores.

### 1.3 Non-goals (explicit)

- **Not a full field-level diff viewer / time-travel restore.** We keep a compact
  before→after for a curated set of high-signal fields (status, lead, assignment, title,
  dates), **not** a diff of every field (`notes` HTML, `x`/`y` pixels, `alloc` maps). No
  "restore to this version" — undo already covers reversal for the actor, and a general
  restore is a much larger feature (CL9).
- **Not a cross-Pulse / global activity feed.** The log is strictly per-Pulse
  (`pulses/{id}/changeLog/**`), mirroring how every other Pulse subcollection is scoped.
  A workspace-wide "everything across my Teams" roll-up is a possible later feature
  (CL10), out of scope now.
- **Not a security/compliance-grade tamper-proof audit** in v1. The v1 client-emitted
  log is convenient but forgeable/omittable by a malicious client (§4.2); the
  tamper-resistant version is the server-authored SF4 (§4.3). We are honest about which
  guarantee is in effect at each phase.
- **Not presence.** "Who is *here now*" is `presence/*` (shipped). The change log is "who
  *changed something*, ever (within retention)".
- **Not per-keystroke.** Streamed/intermediate writes (canvas drags) collapse to one
  entry per settled action (§7.1).

---

## 2. What gets logged

### 2.1 Event catalogue

Entries are grouped by `entityKind`. Each row is one `verb` (§3.2).

| `entityKind` | Events (`verb`) | Source mutation (client) | Notes |
|---|---|---|---|
| `feature` | `create`, `delete`, `edit`, `status`, `assign`, `unassign`, `lead`, `move-epic`, `subtask` | `addFeature`/`removeFeature`/`patchFeature`/`setFeatureStatus`/`assignResource`/`unassignResource`/`patchFeature{lead}`/`moveFeatureToEpic`/`addSubtask`·`patchSubtask`·`removeSubtask`·`toggleSubtaskResource` | `status`, `assign`, `lead` are promoted out of generic `edit` because they're the high-signal ones people scan for (§2.3). Subtask changes roll up under the parent feature (`entityId` = feature) with the subtask named in the summary. |
| `epic` | `create`, `delete`, `edit` | `addEpic`/`removeEpic`/`patchEpic` | `edit` covers rename/recolor/resize. |
| `resource` | `create`, `delete`, `edit`, `link`, `unlink` | `addResource`/`removeResource`/`patchResource`/`patchResource{linkedUid}` | `link`/`unlink` (account link, `linkedUid`) promoted because it affects access scoping. |
| `member` | `add`, `remove`, `role-change`, `leave` | join-link self-join, `removeMember`, `setMemberRole`/`setMemberCaps`, self-delete | These are the security-relevant ones. `add` fires when a join-link self-join creates a `pulseMembers` doc; `leave` when a member self-deletes. |
| `invite` | `link-created`, `link-revoked` | `setInviteLink`/clearing `Pulse.invite` | The copy-link (`Pulse.invite`) is created/revoked; no per-email invites (retired). |
| `pulse` | `rename`, `config`, `transfer` | `renamePulse`/`setStatuses`·`setResourceTypes`·`setGraphConfig`/ownership transfer | `config` = statuses/resourceTypes/graphConfig; `transfer` = "Make owner". |
| `comment` | `post` | `addComment` | One entry per top-level comment/reply. Edits/deletes of a comment are **not** logged (low value, high volume; CL7). |

### 2.2 Granularity — one entry per *logical action*, not per write

**Recommendation: log at the same boundary the undo engine records at** —
`recordSingle` / `recordMany` in `pulseStore.ts`. That boundary already means *one user
gesture = one entry*:

- A gesture that touches several docs (delete-epic re-parents its features;
  delete-resource strips it from every feature; both use `recordMany`) is **one** log
  entry with a summary, not N entries.
- Intermediate/streamed writes already pass `{ record: false }` (`MutateOpts`,
  `pulseStore.ts:24`) so they don't hit the undo recorder — and so must not hit the log
  recorder either. One settled drag = one `edit` entry, authored by the same coalescing
  path that writes the single undo command (§7.1).
- The **reconcile denorm loop** (`reconcileDenorms`, `pulseStore.ts:95`) writes
  `assignedUids`/`leadUid`-only patches **directly** via `updateFeature`, bypassing
  `recordSingle`. Because logging hangs off the record boundary, these system writes are
  **never logged** — which is exactly what we want (§4.4). The server path must reproduce
  this exclusion by ignoring denorm-only diffs.

This gives a log that reads like a human's activity, not a write-ahead log.

### 2.3 Before/after vs. summary — capture a compact, curated diff

**Recommendation:** every entry carries a **`summary`** (a pre-rendered human string,
authored where the intent is known) plus **`changedKeys`** (the field names touched, from
the `DocOp.keys` the undo builder already computes). For a **curated allow-list of
high-signal scalar fields** we additionally store `before`/`after` values; for everything
else we store only that the field changed.

| Field | Store before→after? | Rationale |
|---|---|---|
| `status`, `lead`, `epicId`, `title`, `x` (start), `duration`, member `role` | ✅ yes | Short, high-value, people scan for these. |
| `resources` (assign/unassign) | ✅ the delta (added/removed id → name) | The point of an assignment log. |
| `linkedUid` (resource ↔ account) | ✅ yes | Access-relevant. |
| `notes` (rich HTML), `alloc` map, `y`/pixel positions, `attachments`, `collapsed` | ❌ changed-key only | Large/noisy; a "before/after" of HTML is a diff-viewer feature (non-goal §1.3). |

Rationale: this keeps entries small (well under Firestore's 1 MiB doc limit, typically a
few hundred bytes), keeps the timeline scannable, and avoids re-implementing a diff
viewer. The `summary` is authored client-side at the mutation site (which knows names and
intent); the server path (SF4) re-derives it from before/after.

---

## 3. Data model

### 3.1 Collection & document shape

A per-Pulse append-only subcollection, mirroring every other Pulse-scoped collection:

```
pulses/{pulseId}/changeLog/{entryId}
```

`entryId` is a Firestore auto-id for the client-emitted v1; for SF4 it is a
**deterministic id** derived from the source event (§4.5) so re-delivery is idempotent.

```ts
// src/types/index.ts (proposed) — additive; nothing existing changes.

export type ChangeEntityKind = "feature" | "epic" | "resource" | "member" | "invite"
                             | "pulse" | "comment";

export type ChangeVerb =
  | "create" | "delete" | "edit"
  | "status" | "assign" | "unassign" | "lead" | "move-epic" | "subtask"   // feature
  | "link" | "unlink"                                                     // resource
  | "add" | "remove" | "role-change" | "leave"                            // member
  | "link-created" | "link-revoked"                                       // invite
  | "rename" | "config" | "transfer"                                      // pulse
  | "post";                                                               // comment

/** One before/after pair for a curated high-signal field (§2.3). Values are
 * already display-projected (a resource id becomes its name-at-time), so the
 * timeline needs no extra lookups and old entries survive later renames/deletes. */
export interface ChangeFieldDelta {
  key: string;                 // e.g. "status", "lead", "role"
  before: string | null;      // display string, null when unset/added
  after: string | null;       // display string, null when cleared/removed
}

/** pulses/{pulseId}/changeLog/{entryId} — durable, shared, append-only. */
export interface ChangeEntry {
  id: string;
  actorUid: string;
  actorEmail: string;          // denormalized (see §3.3)
  actorName?: string | null;   // denormalized display name if available
  at: Timestamp;               // ms epoch; server path uses serverTimestamp()
  entityKind: ChangeEntityKind;
  entityId: string;            // the feature/epic/resource/member uid/etc.
  entityName: string;          // NAME-AT-TIME, denormalized (survives rename/delete)
  verb: ChangeVerb;
  summary: string;             // pre-rendered human line, e.g. "moved Login to In progress"
  changedKeys?: string[];      // field names touched (from DocOp.keys); optional
  deltas?: ChangeFieldDelta[]; // curated before/after (§2.3); optional
  /** Read-scoping denorm (§5.2): the linked account uids relevant to this entry
   * so a My-Beat Viewer's array-contains query returns only their-beat entries.
   * For a feature entry this equals the feature's assignedUids at write time;
   * empty/absent means "all members may see it" is decided by readScope, see §5.2. */
  scopeUids?: string[];
  /** Provenance so the UI can badge a still-forgeable v1 entry vs. an
   * authoritative SF4 one, and so SF4 can dedupe against a client draft (§4.5). */
  source: "client" | "server";
  clientKey?: string;          // idempotency key the client set (SF4 dedupes on it)
}
```

### 3.2 Field notes

- **`entityName` is name-at-time, denormalized.** Like `CommentRef.label`
  (`types/index.ts:124-128`), we snapshot the entity's name so a two-month-old entry
  still reads "renamed **Login page**" even after the task is renamed or deleted. No
  join, no dangling reference.
- **`actorEmail`/`actorName` denormalized.** Members can't read each other's `users/*`
  docs; the actor's email is already denormalized onto `PulseMember.email` and comments
  carry `authorEmail` (`Comment.authorEmail`). The log follows the same pattern so the
  timeline renders with zero extra reads.
- **`deltas` values are display strings, not raw ids.** A `lead` change stores
  `{before:"—", after:"Ana"}`, not resource ids — again so the entry is self-contained
  and rename/delete-proof.
- **`at`** is `Date.now()` for client-emitted entries and `serverTimestamp()` for SF4
  (authoritative ordering).

### 3.3 Denormalization & its maintenance

| Denorm | Filled by | Maintenance |
|---|---|---|
| `actorEmail`/`actorName` | writer (client or SF4) at write time | none — immutable snapshot |
| `entityName` | writer at write time | none — immutable snapshot |
| `scopeUids` (feature entries) | copied from the feature's `assignedUids` at write time | none — snapshot; a later assignment doesn't retro-change who saw the *old* entry (acceptable, §5.2 CL5) |

All denorms are **write-once snapshots** — there is no ongoing maintenance job (unlike
the `Feature.assignedUids` denorm, which SF1 keeps live). This is the cheapest possible
denorm posture: a log entry is immutable, so its snapshots never need updating.

### 3.4 Relationship to the undo `DocOp` shape — reuse the source, not the store

The undo engine's `DocOp` (`undoStore.ts:17-20`) already computes, per touched doc:
`kind`, `id`, `op` (`create`/`delete`/`patch`), and for patches `keys` + `before` +
`after`. **The change log reuses this as its raw input but projects it into a stable,
display-ready `ChangeEntry`** — it does **not** persist `DocOp` directly:

- `DocOp.keys` → `ChangeEntry.changedKeys`.
- `DocOp.before`/`after` for the curated fields → `ChangeEntry.deltas` (projected to
  display strings; ids resolved to names *now*, before they can change).
- The record `label` (e.g. `"Change status"`, `"Move task to epic"`) maps to `verb` +
  seeds the `summary`.

Why project rather than store `DocOp` verbatim: `DocOp` is optimized for *replay*
(exact field values, `null` semantics, pixel coordinates) and is meaningless to a human
two months later; it also holds raw ids that go stale. The log wants the human-facing,
rename-proof projection. Keeping them separate also lets undo stay purely local/ephemeral
(Undo-Spec.md) while the log is shared/durable — they must not be coupled. **They share a
capture *boundary* (§4.1), not a schema.**

---

## 4. Authoring: client vs. server

### 4.1 The shared capture boundary

Whoever authors the entry, the *trigger point* is the logical-action boundary already
established by `recordSingle`/`recordMany` (`pulseStore.ts`). Concretely we add a thin
`logChange(...)` recorder called from the same sites, gated so intermediate
(`{record:false}`) writes and the reconcile loop never reach it (§2.2). This guarantees
one entry per gesture and automatic exclusion of system writes, for free.

### 4.2 v1 — client-emitted (interim), with an honest trust model

**Recommendation for v1: client-emitted, create-only, immutable.** The client that made
the change also writes the `changeLog/{entryId}` doc, in the same batch where possible.

Rules make it **append-only and self-attributed** but cannot make it
**complete or truthful**:

```
match /changeLog/{entryId} {
  allow read:   if isPulseMember(pulseId) && (
                   callerReadScope(pulseId) == 'all'
                || (callerReadScope(pulseId) == 'beat'
                    && request.auth.uid in resource.data.get('scopeUids', [])));
  allow create: if isPulseMember(pulseId)
                && request.resource.data.actorUid == request.auth.uid   // can't impersonate
                && request.resource.data.source == 'client';
  allow update, delete: if false;                                       // append-only, even for owner
}
```

**Trust model, stated plainly:** a *cooperating* client produces a faithful log; a
*malicious or buggy* client can (a) **omit** entries (do the mutation, skip the log
write), (b) **mis-summarize** an entry, or (c) **spam** plausible entries for changes it
is allowed to make. Rules prevent only impersonation (`actorUid` pinned to the caller),
tampering, and deletion (`update/delete:false`). This is the *same* trust posture as the
already-shipped client-authored notifications (`notify.ts` →
`createNotification`) — so v1 is consistent with the codebase, not a regression. It is
**good enough for a collaboration/activity feed**, and **not** good enough for a
security-grade audit; §4.3 closes that gap.

### 4.3 Target — server-authored (authoritative), registered as SF4

**Recommendation: defer the authoritative log to a Cloud Function, registered as a new
`Server-Functions-Spec.md` SF4** (appended there by this task). Per the project
convention (Server-Functions-Spec §4), a "do it on the server later" decision must become
an `SF#`, not a loose TODO. SF4:

- Triggers `onDocumentWritten` on `features`, `epics`, `resources`, `pulseMembers`, the
  `pulses` doc (`invite`/`name`/config), and `comments` — the same mutation surface
  (§2.1).
- Diffs before→after **server-side**, so completeness and truthfulness no longer depend
  on the client. Under SF4, rules flip to `create: if false` for `source=='server'`
  (Admin SDK bypasses rules), making the log genuinely append-only-by-the-server and
  **not forgeable or omittable**.
- Re-derives `summary`/`deltas` from the trusted before/after; sets `source:'server'`,
  `at = serverTimestamp()`.

The v1 client log and SF4 are the same collection and schema; the migration is a
provenance flip (§4.5, §8). This mirrors SF2 exactly (client notifications now → server
notifications later), and SF4 can **share SF2's `features`/`comments` triggers** if they
ship together.

### 4.4 Not logging the reconcile's denorm-only writes

The `reconcileDenorms` loop (`pulseStore.ts:95-106`) writes `assignedUids`/`leadUid`-only
patches to features whenever resources/members/links change — a *system* write, not a
user change. Two guarantees keep these out of the log:

- **Client path:** the reconcile loop calls `updateFeature` **directly**, never
  `recordSingle`/`logChange` — so it is structurally unloggable (same reason it's not
  undoable).
- **Server path (SF4):** must compute `affectedKeys()` and **skip** any write whose
  changed keys are a subset of `{assignedUids, leadUid}` (a denorm-only reconcile). It
  must likewise skip its *own* prior writes. This is the direct analogue of SF1's
  "compare before/after to avoid loops" (Server-Functions-Spec §3 SF1).

Without this, every assignment would produce a *second*, confusing "system edited
assignedUids" entry. The exclusion is a first-class requirement, not an optimization.

### 4.5 Idempotency

- **Client v1:** at-most-once by construction (one write per gesture); a failed write is
  simply a dropped entry (fails *open*/silent — acceptable for an activity feed, and the
  reason SF4 exists). The client stamps a `clientKey` (e.g. `${pulseId}:${gestureTs}:${entityId}:${verb}`).
- **SF4:** Firestore delivers events at-least-once, so SF4 must be idempotent. Derive
  `entryId` deterministically from the **event id** (or a hash of
  `pulseId+entityId+verb+beforeUpdateTime`) and write with a fixed doc id, so a
  re-delivery overwrites rather than duplicates (Server-Functions-Spec §1, "recompute and
  write, never increment"). If a client draft (`source:'client'`, matching `clientKey`)
  already exists, SF4 **replaces it in place** with the authoritative `source:'server'`
  version — so the timeline never double-shows a change during the transition window.

---

## 5. Read access & permissions

### 5.1 Who can read — follow the caps model

**Recommendation:** reads gate on `isPulseMember` plus the caller's read scope, exactly
like `features` do today (`firestore.rules:219-222`). A full-scope member
(`callerReadScope == 'all'`: owner, editor, Full Viewer, Task Lead) reads the whole log.
This is one `get()` on the member doc — the same cost as every other Pulse read.

Team-cascade note: once the workspace/Team cascade lands (Collaboration-Spec §3.2), the
read gate OR-s in `isWorkspaceMember(...)` the same way the other collections will — the
change log is not special here.

### 5.2 My-Beat Viewer — scope the log to their beat

**Recommendation: a My-Beat Viewer sees only change entries about *their beat*** — i.e.
entries whose `scopeUids` contains their uid — mirroring how they only see their-beat
`features`. This reuses the exact enforcement crux from Permissions-Spec §4.3:

- The rule gates `beat` readers on `request.auth.uid in resource.data.get('scopeUids', [])`
  (§4.2). For a single `get` this is exact; for a **`list`** the client **must** issue
  `where("scopeUids","array-contains", uid)` — an unconstrained log list from a beat
  reader is rejected wholesale, not filtered. `subscribeChangeLog` therefore needs a
  beat-aware variant exactly like `subscribeFeatures(..., beatUid)`
  (`features.ts:15-18`).
- **`scopeUids` is set only for feature-derived entries** (copied from the feature's
  `assignedUids`). For non-feature entries (member/invite/pulse/resource-roster changes),
  a My-Beat Viewer has no "beat" relationship, so the recommendation is those entries are
  **not** in a beat reader's timeline at all (they're structural/administrative and
  arguably above a beat viewer's need-to-know). Alternative: surface pulse-level
  entries to everyone (CL5).
- **Snapshot semantics (accepted):** `scopeUids` is name-at-time, so if a task is later
  reassigned, the *old* entries keep their original audience. This is correct for an
  audit ("who could see this when it happened") and needs no maintenance (§3.3). Flagged
  CL5.
- **Composite index:** a lone `array-contains` on `scopeUids` needs no composite index
  (single-field). Keep the beat log query a bare `array-contains` and sort client-side
  (as `subscribeMyNotifications` already does, `notifications.ts:13`) to avoid a
  composite index; if we ever combine it with `orderBy at`, add one to
  `firestore.indexes.json`.

### 5.3 Is the full log a plan-gated feature?

**Recommendation: the log itself is available on every tier, but *history depth* is
plan-gated** (`entitlement ∧ capability`, Plans-Spec). Concretely:

- **Free:** a **recent window** (e.g. last 14 days / last 100 entries) — enough for
  "what changed lately".
- **Pro / Team:** **full retained history** (up to the retention cap, §7.2), plus filters
  (by actor, by entity, by verb) and per-task activity (§6.2).

This ties the log's *value* to the paid tiers without ever hiding *that a change
happened* from a collaborator on the free tier. Gating is read-time: the client requests
only the window it's entitled to; a stored `plan` entitlement flag (`changeLogHistory`)
is checked the same way `scopedRoles` is (Plans-Spec §3.1, §5). Because rules can't do
time-window range checks cheaply against the owner's plan without an extra `get`, the
depth limit is **client-enforced UX** (over-window entries simply aren't queried), with
retention pruning (§7.2) as the actual data-lifetime control. Flagged CL6.

---

## 6. UX

Consistent with the app's existing panels, badges, and avatar/`ResourceBadge` language.

### 6.1 Per-Pulse "Activity" panel

- A new **Activity** tab in the left panel (sibling to Team / Comments tabs), or a header
  "Activity" affordance, showing the reverse-chronological timeline.
- **Rows:** actor avatar (reuse the member avatar / `ResourceBadge` treatment, incl. the
  denormalized `photoURL` already on `PulseMember`) · a one-line `summary` · a **relative
  timestamp** ("2h ago", hover for absolute) · a small entity-kind icon/badge.
- **Grouping / collapsing bursts:** consecutive entries by the **same actor on the same
  entity within a short window** (e.g. 5 min) collapse into one expandable group ("Ana
  made 6 edits to Login") — the timeline analogue of the one-gesture-one-entry rule, for
  when someone does many separate gestures in a row. Prevents a flood from swamping the
  feed.
- **Filters (Pro/Team, §5.3):** by actor, entity, and verb; a "just status changes" or
  "just members" view.
- **Deep-link:** clicking an entry selects/opens its entity on the canvas/board (reuse
  the existing `selectedId` flow) when the entity still exists.

### 6.2 Per-task activity in the details panel

- The task **Details** panel gets an **Activity** section (next to its Comments) showing
  the entries for *that* feature (`where("entityId","==",featureId)`), so "history of this
  task" is one place. This is the most-requested slice and is a cheap filtered query.
- A subtle count/badge on the card (consistent with the existing comment-count badge)
  is optional (CL8) — likely noisy, so recommend **off by default**.

### 6.3 Consistency notes

- Relative timestamps and client-side sort match `notifications`/`comments` today.
- Empty state: "No activity yet — changes to tasks, epics, and members will show here."
- A small **provenance affordance** while v1 is client-emitted: entries are shown plainly
  (no "unverified" scare-badge — parity with notifications), but the design leaves room to
  add a subtle "verified" mark once SF4 is authoritative, if product wants it.

---

## 7. Retention & volume

### 7.1 Volume control — coalesce, don't stream

The single biggest risk is high-frequency writes flooding the log. Mitigations, in order:

1. **Log only at the settled-gesture boundary (§2.2, §4.1).** Canvas drags stream many
   intermediate writes with `{record:false}`; those are *already* excluded from undo and
   are excluded from the log by the same gate. One drag = one `edit` entry. This mirrors
   how undo coalesces (`MutateOpts`, Undo-Spec.md §5) and is the primary control.
2. **Debounce rapid same-field edits.** Typing in a title/notes field produces one
   settled `patchFeature` per field-commit, not per keystroke — the log inherits whatever
   the store already debounces. No separate debounce needed if the store commits on
   blur/settle.
3. **UI-side burst grouping (§6.1)** for the residual case of many distinct gestures in a
   row — presentation-only, doesn't reduce writes but keeps the feed readable.
4. **Server-side (SF4) drops denorm-only and no-op writes (§4.4).**

### 7.2 Retention / pruning

An append-only log grows without bound; it needs a lifetime policy.

- **Recommendation: a retention cap, plan-tiered** — e.g. **Free 30 days, Pro 1 year,
  Team 2 years** (numbers are product's, CL6). Older entries are pruned.
- **Mechanism:** Firestore **TTL policy** on a `expireAt` field (set at write time =
  `at + retentionForPlan`) is the cheapest — Firestore auto-deletes expired docs with no
  function needed. If the retention window must change with the owner's plan *after*
  write, a scheduled pruning function (register alongside SF4) recomputes/deletes; but for
  v1 a fixed `expireAt` at write time (using the plan at that moment) is simplest and
  recommended. Flagged CL6.
- Retention is **not** the free/paid *read* gate (§5.3) — it's the data-lifetime control.
  The two compose: Free users read a recent window of a 30-day-retained log.
- **Cost note:** entries are small (§2.3) and low-frequency (one per gesture); even a busy
  Pulse produces on the order of hundreds/day, well within Firestore economics. No
  counter/quota function is needed (unlike Plans-Spec PL5).

---

## 8. Migration & rollout

Phased, each independently shippable, no history backfill (a log starts the day it ships;
there's nothing to backfill and we explicitly don't invent past entries).

1. **Phase 1 — client-emitted log + read UI.** Add the `ChangeEntry` type, the
   `changeLog` rules block (§4.2, create-only/append-only, beat-scoped read), the
   `logChange` recorder wired at the `recordSingle`/`recordMany` sites, the
   `subscribeChangeLog` (full + beat-aware) service, and the Activity panel (§6.1) +
   per-task section (§6.2). Entirely serverless (rules + client), consistent with the
   shipped notifications posture. Log begins accumulating from deploy.
2. **Phase 2 — retention.** Add `expireAt` at write time + a Firestore TTL policy (§7.2).
   Set the plan-tiered depth gate in the read UI (§5.3).
3. **Phase 3 — SF4 (authoritative).** Deploy the Cloud Function (§4.3), flip rules to
   reject `source:'client'` creates once SF4 is proven, and let SF4 dedupe/replace client
   drafts during a short overlap (§4.5). This is the "audit-grade" upgrade; it shares
   SF2's trigger surface if notifications move server-side at the same time.

Rollback at any phase: stop writing new entries; the collection is inert and readable.
No destructive migration; no change to any existing type or collection (the whole feature
is additive under `pulses/{id}/changeLog/**` plus optional `Feature`-adjacent reads).

---

## 9. Open decisions (CL-list)

1. **CL1 — Collection name & superseding the `activity` placeholder.** *Recommend:*
   `pulses/{id}/changeLog/{entryId}`; update Collaboration-Spec §3.7 / D7 to point here
   and drop the `activity` name (avoids collision with presence). *Confirm.*
2. **CL2 — Granularity = one entry per logical action** at the
   `recordSingle`/`recordMany` boundary, streamed/`{record:false}` writes excluded.
   *Recommend & confirm.*
3. **CL3 — Curated before/after, not full diffs.** *Recommend:* `summary` + `changedKeys`
   always; `deltas` (before→after as display strings) only for the high-signal allow-list
   (§2.3). *Confirm the allow-list.*
4. **CL4 — v1 authoring = client-emitted, create-only, immutable**, same trust posture as
   shipped notifications; **SF4 is the authoritative target** (registered in
   Server-Functions-Spec). *Confirm client-first, server-hardened-later.*
5. **CL5 — My-Beat Viewer log scope.** *Recommend:* beat readers see only feature entries
   in their beat (via `scopeUids` array-contains, snapshot-at-time); non-feature
   (member/invite/pulse) entries are hidden from them. *Confirm, or elect to surface
   pulse-level entries to everyone.*
6. **CL6 — Plan gating: history depth + retention numbers.** *Recommend:* log on every
   tier; Free = recent window, Pro/Team = full history + filters; retention cap
   plan-tiered via `expireAt` + TTL. *Product to set the window/retention numbers and the
   `changeLogHistory` flag (Plans-Spec).*
7. **CL7 — Comment edit/delete & other low-value events.** *Recommend:* log comment
   `post` only; don't log comment edits/deletes, presence, or read events. *Confirm the
   catalogue in §2.1.*
8. **CL8 — Per-card activity badge.** *Recommend:* off by default (noisy); the per-task
   Activity section (§6.2) is the primary surface. *Confirm.*
9. **CL9 — Restore / time-travel is a non-goal.** Undo covers actor-side reversal; a
   general "restore to this entry" is deferred. *Confirm deferral.*
10. **CL10 — Cross-Pulse / workspace roll-up is a non-goal** this round (per-Pulse only).
    *Confirm; revisit with Teams.*
11. **CL11 — Idempotency keys.** *Recommend:* client stamps `clientKey`; SF4 uses a
    deterministic `entryId` from the event and replaces matching client drafts. *Confirm
    the dedupe strategy at SF4 build time.*
12. **CL12 — Provenance UI.** *Recommend:* no scare-badge on v1 client entries (parity
    with notifications); leave room for a subtle "verified" mark once SF4 is
    authoritative. *Confirm.*

> **Cross-refs:** capture boundary & op shape — `src/stores/undoStore.ts`,
> `src/stores/pulseStore.ts`; read-scope enforcement — `Permissions-Spec.md` §4.3 and
> `firestore.rules` (`callerReadScope`, `features` read); notifications sibling —
> `Collaboration-Spec.md` §3.6 / `src/components/comments/notify.ts`; server authoring —
> `Server-Functions-Spec.md` **SF4** (added by this spec); history/retention gating —
> `Plans-Spec.md` §3, §5.
