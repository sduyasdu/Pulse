# Pulse — Granular Permissions Specification

Status: **Proposal — decisions open (P1–P12)** · Scope: documents today's coarse
three-role model, then designs a **more granular permissions system** on top of it.
This is a design/spec document only — no application code changes. Every proposal is
grounded in what `firestore.rules` can actually enforce, is backward-compatible with
today's owner/editor/viewer behaviour, and is phased so the shipped app keeps working
at every step. It builds on and does **not** contradict `Collaboration-Spec.md`
(Teams, copy-link joins, D1–D14); where the two touch, this doc reuses those decisions
(notably D11b: *a per-Pulse grant can only raise capability above the team role, never
lower it*).

---

## 1. Current state (what ships today)

The authoritative record for "what can this user do in this Pulse" is
`pulses/{pulseId}/pulseMembers/{uid}` (`PulseMember`, `src/types/index.ts:78-91`),
whose single meaningful field is `role: PulseRole` where
`PulseRole = "owner" | "editor" | "viewer"` (`types/index.ts:76`).

### 1.1 The three flat roles

| Capability | Owner | Editor | Viewer |
|---|---|---|---|
| Read all Pulse data (epics/features/resources/comments) | ✅ | ✅ | ✅ |
| Edit canvas/board/tasks (`features`) | ✅ | ✅ | ❌ |
| Edit epics (`epics`) | ✅ | ✅ | ❌ |
| Edit the team roster / resources (`resources`) | ✅ | ✅ | ❌ |
| Edit Pulse config (statuses, resourceTypes, graphConfig, name, `invite`) | ✅ | ✅ | ❌ |
| Comment (`comments`) | ✅ | ✅ | ✅ (any member) |
| Generate / revoke a join link, invite | ✅ | ✅ | ❌ |
| Change another member's role | ✅ | ❌ | ❌ |
| Remove a member | ✅ | ❌ | ❌ |
| Delete the Pulse | ✅ | ❌ | ❌ |

### 1.2 How it's enforced today (the layer any proposal must fit)

Enforcement is two-layer and the **rules layer is authoritative**
(`firestore.rules`):

- `isPulseMember(pulseId)` — a `pulseMembers/{uid}` doc exists (`:47-50`). Gates
  every **read** under `pulses/{pulseId}/**` (`:112`, `:191-215`).
- `pulseRole(pulseId)` — `get()`s the member doc and returns `.data.role` (`:51-53`).
- `canEditPulse(pulseId)` — role in `['owner','editor']` (`:54-56`). Gates every
  `epics`/`features`/`resources` write (`:193,198,214`) and the `pulses` update
  (`:117`).
- `isPulseOwner(pulseId)` — role `== 'owner'` (`:57-59`). Gates Pulse `delete`
  (`:120`), and `pulseMembers` update/delete (`:143-150`) — i.e. role changes and
  member removal.
- `comments` create is gated by `isPulseMember` (`:206`), **not** `canEditPulse` —
  so **viewers can already comment today**. `comments` delete is author-or-owner.
- Self-write carve-out: a member may update **their own** `pulseMembers` doc but the
  rule pins `uid`/`role`/`email`/`joinedAt` (`:143-148`), so the only field they can
  actually change is the denormalized `photoURL`. **No role self-escalation** is the
  load-bearing invariant here.

Client mirror (advisory only, rules win): `usePulseStore.roleOf(uid)`
(`pulseStore.ts:126`) → `canEdit = role in ('owner','editor')`
(`PulsePage.tsx`), which gates the toolbar, mutations and undo; `CollaboratorsDialog`
derives `canManage` (owner|editor) and `isOwner` (`CollaboratorsDialog.tsx:35-36`).

### 1.3 The `linkedUid` / "My Beat" seam (the hook for scoped permissions)

A `Resource` (canvas team-member row) can be linked 1:1 to a real account via
`Resource.linkedUid` (`types/index.ts:281`). The write side ships in `TeamTab.tsx`
(the per-resource "link to account" dropdown, `:186-200`). The **read/consume** side
that already ships is **"My Beat"**: `PulsePage.tsx:103`,
`MobilePulseView.tsx:50` and `Toolbar.tsx:216-224` compute
`myResourceIds = resources.filter(r => r.linkedUid === uid).map(r => r.id)` and let a
member filter the canvas to *only tasks their linked resource is on*. This is
presentation-only today — it changes what you **see**, not what you **may edit**.
§3.4 turns this same seam into a **scoped edit permission** ("edit only my own
tasks").

### 1.4 Why it's too coarse (motivation)

Concrete scenarios the three flat roles cannot express:

1. **Comment-only reviewer.** A stakeholder who should read and comment but never
   touch data. Today a "viewer" *can* comment (§1.2), and there is no role that reads
   but is barred from commenting — so "viewer" is really "commenter", and there is no
   true read-only tier or, conversely, no way to invite a reviewer without also
   handing them the same comment rights you'd give a teammate. The naming lies.
2. **Contributor who edits only their own tasks.** A developer who should update
   status/notes/dates on the tasks their linked resource is assigned to, but must not
   restructure the plan, move other people's tasks, or edit epics. Today that's
   "editor" (can edit *everything*) or "viewer" (can edit *nothing*).
3. **Team lead / manager who can onboard people but not delete the Pulse.** Someone
   who manages members and shares links but shouldn't hold the destructive
   delete-the-Pulse / final-owner power. Today "manage members" and "delete Pulse"
   are welded together into `owner`.
4. **Roster steward.** Someone who curates the `resources` list and links accounts
   but shouldn't rearrange the canvas. Today `resources` and `features` are both
   just `canEditPulse` — one switch.
5. **Config lock.** Prevent contributors from renaming statuses or the Pulse while
   still letting them edit tasks. Today statuses/config and task edits are the same
   `canEditPulse` grant on `features` + `pulses.update`.
6. **Epic lead (per-epic scope).** "Manage only my epic." Called out as an explicit
   **non-goal** below — see §3.5 for why per-epic ACLs are the one scope Firestore
   rules can't do cheaply.

---

## 2. Goals & non-goals

**Goals**

- Express scenarios 1–5 above with new **named presets** plus optional **per-capability
  overrides**, all resolvable by a single `pulseMembers/{uid}` doc read.
- Stay inside what `firestore.rules` can enforce: per-document/per-collection allow
  rules, `get()`/`exists()` lookups by *known path*, and per-field diffing via
  `request.resource.data.diff(resource.data).affectedKeys()` — **no queries, no array
  iteration, no dynamic-path `get()` over a list**.
- **Backward compatible by construction:** existing owner/editor/viewer members keep
  their exact behaviour with **no migration write**; new capability fields are
  additive and optional, defaulting to today's semantics.
- Preserve every current security invariant: self-owned `users/{uid}/myPulses`
  index; a member may only self-write their own membership `photoURL`; **no role /
  capability self-escalation**; at least one owner always (`ownerCount` guard,
  `CollaboratorsDialog.tsx:39-40`).
- Compose cleanly with the Teams/workspace layer (Collaboration-Spec §3.2): team
  role is a **floor**, per-Pulse grants only **raise** (D11b).

**Non-goals (this round)**

- **Per-epic / per-field ACLs** (scenario 6). Enforcing "edit only features in epic
  X" requires the rule to consult a per-epic ACL on every `features` write, and
  "edit only field Y" requires per-field diffing against a per-member field
  allow-list — both are large model changes for niche value. Deferred (P9).
- **Object-level sharing** (share one task with an outsider). Membership stays
  whole-Pulse; outsiders get in via a Pulse/Team join link (Collaboration-Spec §3.1).
- **Attribute-based / row-level policies** beyond the single `linkedUid` "assigned"
  scope of §3.4.

---

## 3. Proposed model

### 3.1 Recommendation in one line

**Adopt a capability set as the enforcement primitive, bundled into named role
presets for the UI, materialised onto each `pulseMembers` doc so rules read plain
booleans.** Keep `owner`/`editor`/`viewer` as three of the presets (their capability
bundles reproduce today's behaviour exactly), add `manager`, `contributor`, and
`commenter` presets, and allow an **Advanced** mode that tweaks individual
capabilities (surfacing the member as a `custom` preset). One scoped capability —
`editTasksScope: "assigned"` — reuses the `linkedUid` seam for "edit only my own
tasks".

Why this over the alternatives:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. More named roles only** (add commenter/contributor/manager as opaque tiers) | Simplest UI; tiny rule change (extend the role→gate lookups) | Rigid — every new "X but also Y" need is a new hard-coded tier; combinatorial blow-up; no way to say "editor who can't delete config" | Insufficient alone |
| **B. Pure capability flags** (booleans per member, no roles) | Maximal flexibility; rules read one boolean each | Bad UX (10 toggles per person); easy to create nonsensical/insecure combos; no shared mental model | Too raw alone |
| **C. Capabilities bundled into presets (recommended)** | One mental model (pick a role), power-user override (toggle a cap); rules read materialised booleans; presets guarantee sane defaults & trivial back-compat | Slightly larger member doc; must keep preset↔caps table in sync client & rules | **Recommended** |
| **D. Scoped/relationship perms** (per-epic, per-resource ownership) | Matches "lead owns their epic" | Per-epic needs rule to read an ACL per write; array-of-resources can't be iterated in rules; expensive & complex | Only the single `linkedUid` "assigned" scope is in-scope (§3.4); the rest deferred |

Option C is B's engine with A's ergonomics, and it degrades to today's system when
`caps` is absent — which is what makes the migration a no-op.

### 3.2 The capability set

Eight capabilities, chosen so **each maps to exactly one rule gate** (a collection's
`write`, or one branch of `pulses.update`, or `pulseMembers` writes):

```ts
// src/types/index.ts (proposed)
export type CapScope = "all" | "assigned" | "none";

export interface Capabilities {
  /** Write pulses/{p}/features. "assigned" = only tasks my linked resource is on
   *  (§3.4). "all" = any task. "none" = read-only for tasks. */
  editTasksScope: CapScope;
  /** Write pulses/{p}/epics (add/rename/recolor/move epics). */
  editEpics: boolean;
  /** Write pulses/{p}/resources (the team roster + account links). */
  editResources: boolean;
  /** Update Pulse config: name, statuses, resourceTypes, graphConfig. */
  editConfig: boolean;
  /** Create comments. (Read is always allowed to members.) */
  comment: boolean;
  /** Generate/revoke join links & invites (writes pulses.invite + joinLinks). */
  invite: boolean;
  /** Change other members' roles/caps; remove members. */
  manageMembers: boolean;
  /** Delete the whole Pulse. */
  deletePulse: boolean;
}
```

Notes on granularity choices:

- `editTasksScope` is a **scope enum**, not a boolean, because "edit only my own
  tasks" is a first-class scenario (§1.4.2) and folding it into `editTasks: bool`
  would lose it. `"none"` covers viewer/commenter, `"all"` covers editor, `"assigned"`
  covers contributor.
- `editEpics`, `editResources`, `editConfig` are split out from the monolithic
  `canEditPulse` so the roster steward / config lock / structure-vs-content
  distinctions (§1.4.4–5) become expressible. They collapse back together in the
  `editor` preset, so nothing changes for editors.
- `comment` exists so a **true read-only** tier is finally possible (viewer =
  `comment:false`) and a **commenter** tier (`comment:true`, everything else off) is
  distinct from it. See P4 for the back-compat wrinkle (today's viewers can comment).
- `manageMembers` and `deletePulse` are split so `manager` (onboard people, no
  delete) is expressible (§1.4.3). `owner` = both true.

### 3.3 Role presets

Presets are the only thing the everyday UI shows. Each is a fixed `Capabilities`
bundle. `owner`/`editor`/`viewer` reproduce today's behaviour **exactly** (see §1.1),
which is what makes them safe defaults and the migration a no-op.

| Capability | `owner` | `manager` | `editor` | `contributor` | `commenter` | `viewer` |
|---|---|---|---|---|---|---|
| `editTasksScope` | all | all | all | **assigned** | none | none |
| `editEpics` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `editResources` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `editConfig` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `comment` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌* |
| `invite` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `manageMembers` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `deletePulse` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

\* **Back-compat wrinkle:** today any member (viewers included) can comment
(`firestore.rules:206`). Making `viewer.comment = false` is a *reduction* for
existing viewers. Two clean options in P4: (a) keep `viewer.comment = true` and drop
the separate `commenter` preset (viewer *is* the comment-capable read tier); or (b)
introduce true read-only `viewer` and **migrate existing viewers to `commenter`** so
no one loses commenting. Recommendation: **(b)** — it's the honest naming and the
migration is a label-only remap (§6).

A member whose `caps` don't match any preset displays as **`custom`** (§5 UX).

`PulseRole` widens to the preset labels:

```ts
export type PulseRole =
  | "owner" | "manager" | "editor" | "contributor" | "commenter" | "viewer"
  | "custom";
```

### 3.4 The one scoped capability: `editTasksScope: "assigned"` (contributor)

This is the "edit only tasks assigned to my linked resource" grant (§1.4.2), reusing
the `linkedUid` / My Beat seam (§1.3). The enforcement problem: a `Feature` stores
`resources: string[]` (resource **ids**), and to know whether *my account* is on a
task the rule would have to resolve each id → its `Resource.linkedUid` — but rules
**cannot iterate an array** nor `get()` a dynamic list of resource docs. So raw
`linkedUid` is not rule-checkable on a feature write.

**Fix — denormalise `assignedUids` onto each Feature.** Whenever a feature's
`resources` change, the writer also maintains
`Feature.assignedUids: string[]` = the `linkedUid`s of the assigned resources (the
client already has the resource roster in `pulseStore`, so this is a cheap derived
write; a maintenance Cloud Function is a later hardening option). Then a rule can do a
**membership test on a scalar array**, which *is* supported:

```
request.auth.uid in resource.data.get('assignedUids', [])
```

Enforcement per operation for an `editTasksScope == "assigned"` member:

| Op on `features/{id}` | Rule condition | Enforceable in rules? |
|---|---|---|
| **update** | `uid in resource.data.assignedUids` (I'm on the task now) **and** `uid in request.resource.data.assignedUids` (I can't unassign myself off it to keep editing) | ✅ Yes |
| **create** | `uid in request.resource.data.assignedUids` (the new task must include me) | ✅ Yes |
| **delete** | choose: **deny** (recommended — contributors don't delete tasks), or allow only if `uid in resource.data.assignedUids` | ✅ Yes |

What is **not** fully rule-enforceable, and is therefore **client-side-only**, called
out honestly:

- **Field-level narrowing within an assigned task** (e.g. "a contributor may change
  `status`/`notes`/`finishedAt` but not `x`/`duration`/`epicId`"). Rules *could* do
  this with `diff().affectedKeys().hasOnly([...])`, but the allow-list of "content"
  vs "structure" fields is long and brittle. Recommendation: **enforce assignment
  scope in rules, enforce field narrowing only in the client** for v1 (a contributor
  who forges a raw write could still edit a structural field of a task they're
  legitimately on). This is acceptable because the blast radius is limited to tasks
  the user is *already* a legitimate participant on — they cannot touch anyone else's
  work — and it avoids a fragile field allow-list. Revisit if a real "content-only"
  requirement appears (P8).
- **Integrity of `assignedUids` itself.** Since the client writes it, a malicious
  contributor could set `assignedUids` on `create` to include themselves for a task
  and thereby "self-assign". That's inherent to a client-maintained denormalisation;
  it only lets them edit tasks they've inserted themselves into, not existing
  tasks they weren't on (the **update** rule checks the *prior* `resource.data`).
  Hardening (server-maintained `assignedUids`) is deferred with notifications
  (Collaboration-Spec §3.6 already needs a function for the assignment→notify path).

---

## 4. Enforcement — mapping to `firestore.rules`

### 4.1 Materialised caps + legacy fallback

Rules should never *derive* the preset→caps table (too much branching). Instead the
**caps are materialised on the member doc** at write time (`setMemberRole` /
`setMemberCaps` write both `role` and the resolved `caps`). Rules read booleans
directly, with a **fallback for legacy docs** that have no `caps` field (existing
members), so nothing needs a backfill:

```
// ---- capability resolution ----
function memberDoc(pulseId) {
  return get(/databases/$(database)/documents/pulses/$(pulseId)/pulseMembers/$(request.auth.uid)).data;
}
// Legacy fallback: a doc written before this feature has no `caps`; interpret its
// old role exactly as today. New/updated docs always carry `caps`.
function legacyCan(role, cap) {
  return role == 'owner' ? true
       : role == 'editor' ? (cap in ['editTasks','editEpics','editResources','editConfig','comment','invite'])
       : /* viewer */       (cap == 'comment');   // today viewers may comment
}
function cap(pulseId, capName) {
  let m = memberDoc(pulseId);
  return ('caps' in m)
    ? ( capName == 'editTasks'    ? m.caps.editTasksScope != 'none'
      : capName == 'editEpics'    ? m.caps.editEpics
      : capName == 'editResources'? m.caps.editResources
      : capName == 'editConfig'   ? m.caps.editConfig
      : capName == 'comment'      ? m.caps.comment
      : capName == 'invite'       ? m.caps.invite
      : capName == 'manageMembers'? m.caps.manageMembers
      : capName == 'deletePulse'  ? m.caps.deletePulse
      : false )
    : legacyCan(m.role, capName);
}
function isPulseOwner(pulseId) {                    // owner === can delete
  return isPulseMember(pulseId) && cap(pulseId, 'deletePulse');
}
```

(Only one `get()` per evaluation, same cost as today's `pulseRole`.)

### 4.2 Per-collection / per-operation gates

| Surface | Today | Proposed |
|---|---|---|
| `epics` write (`:193`) | `canEditPulse` | `isPulseMember(p) && cap(p,'editEpics')` |
| `resources` write (`:214`) | `canEditPulse` | `isPulseMember(p) && cap(p,'editResources')` |
| `features` write (`:198`) | `canEditPulse` | see §4.3 (scoped) |
| `pulses.update` (`:117`) | `canEditPulse` (+ invite-role guard) | split by `affectedKeys()` — see §4.4 |
| `comments` create (`:206`) | `isPulseMember` | `isPulseMember(p) && cap(p,'comment')` |
| `comments` update/delete (`:207-209`) | author / owner | unchanged (author, or `cap(p,'deletePulse')` for owner-delete) |
| `joinLinks`/`invites` create (Collab §3.1, `firestore.rules` invites `:164`) | `canEditPulse` | `cap(p,'invite')` |
| `pulseMembers` update/delete (`:143-150`) | `isPulseOwner` | `cap(p,'manageMembers')` (+ self carve-outs, §4.5) |
| `pulses` delete (`:120`) | `isPulseOwner` | `cap(p,'deletePulse')` |
| all reads (`:112`, subcollections) | `isPulseMember` | **unchanged** — membership still gates every read |

### 4.3 Scoped `features` write

```
match /features/{featureId} {
  allow read: if isPulseMember(pulseId) || /* team */ isWorkspaceMember(...);
  allow create: if isPulseMember(pulseId) && (
        capFeaturesAll(pulseId)
     || (capFeaturesAssigned(pulseId)
         && request.auth.uid in request.resource.data.get('assignedUids', [])));
  allow update: if isPulseMember(pulseId) && (
        capFeaturesAll(pulseId)
     || (capFeaturesAssigned(pulseId)
         && request.auth.uid in resource.data.get('assignedUids', [])
         && request.auth.uid in request.resource.data.get('assignedUids', [])));
  allow delete: if isPulseMember(pulseId) && capFeaturesAll(pulseId); // contributors don't delete
}
// helpers read the scope enum:
function capFeaturesAll(p)      { /* caps.editTasksScope=='all' | legacy owner/editor */ }
function capFeaturesAssigned(p) { /* caps.editTasksScope=='assigned' */ }
```

`assignedUids` is the scalar array from §3.4 (`in` is the one array test rules
support). Field-level narrowing within an assigned task is **client-only** (§3.4).

### 4.4 Splitting `pulses.update` by affected keys

Today one gate (`canEditPulse`) covers *all* Pulse-doc mutations. To let `editConfig`
govern name/statuses/etc. while `invite` governs the join-link field, route by which
keys actually changed — `affectedKeys()` **is** supported in rules:

```
allow update: if isPulseMember(pulseId) && (
  // pure invite/link change → needs invite cap (and keep the existing role guard)
  ( request.resource.data.diff(resource.data).affectedKeys().hasOnly(['invite','updatedAt'])
    && cap(pulseId,'invite')
    && (request.resource.data.get('invite',null) == null
        || request.resource.data.invite.role in ['viewer','editor','commenter','contributor']) )
  ||
  // any config field (name/statuses/resourceTypes/graphConfig/…) → needs editConfig
  ( cap(pulseId,'editConfig') )
);
```

The invite-role allow-list is extended to the new non-privileged presets so a link
can grant e.g. `commenter`/`contributor` but never `owner`/`manager` (mirrors the
existing "links can't mint owners" rule, `:117-119`).

### 4.5 Preserving the security invariants

- **No self-escalation.** The `pulseMembers` update rule keeps pinning identity/grant
  fields for a self-write and now must also pin `caps`:

  ```
  allow update: if cap(pulseId,'manageMembers')      // a manager/owner may re-grant
    || (memberUid == request.auth.uid
        && request.resource.data.uid   == resource.data.uid
        && request.resource.data.role  == resource.data.role
        && request.resource.data.email == resource.data.email
        && request.resource.data.joinedAt == resource.data.joinedAt
        && request.resource.data.get('caps', null) == resource.data.get('caps', null));
  ```

  So a member can still only self-write `photoURL`; `caps`/`role` are frozen for
  self-writes — a viewer can't hand themselves `editConfig`.
- **Only manage-members may re-grant.** Writing another member's `role`/`caps`
  requires `cap(p,'manageMembers')` (was owner-only; `manager` now qualifies too).
- **`deletePulse` stays the true "owner" bit.** `isPulseOwner` is redefined as
  `cap(p,'deletePulse')`, so Pulse delete and last-owner logic are unchanged in
  meaning.
- **Last-owner / privilege floors.** Rules can't count owners (no queries), so the
  "≥1 owner" and "a `manager` can't grant `owner`/`deletePulse` they don't hold"
  guards remain **client-enforced** (as the last-owner guard already is,
  `CollaboratorsDialog.tsx:39-40`) — plus a rule guard that a self-write can't add
  `deletePulse`/`manageMembers` (covered by the pinned-`caps` self-write rule above).
  Recommendation P6: **a `manager` may only grant presets at or below `manager`**
  (no minting new owners) — enforceable as a rule check that
  `!request.resource.data.caps.deletePulse` unless the writer themselves has
  `deletePulse`.
- **Self-owned `myPulses` index untouched** (`:78-80`) — capabilities live on the
  Pulse-side member doc, never on the user's own index, so the "a client can never
  write another user's index" invariant is unaffected. `MyPulseIndexEntry.role`
  stays a display cache only.

### 4.6 What is **not** enforceable in rules (client-only), and why it's acceptable

| Concern | Why rules can't | Mitigation / acceptability |
|---|---|---|
| Field-level narrowing for contributors (content vs structure of an assigned task) | Fragile field allow-list; low value | Client-gated; blast radius limited to tasks the user legitimately participates in (§3.4). Rules still enforce *which* tasks. |
| "≥1 owner always" | No count/query in rules | Client guard already exists; self-write can't drop own owner cap (pinned-caps rule). |
| Manager can't exceed own grants when re-granting | Partially: rule can forbid granting `deletePulse` a non-owner writer lacks | Rule guard in §4.5 + client UI hides the option. |
| `assignedUids` integrity (self-assign on create) | Client maintains the denorm | Only lets a user edit tasks they inserted themselves onto, never pre-existing others' tasks; server-maintained denorm is the later hardening. |

None of these can escalate a user's authority over **other members' data** or the
Pulse lifecycle; they are all "a user being slightly too permissive with tasks they
already legitimately touch," which is an acceptable v1 trade for avoiding brittle
rules.

---

## 5. UX — assigning & displaying permissions

Extend `CollaboratorsDialog.tsx` (the existing member-management surface) rather than
build a new one.

- **Preset picker (default view).** The current `<select>` of Editor/Viewer
  (`:124-133`) widens to the ordered preset list **Owner · Manager · Editor ·
  Contributor · Commenter · Viewer**, each with a one-line helper ("Contributor —
  edits only their own tasks", "Commenter — reads & comments", "Manager — manages
  members, can't delete"). "Make owner" stays the explicit transfer action already
  shipped (`:134-141`). Only a member with `manageMembers` sees the picker
  (`isOwner`/`canManage` derivations widen to `cap` checks).
- **Advanced (per-capability) disclosure.** An "Advanced…" toggle under the picker
  reveals the eight capability switches (with `editTasksScope` as a 3-way
  All/Assigned/None control). Flipping any switch away from the selected preset flips
  the member's label to **Custom**; a "Reset to preset" link restores a bundle. This
  keeps the everyday path simple (pick a role) while exposing full granularity for
  power users.
- **Badges.** `ROLE_BADGE` (`:19-23`) gains entries so each preset reads at a glance:
  Owner (orange), Manager (violet), Editor (blue), Contributor (teal — matches the
  `linkedUid` link ring `#12A594`), Commenter (slate-blue), Viewer (grey), Custom
  (dashed/neutral with a tooltip listing the enabled caps). Contributor's badge
  tooltips "Edits only tasks their linked resource is on" and, if the member has **no**
  `linkedUid` resource, warns "Not linked to a resource — can't edit any task yet" and
  deep-links to the Team tab account-link dropdown (`TeamTab.tsx:186-200`).
- **Self-view.** Non-managers see their own badge + a read-only capability summary
  ("You can: edit your tasks, comment") so expectations are clear without granting the
  management surface.
- **Join-link role options.** The link role picker (`InviteLinkPanel`, per
  Collaboration-Spec §3.1) offers Viewer/Commenter/Contributor/Editor (never
  Owner/Manager) — matching the §4.4 invite-role allow-list.

---

## 6. Interaction with the Teams / workspace layer

Reuses Collaboration-Spec §3.2 (union-cascade) and **D11b** verbatim: *the team role
is a floor; a per-Pulse grant can only raise capability, never lower it.*

- **Team roles map to the same presets.** Collaboration-Spec §3.2 unifies
  `WorkspaceRole` to `owner`/`editor`/`viewer`; those map to the identical capability
  bundles in §3.3. (Manager/contributor/commenter are **per-Pulse-only** presets for
  now — team-level granularity is a later extension; a team stays owner/editor/viewer.)
- **Effective capability = union.** For a user with both a team role and a per-Pulse
  `pulseMembers` grant on a Pulse, each boolean is OR-ed and `editTasksScope` takes
  the **broader** of the two (`all` > `assigned` > `none`). So a team `viewer` bumped
  to `contributor` on one Pulse gets `assigned` there; a per-Pulse grant can never
  drop them below their team floor. This is exactly D11b, expressed over capabilities
  instead of the old three tiers.
- **Rule shape.** The cascade already `get()`s the pulse doc for `workspaceId`
  (Collaboration-Spec §4). Capability helpers gain an OR arm:
  `cap(p, X) := perPulseCap(p, X) || teamCap(workspaceOf(p), X)`, where `teamCap`
  maps the workspace role to the preset bundle. Reads stay
  `isPulseMember || isWorkspaceMember` (unchanged).
- **Guests** (per-Pulse `pulseMembers`, no team membership) work exactly as today —
  they simply have no team floor, so their effective caps are their per-Pulse caps.

---

## 7. Data-model changes

Additive; existing docs remain valid.

**`PulseMember` (`src/types/index.ts:78-91`) — add two optional fields:**

```ts
export interface PulseMember {
  uid: string;
  email: string;
  role: PulseRole;          // widened enum (§3.3): +manager/contributor/commenter/custom
  joinedAt: Timestamp;
  joinToken?: string;
  photoURL?: string | null;
  // NEW — the materialised capability bundle the rules read (§4.1). Absent on
  // legacy docs (interpreted via legacyCan()); always written going forward.
  caps?: Capabilities;
}
```

**New type (§3.2):** `Capabilities`, `CapScope`. **Widened:** `PulseRole` (§3.3).

**`Feature` (`types/index.ts:237-264`) — add one denormalised field for scope (§3.4):**

```ts
  assignedUids?: string[];  // linkedUid of each assigned resource; maintained on write.
                            // Enables the rule's `uid in assignedUids` test.
```

**`InviteLink` / `JoinLink` role** widens to the invite-eligible presets
(`viewer|commenter|contributor|editor`) — never owner/manager (§4.4). No other
entity changes; `Epic`/`Resource`/`Pulse`/`Workspace` are untouched.

**Defaults preserving current behaviour:** a member with **no `caps`** is read via
`legacyCan()` (§4.1) — owner⇒all, editor⇒edit-everything, viewer⇒comment-only —
i.e. exactly today. A feature with **no `assignedUids`** simply yields an empty array
in the `in` test, so a contributor can't edit it until it's (re)written with the
denorm; `editTasksScope:"all"` members ignore the field entirely.

---

## 8. Migration & rollout

Phased so each step is independently shippable and the app never breaks. Phases 1–2
are behaviour-preserving; new powers arrive only in 3+.

1. **Introduce caps plumbing, no behaviour change.** Add the `Capabilities` type, the
   preset→caps table (a shared TS module reused by client + used to author the rule
   helpers), and the `cap()` / `legacyCan()` rule helpers. Rules keep identical
   outcomes because every existing member is legacy (no `caps`) and presets == old
   roles. `setMemberRole` starts **materialising `caps`** alongside `role` for any
   member it writes. **No backfill** — legacy docs resolve via fallback. Ship behind
   no flag; it's a no-op.
2. **Preset remap for honest naming (P4).** If choosing "true read-only viewer"
   (recommended (b)): a one-time, per-member **label** remap on next write — existing
   `viewer` → `commenter` when materialising caps, so no one loses commenting. Purely
   additive; unremapped legacy viewers keep commenting via `legacyCan`.
3. **Add `manager` + `commenter` presets and the split gates.** Ship the
   `editConfig`/`invite`/`manageMembers` rule split (§4.2, §4.4) and the widened
   preset picker + badges (§5). Managers/commenters become grantable. Editors/viewers
   unaffected (their bundles are unchanged).
4. **Add `contributor` + scoped `features` write (§3.4).** Introduce
   `Feature.assignedUids` maintenance in the resource-assignment write path, then the
   scoped `features` rules. Ship the contributor preset, its badge, and the
   "not linked to a resource" warning. This is the most complex phase; sequence it
   last and gate the rule change behind the denorm being live for one release so
   in-flight features acquire `assignedUids` before the rule relies on it.
5. **Advanced per-capability UI + `custom` preset (§5).** Optional power-user layer;
   independent of the rule work (rules already read caps).

Rollback at any phase = stop writing the new field; `legacyCan()` fallback keeps
older docs working. No destructive migration exists.

---

## 9. Open decisions (P-list)

1. **P1 — Adopt capabilities-bundled-into-presets (Option C).** *Recommend:* yes —
   caps as the enforcement primitive, presets for UX, materialised on the member doc
   with a legacy fallback. *Confirm this over "just add more roles" (A).*
2. **P2 — The capability set (§3.2: 8 caps).** *Recommend:* the eight listed
   (`editTasksScope`, `editEpics`, `editResources`, `editConfig`, `comment`, `invite`,
   `manageMembers`, `deletePulse`). *Confirm the split points — especially separating
   `editEpics`/`editResources`/`editConfig` out of one "edit" bit.*
3. **P3 — The preset lineup.** *Recommend:* Owner · Manager · Editor · Contributor ·
   Commenter · Viewer. *Confirm names and whether `manager` (members, no delete) is
   wanted for v1 or deferred.*
4. **P4 — Viewer vs commenter back-compat.** Today viewers can comment. *Recommend
   (b):* make `viewer` truly read-only and **remap existing viewers → `commenter`** on
   next write so no one loses commenting. Alternative (a): keep `viewer.comment=true`
   and drop the `commenter` preset. *Decide (a) or (b).*
5. **P5 — Contributor scope enforcement (§3.4).** *Recommend:* denormalise
   `Feature.assignedUids` and enforce **which** tasks in rules; enforce **field-level**
   narrowing client-only for v1; contributors can't delete tasks. *Confirm the
   client-only field narrowing is acceptable, and create-time self-assign is
   tolerated.*
6. **P6 — Who may grant what.** *Recommend:* `manageMembers` (owner + manager) may
   re-grant, but a `manager` may only grant presets **at or below manager** (can't
   mint owners / `deletePulse`), enforced by rule guard + hidden UI. *Confirm managers
   can't create owners.*
7. **P7 — Join-link grantable roles.** *Recommend:* links may grant
   viewer/commenter/contributor/editor, never owner/manager (extends the existing
   "links can't mint owners" rule). *Confirm contributor/commenter are link-grantable.*
8. **P8 — Field-level content-only editing.** Deferred. *Recommend:* revisit only if a
   concrete "status/notes only" requirement appears; it's a `diff().affectedKeys()`
   allow-list, enforceable but brittle. *Confirm deferral.*
9. **P9 — Per-epic / per-field ACLs.** Explicit **non-goal** (§2) — per-write ACL
   lookups are expensive and complex. *Confirm out of scope for this round.*
10. **P10 — Materialised caps vs derive-in-rules.** *Recommend:* materialise `caps` on
    the member doc (rules read booleans; one `get()`), with `legacyCan()` fallback for
    old docs (no backfill). *Confirm the denormalisation (keeping the preset→caps table
    in sync across client + rules) is acceptable.*
11. **P11 — Team-level granularity.** *Recommend:* keep teams at owner/editor/viewer
    (Collaboration-Spec §3.2) for now; manager/contributor/commenter are per-Pulse
    grants that **raise** the team floor (D11b). *Confirm teams stay 3-tier this round.*
12. **P12 — `assignedUids` maintainer.** *Recommend:* client-maintained in v1 (cheap,
    serverless), server-maintained later alongside the assignment-notification
    function (Collaboration-Spec §3.6). *Confirm client-first is acceptable.*
```
