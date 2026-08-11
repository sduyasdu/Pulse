# Pulse — Hide & Archive Specification

Status: **Decisions confirmed (HA1–HA10) — ready to build** · Scope: splits today's single,
overloaded per-user "Archive" into two actions that mean what they say — **Hide** (per-user
dashboard filter) and **Archive** (shared, read-only lifecycle state). Expands the sketch in
`Collaboration-Spec.md` §3.10, which is the summary; this document is the build spec. Quota
behaviour is owned by `Plans-Spec.md` **PL12** and is restated here only where it constrains
the design (§7).

## 0. What this is (and isn't)

**Is:** the exact data model, rules delta, client wiring, copy, migration and test plan for
splitting one action into two.

**Isn't:** a retention or lifecycle-automation feature. Nothing here auto-archives, expires,
prunes, exports or tiers-down storage for old Pulses, and archiving never deletes anything.
It also isn't the BYOS `_Archive/` folder (`Storage-Spec.md` §6.3) — same word, unrelated
mechanism: that one is where *deleted* task folders go in the user's own Drive. §6 keeps the
two apart in the UI copy.

## 1. What ships today

### 1.1 The whole path

One toggle, four files:

- **Write:** `setMyPulseArchived(uid, pulseId, archived)` (`src/services/firestore/pulses.ts:157-163`)
  — a single `updateDoc` on `users/{uid}/myPulses/{pulseId}`.
- **Storage:** `MyPulseIndexEntry.archived?: boolean` (`src/types/index.ts:333-340`), on the
  self-owned dashboard index. Rules: `allow read, write: if request.auth.uid == uid`
  (`firestore.rules:118-120`) — nothing narrower is needed, because nothing else reads it.
- **Grouping:** the dashboard splits `subscribeMyPulses` three ways — owned / shared /
  archived (`src/routes/DashboardPage.tsx:86-90`), rendered as three sections
  (`DashboardPage.tsx:191-216`), each filtered by the name search.
- **Card:** the menu offers Archive/Unarchive (`src/components/dashboard/PulseCard.tsx:66-70`),
  the card dims and gets an "Archived" tag (`PulseCard.tsx:25,38,110-121`), and Invite is
  hidden while archived (`PulseCard.tsx:62`).

### 1.2 What it touches — and what it deliberately doesn't

`archived` is read **nowhere else**. Not in `firestore.rules`, not in `functions/`, not in
`entitlements.ts`, not in the Pulse itself. An "archived" Pulse:

- stays fully editable by you and everyone else;
- still appears in every other member's dashboard exactly as before;
- still notifies you, still syncs live, still counts against `maxPulses`;
- shows no trace of the state inside `PulsePage` at all.

It is a per-user card filter, and nothing more.

### 1.3 The two needs one action can't serve

They pull in opposite directions, which is why one flag can't carry both:

1. **"Get this off my dashboard."** Personal, no consequence for anyone else, reversible by
   you alone. Today's behaviour is exactly right for this — only the *name* is wrong.
2. **"This project is finished — freeze it."** Shared, visible to every member, and the
   whole point is that the data stops changing. Today's action can't express it: retiring a
   shared Pulse takes N manual archives (one per member, uncoordinated), signals nothing,
   and leaves the content editable by everyone forever.

The gap is doing active harm in one place already: the delete confirmation steers people to
archive as the safe alternative — *"Archiving instead keeps everything and just hides it from
your dashboard"* (`src/i18n/en.ts:155`, used at `DashboardPage.tsx:92-99`). Delete is global,
archive is personal, so the offered substitute doesn't do what the person asking to delete
wanted. §5.4 rewrites that copy.

## 2. The split

### 2.1 Definitions

| | **Hide** (per-user) | **Archive** (shared) |
|---|---|---|
| Scope | Your dashboard only | The Pulse, for every member |
| Who may | Any member, for themselves | **Owner only** (HA1) |
| Effect | Card moves to your **Hidden** section | Pulse becomes **read-only for all members** |
| Still editable? | Yes — nothing else changes | **No** — unarchive first |
| Visible to others | No | Yes — banner, chip, dashboard section |
| Counts against `maxPulses` | **Yes** | **Yes** — archiving is not quota relief (§7) |
| Reversible by | You | Any owner |
| Stored on | `users/{uid}/myPulses/{pulseId}.hidden` | `pulses/{pulseId}.archivedAt` |
| Enforced by | Nothing — it's a view filter | `firestore.rules` (§4) |

### 2.2 Hide — today's behaviour, renamed

No behavioural change of any kind: same access, same notifications, same edits, same live
sync, same quota. The rename *is* the feature — "archive" is the word that made people
expect a shared lifecycle state, and it will keep doing so as long as it's on that menu item.

A hidden Pulse still counts against quota because the quota is an **org-level** count and
hiding is a **per-user** preference. Letting it move the count would be incoherent (whose
hide wins, on a Pulse with five members?) and an obvious way to dodge the cap.

Hiding stays unenforced, and that's deliberate: it protects nothing, so there is nothing to
enforce. It remains a self-owned convenience cache, preserving the invariant from
`Collaboration-Spec.md` §1.6 that indexes are never security boundaries.

### 2.3 Archive — the shared freeze

An owner archives. Every member sees it archived. **Nobody** can edit it — including the
owner, including other owners — until an owner unarchives.

The freeze being *shared* is what makes read-only coherent. Nobody is locked out of
something their teammates can still change, and nobody can self-serve around it by flipping
their own flag. It's also what lets the state mean something: "archived" is now a fact about
the project, so it can be shown to everyone, logged, and reasoned about.

Owner-only (HA1) follows from the same logic: an action whose consequence lands on every
member belongs with the role that already carries the other Pulse-wide consequences — delete,
role changes, member removal (`firestore.rules:175,198,207`). An editor freezing an owner's
Pulse out from under them is the wrong default; an owner can always delegate by promoting.

### 2.4 What Archive is not

Stating these because each one is a plausible reading of "archive" that this feature
explicitly refuses:

- **Not a delete, and not a step toward one.** Nothing is removed, nothing expires, no
  retention clock starts. An archived Pulse is complete and readable forever.
- **Not quota relief.** §7. This is the single most important thing for the UI never to imply.
- **Not an access change.** Members stay members, roles stay roles, reads are untouched —
  including the scoped read of a My-Beat Viewer (`firestore.rules:257-260`).
- **Not a delete guard.** An owner may still delete an archived Pulse, and §4.4 makes sure
  the machinery actually permits it — because `Plans-Spec.md` §5.1 makes deleting an archived
  Pulse *the* intended way to reclaim a slot.
- **Not a storage tier.** Archived data lives in exactly the same collections, costing
  exactly the same.

## 3. Data model

Two additive fields and one rename. Conventions follow `types/index.ts` — millis
`Timestamp`, `null`-not-`undefined` for clearable fields.

```ts
// pulses/{pulseId}                 — ADD the shared archive state (§2.3)
//   archivedAt?: Timestamp | null   // null/absent = active; set => read-only for ALL
//   archivedBy?: string | null      // uid of the owner who archived it

// users/{uid}/myPulses/{pulseId}   — RENAME the per-user flag (§2.2)
//   hidden?: boolean                // was `archived`; a dashboard filter, nothing more
//   archivedAt?: Timestamp | null   // DENORMALIZED cache of the Pulse's state, for the
//                                   // dashboard chip only — never a security boundary
```

Three notes on why the shapes are these:

- **`archivedAt` is a timestamp, not a boolean**, so "archived" and "when" are one field
  rather than two that can disagree, and the activity log's rendering has a date without a
  second lookup. `null` is the active state; absent reads the same via
  `resource.data.get('archivedAt', null)`.
- **`archivedBy` is for display, not authority.** Rules never consult it (any owner may
  unarchive, not just the one who archived) — it exists so the banner can say who froze it.
- **The `archivedAt` mirror on the index entry costs nothing.** The dashboard's self-heal
  loop already fetches each Pulse doc to reconcile the denormalized name
  (`DashboardPage.tsx:64-68`), so the archived state can be written into the index in that
  same pass — no extra read, no new query, no listener. Cards are one-shot fetches with no
  live listener by design (`usePulseSummary.ts:12-17`), so this is the only way to get the
  chip on the card without adding a subscription per card. It is a cache: stale by at most
  one dashboard load, and load-bearing for nothing — the actual freeze is enforced in rules
  against the Pulse doc itself.

**No new Firestore index.** `myPulses` is listed whole and filtered in memory
(`pulses.ts:139-142`); `hidden` and the mirrored `archivedAt` change nothing about the query.
(When Teams lands and team Pulses are listed via a filtered `pulses` query —
`Collaboration-Spec.md` §4 — an `workspaceId + archivedAt` composite index may be wanted; out
of scope here.)

## 4. Security rules — the freeze

### 4.1 There is no single chokepoint

`Collaboration-Spec.md` §3.10 says `canEditPulse` is a chokepoint that freezes every write
path with one clause. **Against the shipped rules, it isn't** — and shipping that way would
leave an "archived" Pulse with fully editable tasks. Only three call sites actually route
through `canEditPulse` today. The real map:

| Collection | Today's write gate | Freeze? | Change |
|---|---|---|---|
| `pulses/{p}` (update) | `canEditPulse` (`:172-174`) | **Yes** | freeze + pin archive fields + escape clause (§4.3) |
| `epics` | `canEditPulse` (`:250`) | **Yes** | split `write` into create/update (frozen) and delete (§4.4) |
| `resources` | `canEditPulse` (`:286`) | **Yes** | same split |
| `features` | `callerEditScope` (`:264-270`) | **Yes** | **not** covered by `canEditPulse` — needs its own clause |
| `costs` | `callerEditScope` / `leadsFeature` (`:309-319`) | **Yes** | same |
| `rates` | `canViewPeopleCost`, `read, write` combined (`:293-295`) | **Yes**, writes only | must split `read` from `write` — freezing the read would break cost views for admins |
| `comments` | `isPulseMember` (`:278-281`) | **Yes** (HA2) | create/update frozen; delete follows §4.4 |
| `pulseMembers` | own rules (`:179-207`) | **No** | roster management still works (§4.5); joins go inert (§4.6) |
| `presence` | self-write (`:245`) | **No** | people still read an archived Pulse |
| `notifications` | `isPulseMember` (`:232-235`) | **No** | frozen content means few of these anyway; blocking them buys nothing |
| `activity` | `isPulseMember` (`:332-334`) | **No** | the log is history — and the archive event itself is logged (§6) |
| `users/{uid}/myPulses` | self-write (`:118-120`) | **No** | hiding, renaming your own card, self-heal — all still work |

The one-line rule this table encodes: **while archived, nothing under `pulses/{p}/**`
changes except the archive flag itself, the roster, and per-user ephemera.**

Comments freeze with everything else (HA2). A comment doesn't alter the plan, so keeping
them open is defensible — but "read-only for all members" has to be true without a footnote,
and a thread nobody can act on is a worse affordance than a clean freeze. Discussion resumes
the moment an owner unarchives.

### 4.2 `isPulseActive`, and the pulse doc's free read

```
function isPulseActive(pulseId) {
  return get(/databases/$(database)/documents/pulses/$(pulseId)).data.get('archivedAt', null) == null;
}
```

Inside `match /pulses/{pulseId}` **for the pulse doc itself**, don't call this — `resource.data`
is already loaded, so the freeze there is `resource.data.get('archivedAt', null) == null` at
zero cost. The `get()` is only for subcollections.

### 4.3 The escape clause — archive / unarchive

The archive write is the one write that must cross its own freeze:

```
match /pulses/{pulseId} {
  allow read: if isPulseMember(pulseId);

  allow create: if isSignedIn()
    && request.resource.data.createdBy == request.auth.uid
    && request.resource.data.get('archivedAt', null) == null;   // never born archived

  allow update: if
    // (a) the archive / unarchive write itself — owner only, and nothing else may ride along
    (isPulseOwner(pulseId)
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['archivedAt', 'archivedBy', 'updatedAt'])
      && (request.resource.data.get('archivedAt', null) == null
            ? request.resource.data.get('archivedBy', null) == null
            : request.resource.data.get('archivedBy', null) == request.auth.uid))
    ||
    // (b) every other update: today's rule, plus the freeze and a pin on the archive fields
    (canEditPulse(pulseId)
      && resource.data.get('archivedAt', null) == null
      && request.resource.data.get('archivedAt', null) == resource.data.get('archivedAt', null)
      && request.resource.data.get('archivedBy', null) == resource.data.get('archivedBy', null)
      && (request.resource.data.get('invite', null) == null
          || request.resource.data.invite.role in ['viewer', 'editor', 'taskLead', 'myBeatViewer']));

  allow delete: if isPulseOwner(pulseId);   // unchanged — §4.4
}
```

Why each guard earns its place:

- **`hasOnly([...])`** stops an editor smuggling a rename or a config change into the same
  write as an unarchive, and stops the archive write from being a general-purpose bypass.
- **The `archivedBy` ternary** pins the field to the caller when archiving and to `null` when
  unarchiving, so the banner's "archived by" can't be forged and can't go stale.
- **Pinning both fields in branch (b)** means the ordinary edit path can never touch archive
  state even while the Pulse is active — the only way in or out is branch (a).
- **`create` refuses a born-archived Pulse**, so `duplicatePulse` (`pulses.ts:68-137`) can't
  copy the state forward by accident: a duplicate of an archived Pulse is always active (§6).

### 4.4 Deleting an archived Pulse must keep working

This is the trap. `deletePulse` (`pulses.ts:213-229`) is a **client-side cascade**: it
deletes `invites`/`epics`/`features`/`resources`, then the pulse doc, then `pulseMembers`
last. Those subcollection deletes go through the same edit gates the freeze is about to
close — so a naive freeze makes an archived Pulse **undeletable**, and `Plans-Spec.md` §5.1
depends on deleting an archived Pulse being "an easy, obvious path" to reclaim a slot. The
feature would break the one route out of the cap it's supposed to leave open.

**Decided (HA4): an owner-delete exemption on every content subcollection.** Deletes stay
allowed for owners regardless of archive state; creates and updates freeze for everyone:

```
match /epics/{epicId} {
  allow read: if isPulseMember(pulseId);
  allow create, update: if canEditPulse(pulseId) && isPulseActive(pulseId);
  allow delete: if canEditPulse(pulseId)
    && (isPulseActive(pulseId) || pulseRole(pulseId) == 'owner');
}
```

…and the same `(isPulseActive(pulseId) || pulseRole(pulseId) == 'owner')` tail on the delete
arm of `resources`, `features`, `costs` and `comments`.

This grants nothing new: an owner can already delete the entire Pulse and everything in it
(`firestore.rules:175`). It just keeps that power reachable one document at a time, which is
how the client implements it. The principle it encodes — **archive stops quiet mutation, not
destruction** — is worth stating in the rules comment, because the alternative reading
("archived data is protected data") is the one people will assume.

**The server-side cascade already exists, and does not remove the need for this.**
`onPulseDelete` (SF6, `functions/src/cascade.ts:30-47`, deployed) fires on the pulse doc's
deletion and `recursiveDelete`s the whole remaining tree plus every member's `myPulses`
entry. So the client pass is a best-effort head start, not the whole teardown — but it still
has to **reach** the pulse-doc delete, and it deletes subcollections first
(`pulses.ts:245-256`). Without the exemption, the very first `epics` delete throws, the
function aborts before the pulse doc is touched, SF6 never fires, and the Pulse survives.
The exemption is what lets an archived Pulse be deleted at all.

Alternative considered and rejected: *unarchive-then-delete* in the client — a non-atomic
multi-step flow that leaves the Pulse unfrozen for everyone if the delete fails midway.

(A cleaner future refactor: delete the pulse doc **first** and let SF6 own the rest, since
`isPulseOwner` on that delete is unaffected by the freeze. Out of scope here — the current
order is deliberately defensive about the function not running.)

### 4.5 What stays writable while archived

- **Roster management.** An owner may still change roles and remove members
  (`:198-207`), and any member may still leave (`:207`). Archive freezes the *plan*, not the
  *people* — and an owner who can no longer manage a finished project's roster has lost
  something for no benefit.
- **Your own member doc.** The self-update path that keeps `photoURL` denormalized
  (`:198-205`, written by `PulsePage.tsx:123-127`) is unaffected — it's presentation data
  about you, not content.
- **Presence heartbeats** (`:243-246`) — people still open and read archived Pulses.
- **The activity log** (`:327-336`) — append-only history, and the archive event itself is an
  entry (§6).
- **Your dashboard index** (`:118-120`) — hide/unhide, rename-your-card, and the self-heal
  loop all keep working.

### 4.6 Join links go inert (HA3)

A copy-link join validates against `pulses/{p}.invite` via `joinLinkOk`
(`firestore.rules:103-108`, Case 3 at `:191-193`). While archived, that path closes:

```
// Case 3: joining via a valid copy-link — not while the Pulse is frozen (HA3)
joinLinkOk(pulseId, request.resource.data) && isPulseActive(pulseId)
```

A link circulating before the freeze would otherwise keep growing the roster of a project
that has explicitly finished, silently, with nobody able to act on the new arrival. Because
the pulse doc is frozen (§4.3 branch b), the link also can't be rotated or revoked while
archived — so "inert until unarchived" is the only coherent state, and the Share UI says so
rather than appearing to work.

Note the ordering consequence: an owner who wants to add someone to a finished Pulse
unarchives, adds them, re-archives. That's three steps for a rare action, which is the right
trade against a link that quietly outlives the project.

### 4.7 The `get()` budget

Firestore allows 10 document accesses per single-document request (20 for multi-document),
and repeated reads of the *same* path within one evaluation are cached by the rules engine
rather than re-counted. So the freeze costs **one additional distinct document** — the pulse
doc — on subcollection writes that already read `pulseMembers`:

| Write | Distinct docs read | Before → after |
|---|---|---|
| epic/resource create | `pulseMembers`, `pulses/{p}` | 1 → 2 |
| feature update (editor) | `pulseMembers`, `pulses/{p}` | 1 → 2 |
| feature delete (owner) | `pulseMembers`, `pulses/{p}` | 1 → 2 |
| cost create (task lead) | `pulseMembers`, `features/{f}`, `pulses/{p}` | 2 → 3 |
| pulse doc update | none (uses `resource.data`) | 0 → 0 |

Well inside the budget, but it is not free and it is on the hot write path — worth measuring
if the billing gates (`Plans-Spec.md` §4, which also `get()`s `billing/{orgId}`) land on the
same rules later. §10 pins the caching assumption with an emulator test rather than trusting
it.

The rejected alternative is copying the flag onto every subcollection document: it removes
the `get()` but can go stale, needs a fan-out write to set, and turns one archive click into
an unbounded batch.

## 5. Client

### 5.1 One derivation point: the edit lock

`PulsePage` derives everything editable from one value:

```ts
const editScope = myMember ? capsOf(myMember).editScope : "none";
const canEdit = editScope === "all";
```
(`PulsePage.tsx:101-112`)

Archive folds in **there**, and nowhere else. An archived Pulse resolves to
`editScope: "none"`, and every existing disabled state, drag guard, hidden control, keyboard
shortcut (`PulsePage.tsx:131-148`) and undo entry point follows automatically with no
per-component work. The same fold covers `MobilePulseView`, which takes `canEdit` as a prop
(`MobilePulseView.tsx:32`).

Following the `planNotice.ts` pattern — pure, React-free, unit-testable — the derivation
belongs in a small domain module:

```ts
// src/domain/pulseLock.ts
export type LockReason = "archived" | "plan" | null;

/** Why this Pulse is read-only for this member, or null if it isn't.
 *  Archive outranks the plan lock (§5.6): both make it read-only, but only
 *  archive is something a person here can act on. */
export function pulseLock(pulse: Pulse | null, planLocked: boolean): LockReason;

/** The member's effective edit scope once the lock is applied. */
export function effectiveEditScope(caps: Capabilities, lock: LockReason): EditScope;
```

### 5.2 In-Pulse surfaces

Read-only has to be *explained*, not just enforced, or it reads as a bug:

- **A persistent banner** at the top of the Pulse — *"This Pulse is archived. Unarchive it to
  make changes."* with an **Unarchive** button for owners, and *"Ask an owner to unarchive
  it"* for everyone else. Same slot and visual language as `PlanBanner`
  (`PlanBanner.tsx:36-48`), but **not dismissible**: a delinquency notice is a deadline, this
  is the current state of the thing you're looking at.
- **An "Archived" chip in the Toolbar**, beside the role chip (`Toolbar.tsx:144`), so the
  state is visible even after the banner scrolls out of a mobile viewport. The name input is
  already `disabled={!canEdit}` (`Toolbar.tsx:136`), so it locks itself via §5.1.
- **A swallowed-edit notice.** Any edit that slips past a disabled state — keyboard shortcut,
  drag, paste, an in-flight write racing a remote archive — is swallowed and surfaces the same
  message as a transient notice, reusing the undo toast channel (`undoStore.toast`,
  `PulsePage.tsx:94-99`), rather than failing silently or surfacing a raw rules error.
- **Live transition.** The Pulse doc is already a live subscription (`pulseStore.ts:108-122`),
  so a member with the Pulse open when an owner archives sees the banner appear and the
  controls disable without a reload. The reverse holds for unarchive.

### 5.3 Dashboard

Four sections, in order: **Your Pulses**, **Shared with me**, **Archived**, **Hidden**
(`DashboardPage.tsx:191-216`). Placement rules:

- `hidden` wins over `archivedAt`. Hiding is the user's explicit "get this off my dashboard",
  and a hidden Pulse that reappeared in an Archived section would defeat it.
- Otherwise `archivedAt != null` → **Archived**; else owner → **Your Pulses**, non-owner →
  **Shared with me**. (Today's grouping is `DashboardPage.tsx:86-90`.)
- The name search spans all four, unchanged.
- Both sections render only when non-empty, as Archived does today (`:211`).

Card (`PulseCard.tsx`):

- **Chips:** "Archived" (existing `card.archivedTag`, `:117-121`) driven by the mirrored
  `archivedAt`; "Hidden" as a second, quieter chip.
- **Menu:** `Hide` / `Unhide` for everyone; `Archive` / `Unarchive` **for owners only**
  (HA1) — mirroring how `Delete` is already owner-gated and `Leave` shown otherwise
  (`:71-95`).
- **Disabled while archived:** Rename and Invite (both are writes to the frozen pulse doc).
  Invite is already hidden when archived today (`:62`) — that guard survives the split
  pointing at the new field. Duplicate stays enabled (§6).

### 5.4 Confirmation & copy

- **Archiving asks**, naming the consequence: *"Archiving makes this Pulse read-only for all
  N members. Any owner can unarchive it."* via `confirmAt` (`confirmStore.ts:38+`), the same
  anchored popover delete and leave already use (`DashboardPage.tsx:92-108`).
- **Hiding does not ask.** It affects nobody and is one click to undo.
- **Unarchiving does not ask.** It restores the status quo.
- **The delete confirmation is rewritten.** Today it offers archiving as the gentle
  alternative (`en.ts:155`) — the exact conflation this spec removes. New copy points at the
  right one of the two: *"This erases the Pulse and all its data for everyone — it can't be
  undone. To keep the data but stop changes, archive it instead. To just clear it off your own
  dashboard, hide it."*
- **Nothing anywhere may imply archiving frees a slot** (§7). Where the plan-limit message
  offers a way forward, the routes are **delete** and **upgrade** —
  `Plans-Spec.md` §5.1 — with deleting an *archived* Pulse called out as the natural one.

### 5.5 Mobile

`MobilePulseView` takes `canEdit` (`MobilePulseView.tsx:32`) and gates its add/edit affordances
on it (`:87,126-134`), so the freeze arrives for free via §5.1. It needs the banner rendered
above the tab content, and the Archived chip in its header.

### 5.6 Precedence with the plan read-only lock

Two different mechanisms can make a Pulse read-only: this one, and the over-limit lock on a
Starter downgrade (`Plans-Spec.md` §5.1, client-derived). They must not both shout.

**Archive wins the banner.** Precedence is by actionability: an owner can clear an archive
right now with one click, whereas the plan lock clears only by deleting another Pulse or
upgrading. If both apply, show the archived banner; unarchiving then reveals the plan banner,
which is honest — the Pulse really is still locked, for a different reason. `pulseLock()`
(§5.1) returns the single winning reason so this can't drift between surfaces.

**Status: the plan half is not wired, deliberately.** `PulsePage` passes
`planLocked = false`, because PL4's over-limit lock doesn't exist yet *and cannot be derived
from a Pulse page*: it needs the org's Pulses ordered by `createdAt`, and there is no `list`
rule on the top-level `pulses` collection to fetch them (that rule arrives with Teams,
`Collaboration-Spec.md` §4). The precedence logic and its unit tests are complete for both
reasons, so PL4 changes exactly one line. Two things for whoever builds it: the over-limit
set counts **archived Pulses too** (PL12/HA8), and the affordance is **delete or upgrade** —
never "archive something to make room".

### 5.7 The last owner may not leave (HA10)

**Invariant: a Pulse always has at least one owner.** The last owner cannot remove
themselves — the exits are **Archive** (keep everything, stop the changes) or **Delete**
(remove it entirely), and handing the project on is **Transfer ownership**. Leaving is not
one of the three.

This is what makes every owner-gated action in this spec safe to depend on. Archive,
unarchive, delete and promote all require a live owner; a Pulse that loses its last one is
stuck in whatever state it was in, and an *archived* ownerless Pulse is frozen and
unreclaimable forever while still consuming a `maxPulses` slot (§7). The invariant closes
that off at the source rather than trying to recover from it.

**Client.** The guard already ships — `canLeave = myRole !== "owner" || ownerCount > 1`
(`CollaboratorsDialog.tsx:38`), with Leave shown only to non-owners on the card
(`PulseCard.tsx:71-95`). What changes is that the dead end becomes a **choice**. Today a sole
owner gets a passive hint: *"Sole owner — transfer to leave"* (`en.ts:269-270`). It becomes a
short block offering the three real routes, each wired to the action it names:

> **You're the only owner, so you can't leave this Pulse.**
> **Archive it** to make it read-only and keep everything · **Delete it** to remove it for
> everyone · or make someone else an owner first.

Archive is listed first: it is the non-destructive answer to "I'm done with this", which is
what someone reaching for Leave usually means. Delete carries its existing confirmation
(`DashboardPage.tsx:92-99`); Archive carries the one from §5.4.

**Rules backstop.** The client guard reads `ownerCount` from the live roster, which is
correct but not enforceable: `firestore.rules:207` permits `memberUid == request.auth.uid`
self-delete unconditionally, and rules cannot count a collection, so "is there another
owner?" is not expressible without a denormalized counter. The enforceable approximation
costs one `get()` already being made:

```
// An owner may never self-delete: transfer first, or archive/delete the Pulse (HA10).
// Strictly stronger than "last owner" — rules can't count owners — and it fails safe.
allow delete: if (isPulseOwner(pulseId) && memberUid != request.auth.uid)
  || (memberUid == request.auth.uid && pulseRole(pulseId) != 'owner')
  // Tear-down: deletePulse() removes the pulse doc and THEN every pulseMembers
  // doc, the caller's own included. Without this an owner could not finish
  // deleting their own Pulse. Once the pulse doc is gone the roster is orphaned
  // bookkeeping and there is no owner left to protect.
  || (memberUid == request.auth.uid
      && !exists(/databases/$(database)/documents/pulses/$(pulseId)));
```

Two clauses that look redundant and are not. **`memberUid != request.auth.uid` on the owner
branch**: "an owner may remove anyone" otherwise re-permits an owner removing *themselves*,
and the invariant is worth nothing — this was caught by the rules test, not by reading.
**The tear-down clause**: without it the freeze-shaped trap of §4.4 reappears one collection
over, and an owner cannot finish deleting their own Pulse. It can't be used to strand
anything, because it only opens once the Pulse itself is gone.

**The consequence to accept:** this also stops a *non-last* owner self-serving a leave. In a
two-owner Pulse, an owner who wants out either self-demotes to editor first (permitted by the
`isPulseOwner` branch of the update rule at `:198`, and the client's "can't change your own
role" guard at `:124` needs a carve-out for demote-while-another-owner-exists) or asks their
co-owner to remove them (already allowed). That is a rare action with two working paths, and
the trade buys an invariant that holds against a concurrent double-leave and against anything
calling the API outside the UI — which the client-only guard cannot.

The alternative — leave the rule as-is and keep the invariant advisory — is viable and
cheaper; it just means the guarantee everything else here leans on is only as good as the
current UI. Recorded as HA10's runner-up, not the recommendation.

## 6. Interactions across the product

| Area | Interaction |
|---|---|
| **Undo/redo** (`Undo-Spec.md`) | Undo entry points are already gated on `canEdit` (`PulsePage.tsx:131-148`), so they disable with the freeze. The in-memory stack is per-Pulse and dropped on navigation (`PulsePage.tsx:89-92`) — nothing to purge. **Archiving is not itself undoable**: it's a Pulse-lifecycle action, outside the content command stack, and it is confirmed instead (§5.4). |
| **Activity log** (`Changelog-Spec.md`) | Two new verbs on `ActivityVerb` (`types/index.ts:215-221`): `archive`, `unarchive`, `entityKind: "pulse"`, written through the existing member/pulse-event path (`activityRecorder.ts:191-222`). The `activity` collection stays writable while archived (§4.5) — otherwise the archive event couldn't be logged at all, and unarchiving would leave a gap in the history. |
| **Comments** | Frozen (HA2, §4.1). Existing threads stay readable; the composer is disabled with the same banner explanation. |
| **Notifications** | No new notification type in v1 (HA5). `Notification.type` is `"comment"`-only today (`types/index.ts:280-291`); the archived state is loud where it matters — a banner on open and a dashboard section. Revisit when the notification surface grows beyond comments. |
| **Costs** (`Costs-Spec.md`) | `costs` writes freeze (§4.1); `rates` **reads must not** — the `allow read, write` pair (`firestore.rules:293-295`) has to be split so an admin can still open the cost view of a finished project. Cost *reporting* on archived Pulses is the point of keeping them. |
| **Permissions** (`Permissions-Spec.md`) | Orthogonal: archive lowers everyone's *edit* scope to none and leaves *read* scope untouched, so a My-Beat Viewer's `array-contains` query (§4.3 there) behaves identically. `capsOf` (`permissions.ts:42-44`) stays the role/caps source of truth; the lock is applied on top of it (§5.1), never written into `caps`. |
| **Kanban** (`Kanban-Spec.md` §8) | Drag-to-move is `canEdit`-gated already; the board renders read-only with no per-component change. |
| **Duplicate** | Duplicating an archived Pulse produces an **active** copy — `duplicatePulse` builds a fresh doc (`pulses.ts:68-80`) and the create rule refuses a born-archived one (§4.3). This is deliberate: "start again from the finished thing" is a real workflow, and it doesn't touch the frozen original. Duplicate therefore stays enabled in the card menu while archived. |
| **Teams** (`Collaboration-Spec.md` §3.2) | When team membership cascades access, the freeze sits *outside* the role union: `isPulseActive` ANDs with whatever the effective role resolves to, so a team editor is frozen exactly like a per-Pulse editor. Team-Pulse listing will want the composite index noted in §3. |
| **BYOS** (`Storage-Spec.md`) | Unrelated to `_Archive/{YYYY-MM}/`, which is where *deleted* task folders go in the user's Drive. Never use the word "archive" for that in user-facing copy; and since archiving freezes task mutations, the reconciler simply has nothing to do on an archived Pulse. |
| **Ownerless Pulses** | Ruled out by the always-an-owner invariant (**§5.7 / HA10**): the last owner may not leave — they archive, delete, or transfer. Every owner-gated action in this spec depends on that, since an archived Pulse with no owner would be frozen, undeletable, and still holding a `maxPulses` slot (§7) forever. Enforced exactly in the client (`CollaboratorsDialog.tsx:38`) and approximately in rules (no owner may self-delete — rules can't count owners). |

## 7. Quota

Owned by `Plans-Spec.md` **PL12** and §3.2; restated because the UI must never contradict it:

**"Pulses per org" counts every Pulse the org holds — archived and hidden alike.** The quota
measures what the org *stores*, not what it may currently edit. Consequences for this feature:

- `workspace.pulseCount` needs **no** archive awareness — SF11 moves it on create and delete
  only (`Plans-Spec.md` §5, `Backend-Architecture-Spec.md`). Archive/unarchive and hide/unhide
  never touch it.
- **Unarchive needs no quota check.** It can't raise the count, so it can never take an org
  over its cap — which is precisely why counting archived Pulses is also the *simpler* rule.
- **The archive UI must never offer itself as a way to make room.** An org at 3/3 on Starter
  that archives all three still cannot create a fourth. The routes are delete or upgrade
  (§5.4).
- This feature is therefore **independent of the billing work** and can land before or after
  the counter function.

## 8. Migration & rollout

Existing `myPulses.archived` entries carry today's *personal* meaning, so they migrate to
`hidden` — **never** to the new shared archive, which would surprise the other members of
every Pulse anyone had tidied away.

No backfill job and no rules change: the index is self-owned and already self-heals
(`Collaboration-Spec.md` §1.6), so the dashboard's existing reconcile loop
(`DashboardPage.tsx:49-77`) carries it. In the same pass that reconciles role and name:

```ts
// One-pass rename, converges per user on their next dashboard load.
if (p.archived !== undefined && p.hidden === undefined) {
  await setMyPulseHidden(uid, p.pulseId, p.archived);   // writes `hidden`, deletes `archived`
}
// Same pass, no extra read — the Pulse doc is already fetched at :64 for the name.
if ((pulse?.archivedAt ?? null) !== (p.archivedAt ?? null)) {
  await updateMyPulseArchivedAt(uid, p.pulseId, pulse?.archivedAt ?? null);
}
```

Reads stay back-compatible for one release — `const hidden = entry.hidden ?? entry.archived ?? false`
— so a user on a stale tab isn't shown a dashboard that forgot what they'd tidied away. Drop
the fallback, and `MyPulseIndexEntry.archived`, one release later.

Rollout order matters for exactly one reason: **the rename must not ship in the same release
as the freeze**, or a user who archived ten Pulses last week gets a release note about
read-only Pulses and reasonably assumes theirs are frozen. Phase 1 (§11) is the rename alone.

## 9. i18n

All six dictionaries (`src/i18n/{en,es,pt,fr,de,it}.ts`) move together — the app resolves keys
per language with no fallback chain, so a missing key is a visible gap.

| Key | English | Note |
|---|---|---|
| `dashboard.hidden` | Hidden | new section heading |
| `dashboard.archived` | Archived | **kept**, meaning changes: now the shared state |
| `dashboard.archiveMessage` | Archive "{name}"? | new confirm |
| `dashboard.archiveDetail` | Makes this Pulse read-only for all {n} members. Any owner can unarchive it. | new |
| `dashboard.archiveConfirm` | Archive | new |
| `dashboard.deleteDetail` | *(rewritten — §5.4)* | no longer conflates archive and hide |
| `card.hide` / `card.unhide` | Hide / Unhide | new menu items |
| `card.archive` / `card.unarchive` | Archive / Unarchive | **kept**, now owner-only |
| `card.hiddenTag` | Hidden | new chip |
| `card.archivedTag` | Archived | kept |
| `pulse.archivedBanner` | This Pulse is archived. Unarchive it to make changes. | owner variant |
| `pulse.archivedBannerMember` | This Pulse is archived. Ask an owner to unarchive it to make changes. | non-owner |
| `pulse.archivedBy` | Archived by {name} on {date} | banner detail |
| `pulse.unarchive` | Unarchive | banner action |
| `pulse.archivedChip` | Archived | Toolbar chip |
| `pulse.frozenNotice` | This Pulse is archived — changes are turned off. | swallowed-edit toast |
| `collab.soleOwner` | You're the only owner, so you can't leave this Pulse. | **rewritten** — was "Sole owner — transfer to leave" (§5.7) |
| `collab.soleOwnerArchive` | Archive it to make it read-only and keep everything. | new, actionable |
| `collab.soleOwnerDelete` | Delete it to remove it for everyone. | new, actionable |
| `collab.soleOwnerTransfer` | Or make someone else an owner first. | **rewritten** from `collab.soleOwnerTitle` |
| `collab.demoteSelf` | Step down to Editor | new — the multi-owner self-demote path (§5.7) |

Existing `card.archive`/`card.unarchive`/`card.archivedTag`/`dashboard.archived` keep their
strings in every language; only their *meaning* narrows, which is invisible to translators.
The `_Archive` folder of `Storage-Spec.md` never uses these keys.

Help content (`src/help/en.ts`, the `collab` topic at `:102-116`) gains two bullets — **Hide**
and **Archive** — because a shared read-only state that isn't documented will be filed as a
bug. Per `Help-Spec.md` §4, help copy lives in the help module, not the dictionaries.

## 10. Testing

**Rules** (`rules/security.test.ts`, new `describe("hide & archive")` block — the emulator
suite that already covers roles and scoped permissions at `:122-291`):

1. An owner may archive; an **editor may not** (HA1); a viewer may not.
2. Archived: editor create/update on `epics`, `features`, `resources`, `costs`, `comments`
   all **fail**; the same writes succeed after unarchive.
3. Archived: an **owner's deletes succeed** across every content subcollection, and the full
   `deletePulse` cascade completes (§4.4) — the regression this feature most plausibly ships.
4. Archived: `rates` **read succeeds** for an admin while `rates` write fails (§4.1).
5. Archive escape clause: an owner update touching `archivedAt` + `name` **fails**
   (`hasOnly`); `archivedBy` forged to another uid **fails**; unarchive with a non-null
   `archivedBy` **fails**.
6. An editor may not set `archivedAt` through the ordinary update path (branch b pinning).
7. Archived: a valid join link **fails** to create a membership (HA3); succeeds after
   unarchive.
8. Archived: presence write, own-member photo self-update, activity append, and
   `myPulses` self-write all still **succeed** (§4.5).
9. Reads are entirely unaffected, including a My-Beat Viewer's `array-contains` query.
10. `get()` accounting: a feature update by an editor on an archived Pulse stays within
    budget, pinning the same-path caching assumption in §4.7.
11. **Always-an-owner (§5.7):** an owner's self-delete **fails**, archived or not, sole or
    not; a non-owner's self-delete succeeds; an owner who self-demotes to editor may then
    leave; a co-owner may still remove an owner. The regression this guards is the one that
    can't be undone, so it belongs in the suite even though the client also prevents it.
12. **Tear-down still completes:** the existing deletion-ordering regressions
    (`rules/security.test.ts`, "Pulse deletion ordering") must stay green — an owner
    deleting their own Pulse walks the full cascade including their own membership doc.
    The owner half of that lockout hazard is now unreachable (they can't self-delete while
    the Pulse exists), so that case is rewritten around an editor.

**Unit** (vitest, alongside `planNotice.test.ts` / `entitlements.test.ts`):

- `pulseLock()` — archived + plan-locked returns `"archived"`; plan-locked alone returns
  `"plan"`; neither returns `null` (§5.6).
- `effectiveEditScope()` — every role preset collapses to `"none"` under a lock, and returns
  its preset scope without one.
- Migration mapping — `{archived: true}` → `{hidden: true}`, `{archived: false}` →
  `{hidden: false}`, an entry with both left alone (idempotent, no write loop, matching the
  convergence property the reconcile loop already relies on at `DashboardPage.tsx:46-48`).
- Dashboard grouping — hidden-and-archived lands in **Hidden** (§5.3).

## 11. Phased plan

1. **Hide (the rename), alone.** `myPulses.archived` → `hidden`, the self-heal migration and
   back-compat read, the Hidden section, `card.hide`/`card.unhide`, the rewritten delete
   copy. Client-only; no rules change; no shared behaviour change. Ships and settles on its
   own so the vocabulary lands before the freeze does (§8).
2. **Archive — data + rules.** `archivedAt`/`archivedBy`, `isPulseActive`, every clause in
   §4.1's table, the escape clause, the owner-delete exemption, the inert join link, and the
   full rules test block. No UI beyond a hidden-behind-nothing owner action, so the enforcement
   layer can be verified before people can reach it.
3. **Archive — UI.** `pulseLock()`, the banner, the Toolbar chip, the swallowed-edit notice,
   the Archived dashboard section and card chip, the archive confirmation, mobile.
4. **The rest of the surface.** Activity verbs, help bullets, all six dictionaries, and the
   always-an-owner work (§5.7): the rules backstop on self-delete, the sole-owner block
   rewritten as an Archive / Delete / Transfer choice, and the self-demote carve-out. This
   phase depends on Archive existing — the sole-owner block offers it as the first exit —
   so it can't move ahead of phase 3.

Phases 2–4 can ship in one release; phase 1 should not share one with them.

## 12. Non-goals

- Auto-archive on inactivity, scheduled archiving, or any retention/expiry policy.
- Archiving anything smaller than a Pulse (an epic, a task).
- A workspace/Team-level archive — Teams don't exist yet (`Collaboration-Spec.md` §3.2).
- Export-on-archive, cold storage, or any change to where archived data lives.
- Changing how Pulse deletion is orchestrated. The server-side cascade already exists and is
  deployed (SF6, §4.4); reordering the client pass around it is a separate change.
- Any change to who can *read* a Pulse.

## 13. Decisions (HA1–HA10)

1. **HA1 — Who may archive? ✅ Owner only.** It's a Pulse-wide consequence, so it sits with
   the role that already carries delete, role changes and member removal. An owner can
   delegate by promoting. Editors may hide (like everyone), never archive.
2. **HA2 — Do comments freeze? ✅ Yes.** "Read-only for all members" must be true without a
   footnote, and a thread nobody can act on is a worse affordance than a clean freeze.
   Existing comments stay readable; discussion resumes on unarchive.
3. **HA3 — Do existing join links still work? ✅ No — they go inert.** A link circulating
   before the freeze would keep growing the roster of a finished project, silently and
   unactionably. It can't be rotated or revoked while the pulse doc is frozen either, so
   inert is the only coherent state. Adding someone means unarchive → add → re-archive.
4. **HA4 — Can an archived Pulse still be deleted? ✅ Yes, and the rules must actively
   permit it.** Owner-delete exemption on every content subcollection (§4.4), because
   `Plans-Spec.md` §5.1 makes deleting an archived Pulse the intended way to reclaim a slot.
   Archive stops quiet mutation, not destruction.
5. **HA5 — Notify members on archive? ✅ Not in v1.** The state is loud where it matters
   (banner on open, dashboard section). Revisit when notifications cover more than comments.
6. **HA6 — Dashboard placement when both apply? ✅ Hidden wins.** Hiding is the user's
   explicit "off my dashboard"; an Archived section that resurrected it would defeat it.
7. **HA7 — Does archiving hide it for you too? ✅ No.** They're independent — archive is
   about the project, hide is about your dashboard. An owner who wants both does both.
8. **HA8 — Do archived Pulses count against `maxPulses`? ✅ Yes** — with hidden ones
   (`Plans-Spec.md` PL12, §7). Neither action is quota relief; the routes to capacity are
   delete and upgrade, and the UI must never imply otherwise.
9. **HA9 — Banner precedence against the plan lock? ✅ Archive wins.** Precedence is by
   actionability: an owner clears an archive in one click; the plan lock clears only by
   delete or upgrade. Unarchiving then reveals the plan banner, which is honest.
10. **HA10 — May the last owner leave? ✅ No. Archive or delete instead.** A Pulse always
    has at least one owner (§5.7). Every owner-gated action here — archive, unarchive,
    delete, promote — depends on one existing, and an ownerless *archived* Pulse would be
    frozen, undeletable and still holding a quota slot with no route out. The sole owner's
    exits are **Archive** (keep it all, stop the changes), **Delete** (remove it for
    everyone), or **Transfer** (make someone else an owner, then leave as a non-owner) — and
    the UI offers all three where Leave used to dead-end. Enforced exactly client-side; the
    rules backstop denies self-delete to *any* owner, since rules can't count owners. That
    is stricter than asked and costs a non-last owner the self-serve leave (they self-demote
    or a co-owner removes them) — accepted, because the invariant has to hold against a
    concurrent double-leave, not just against the UI.
