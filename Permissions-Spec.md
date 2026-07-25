# Pulse — Granular Permissions Specification

Status: **Proposal — role set fixed by product owner; P11 & P12 resolved; P1–P10 open** ·
Scope: designs a **more granular per-Pulse permissions system** on top of today's
coarse owner/editor/viewer model. Spec/design only — no application code changes.
Related: `Collaboration-Spec.md`, `Server-Functions-Spec.md` (SF1 — the denorm
maintainer this spec's scoped roles rely on).

The product owner has fixed the shipped per-Pulse role presets. In addition to
**owner** (unchanged: full control + manage members + delete), there are four presets:

1. **Editor** — edits everything (today's editor).
2. **Full Viewer** — read-only, sees the entire Pulse (today's viewer).
3. **My-Beat Viewer** — read-only, but can only **see** tasks where their linked
   resource is assigned (a restricted-**read** role).
4. **Task Lead** *(role #4 — recommended name; see §3.4)* — can only **edit** tasks
   they lead (`feature.lead` is their linked resource); everything else read-only.

The capability/permission-set model in §3.2 is the **underlying** engine; the five
presets above are the only things the everyday UI exposes. Everything is grounded in
what `firestore.rules` can enforce and is backward-compatible (existing viewer →
Full Viewer, existing editor → Editor, no migration write). Builds on
`Collaboration-Spec.md` (Teams, copy-link joins, D1–D14) but **supersedes D11b**: a
per-Pulse grant is now **authoritative for that Pulse and may narrow *or* raise** the
team-role floor (product owner: raise-only removed — see §6, P11).

---

## 1. Current state (what ships today)

Authoritative record: `pulses/{pulseId}/pulseMembers/{uid}` (`PulseMember`,
`src/types/index.ts:78-91`), whose one meaningful field is `role: PulseRole` where
`PulseRole = "owner" | "editor" | "viewer"` (`types/index.ts:76`).

### 1.1 The three flat roles

| Capability | Owner | Editor | Viewer |
|---|---|---|---|
| Read all Pulse data (epics/features/resources/comments) | ✅ | ✅ | ✅ |
| Edit tasks (`features`) / epics / resources | ✅ | ✅ | ❌ |
| Edit Pulse config (statuses, resourceTypes, graphConfig, name, `invite`) | ✅ | ✅ | ❌ |
| Comment (`comments`) | ✅ | ✅ | ✅ (any member) |
| Generate / revoke a join link, invite | ✅ | ✅ | ❌ |
| Change roles / remove members | ✅ | ❌ | ❌ |
| Delete the Pulse | ✅ | ❌ | ❌ |

### 1.2 How it's enforced today (the layer any proposal must fit)

Two-layer; **the rules layer is authoritative** (`firestore.rules`):

- `isPulseMember(pulseId)` — a `pulseMembers/{uid}` doc exists (`:47-50`); gates every
  **read** under `pulses/{pulseId}/**` (`:112`, `:191-215`).
- `pulseRole(pulseId)` — `get()`s the member doc, returns `.data.role` (`:51-53`).
- `canEditPulse(pulseId)` — role in `['owner','editor']` (`:54-56`); gates every
  `epics`/`features`/`resources` write (`:193,198,214`) and the `pulses` update
  (`:117`).
- `isPulseOwner(pulseId)` — role `== 'owner'` (`:57-59`); gates Pulse `delete`
  (`:120`) and `pulseMembers` update/delete (`:143-150`).
- `comments` create is gated by `isPulseMember` (`:206`), **not** `canEditPulse` — so
  **viewers already comment today**. Delete is author-or-owner.
- Self-write carve-out: a member may update **their own** `pulseMembers` doc but the
  rule pins `uid`/`role`/`email`/`joinedAt` (`:143-148`), so effectively only the
  denormalized `photoURL` is self-writable. **No role self-escalation** — the
  load-bearing invariant.

Client mirror (advisory; rules win): `usePulseStore.roleOf` (`pulseStore.ts:126`) →
`canEdit` gates the toolbar/mutations/undo; `CollaboratorsDialog` derives `canManage`
/ `isOwner` (`CollaboratorsDialog.tsx:35-36`).

### 1.3 The `linkedUid` / "My Beat" seam (the hook for the two scoped roles)

A `Resource` (canvas team-member row) can be linked 1:1 to a real account via
`Resource.linkedUid` (`types/index.ts:281`). Write side ships in `TeamTab.tsx`
(per-resource "link to account" dropdown, `:186-200`). The read/consume side that
ships is **"My Beat"**: `PulsePage.tsx:103`, `MobilePulseView.tsx:50`,
`Toolbar.tsx:216-224` compute
`myResourceIds = resources.filter(r => r.linkedUid === uid).map(r => r.id)` and let a
member filter the canvas to *only tasks their linked resource is on*. Today this is
**presentation-only** — a client-side filter that changes what you *see*, not what
you *may read or edit*, and the toggle is **disabled when the member is unlinked**
(`Toolbar.tsx:220`, `MobilePulseView.tsx:102`). The two new scoped roles (§3.3–3.4)
promote this same seam into an **enforced** read scope (My-Beat Viewer) and edit scope
(Task Lead).

### 1.4 Why it's too coarse (motivation)

Scenarios the three flat roles can't express — now realized by the four presets:

1. **Stakeholder who reviews only their own slice.** A contractor or teammate who
   should see *only the tasks their resource is on*, not the whole plan → **My-Beat
   Viewer** (§3.3).
2. **Lead who owns delivery of their tasks but must not restructure the plan.** Can
   update the tasks they lead, read the rest for context, but can't move other
   people's work or edit epics/config → **Task Lead** (§3.4).
3. **True read-only vs. today's comment-capable viewer.** (Naming honesty; see P4.)
4. **Owner powers unbundled from editing.** Owner keeps manage-members + delete; the
   four presets never get those. (Confirmed: owner unchanged, P3.)

---

## 2. Goals & non-goals

**Goals**

- Ship the five presets (owner + four) as the only everyday UI, backed by a
  capability/scope model (§3.2) resolvable from a single `pulseMembers/{uid}` read.
- Stay inside what `firestore.rules` can enforce: per-document allow rules,
  `get()`/`exists()` by **known path**, scalar-array membership (`x in array`), and
  per-field diffing (`request.resource.data.diff(resource.data).affectedKeys()`).
  **No queries, no array-of-objects iteration, no dynamic-path `get()` over a list.**
- **Backward compatible:** existing `viewer` → **Full Viewer**, `editor` → **Editor**,
  with **no migration write**; new fields are additive and default to today's
  semantics.
- Preserve every current invariant: self-owned `users/{uid}/myPulses` index; a member
  may only self-write their own membership `photoURL` (and one new hint field, §7);
  **no role/scope self-escalation**; ≥1 owner always (`CollaboratorsDialog.tsx:39-40`).
- Compose with Teams (Collaboration-Spec §3.2): a per-Pulse grant is **authoritative for
  that Pulse — it overrides the team role, narrowing or raising** (supersedes D11b; §6,
  P11). The team role applies only where the member has no per-Pulse grant.

**Non-goals (this round)**

- **Per-epic / per-field ACLs.** Enforcing "edit only epic X" or "edit only field Y"
  needs a per-write ACL lookup / brittle field allow-list — deferred (P9).
- **Object-level sharing with outsiders.** Membership stays whole-Pulse; outsiders
  enter via a join link (Collaboration-Spec §3.1).

---

## 3. Proposed model

### 3.1 Recommendation in one line

**Model each preset as a `(readScope, editScope, manage-bits)` capability bundle,
materialize the bundle onto the `pulseMembers` doc, and enforce the two scoped roles
with two denormalized fields on `Feature` (`assignedUids`, `leadUid`) so rules test a
scalar `in` / `==` per document.** The two scoped roles differ fundamentally in
enforceability, which drives the whole design:

- **Task Lead is a restricted-WRITE role → cleanly, fully rule-enforceable.** Rules
  evaluate a write against the one specific doc; `leadUid == request.auth.uid` is a
  per-doc check. Reads stay unrestricted (full read), so no query constraints.
- **My-Beat Viewer is a restricted-READ role → enforceable, but only if the client
  cooperates on query shape.** Firestore evaluates a `list` against the *query*, not
  post-filters results: the rule can only permit a list whose constraints guarantee
  every returned doc satisfies it. So the client **must** issue
  `where("assignedUids","array-contains", uid)`; a broad "read all features" query is
  **rejected wholesale**, not silently trimmed. This is the crux of §4.3.

### 3.2 The underlying capability/scope model

```ts
// src/types/index.ts (proposed)
export type ReadScope = "all" | "beat"; // "beat" = only features where uid ∈ assignedUids
export type EditScope = "none" | "lead" | "all"; // "lead" = only features where leadUid == uid

export interface Capabilities {
  readScope: ReadScope;
  editScope: EditScope;        // applies to features; epics/resources gated separately
  editEpics: boolean;          // write pulses/{p}/epics
  editResources: boolean;      // write pulses/{p}/resources (roster + account links)
  editConfig: boolean;         // update Pulse name/statuses/resourceTypes/graphConfig
  comment: boolean;            // create comments (read of comments follows readScope)
  invite: boolean;             // generate/revoke join links & invites
  manageMembers: boolean;      // change roles/caps; remove members
  deletePulse: boolean;        // delete the whole Pulse
}
```

`readScope`/`editScope` are enums (not booleans) because "see only my beat" and "edit
only what I lead" are first-class. Everything else is a boolean gate that maps 1:1 to a
collection write or a `pulses.update` branch. The bundle is **materialized** on the
member doc as `PulseMember.caps` so rules read plain values (§4.1); legacy docs with no
`caps` fall back to their old role (§4.1), which is why the migration is a no-op.

### 3.3 The five presets

Each preset is a fixed `Capabilities` bundle. Owner/Editor/Full-Viewer reproduce
today's behaviour exactly.

| Capability | **Owner** | **Editor** | **Full Viewer** | **My-Beat Viewer** | **Task Lead** |
|---|---|---|---|---|---|
| `readScope` | all | all | all | **beat** | all *(rec.; P5)* |
| `editScope` (features) | all | all | none | none | **lead** |
| `editEpics` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `editResources` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `editConfig` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `comment` | ✅ | ✅ | ✅* | ✅ (on visible tasks) | ✅ |
| `invite` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `manageMembers` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `deletePulse` | ✅ | ❌ | ❌ | ❌ | ❌ |

\* Today any member (viewers included) can comment (`firestore.rules:206`). Keeping
`Full Viewer.comment = true` preserves that. Whether to also offer a *true* read-only
tier (no comment) is P4; the four-role set the product owner fixed does **not** include
one, so the recommendation is **keep Full Viewer comment-capable** and revisit later.

`PulseRole` widens to the preset labels (plus `custom` for advanced overrides, §5):

```ts
export type PulseRole =
  | "owner" | "editor" | "fullViewer" | "myBeatViewer" | "taskLead" | "custom";
// Back-compat: legacy "viewer" is read as fullViewer; legacy "editor" unchanged.
```

Both scoped roles **depend on the member being linked to a Resource** (`linkedUid`):

- **My-Beat Viewer, unlinked** → `assignedUids` never contains their uid → they **see
  no tasks** (empty beat). Epics/resources still readable for context (§4.3). UI warns
  and offers to link (§5), mirroring how the My-Beat toggle is disabled when unlinked
  (`Toolbar.tsx:220`).
- **Task Lead, unlinked** → `leadUid` never equals their uid → they can **edit no
  task** (read still full). UI warns and offers to link.

### 3.4 Role #4 name — recommendation

**Recommended: "Task Lead."** It reads naturally, binds directly to the existing
`Feature.lead` field ("lead of this task"), and doesn't collide with "Editor" the way
"Lead Editor" does. Alternatives considered:

| Candidate | Note |
|---|---|
| **Task Lead** ✅ | Recommended — ties to `feature.lead`; clear scope; no clash with Editor. |
| Lead | Too bare; reads as a noun/verb ambiguously. |
| Lead Editor | Clear but visually collides with "Editor" in the picker/badges. |
| Responsible Editor | Accurate ("responsible for") but wordy; "Editor" clash. |
| Lead Contributor | "Contributor" implies broad edit; misleads on the narrow scope. |
| Owner-editor | Actively confusing next to the real Owner role. |

Remaining references in this spec use **Task Lead**.

**Task Lead read scope (P5).** *Recommended:* **full read of the whole Pulse, edit
only led tasks.** A lead needs surrounding context (dependencies, other epics) to do
their job, and full read costs nothing in rules (no query constraints — the only
gate is on writes). *Alternative:* restrict read to led tasks (like My-Beat but keyed
on `leadUid`), which is enforceable the same way as §4.3 but hides context. Flagged
as an open decision; recommendation is full-read.

---

## 4. Enforcement — mapping to `firestore.rules`

### 4.1 Materialized caps + legacy fallback

Rules never derive the preset→caps table. `setMemberRole` / a new `setMemberCaps`
write both `role` (label) and the resolved `caps` bundle; rules read values directly.
Legacy docs (no `caps`) fall back to their old role, so **no backfill**:

```
function memberDoc(pulseId) {
  return get(/databases/$(database)/documents/pulses/$(pulseId)/pulseMembers/$(request.auth.uid)).data;
}
function myCaps(pulseId) {
  let m = memberDoc(pulseId);
  // Legacy: owner→all, editor→edit-all, viewer→full-read+comment (today's behaviour).
  return ('caps' in m) ? m.caps
    : m.role == 'owner'  ? {readScope:'all', editScope:'all', editEpics:true,  editResources:true,  editConfig:true,  comment:true, invite:true, manageMembers:true,  deletePulse:true}
    : m.role == 'editor' ? {readScope:'all', editScope:'all', editEpics:true,  editResources:true,  editConfig:true,  comment:true, invite:true, manageMembers:false, deletePulse:false}
    :                      {readScope:'all', editScope:'none',editEpics:false, editResources:false, editConfig:false, comment:true, invite:false,manageMembers:false, deletePulse:false};
}
function isPulseOwner(pulseId) { return isPulseMember(pulseId) && myCaps(pulseId).deletePulse; }
```

One `get()` per evaluation — same cost as today's `pulseRole`.

### 4.2 Two denormalized fields on `Feature`

To make the scoped roles enforceable with scalar tests, maintain two derived fields on
each `Feature` whenever assignments / lead / a resource's `linkedUid` change:

```ts
// src/types/index.ts — additions to Feature
assignedUids?: string[];   // linkedUid of every resource assigned to this feature OR any
                           // of its subtasks. Enables `uid in assignedUids` (My-Beat read).
leadUid?: string | null;   // linkedUid of the resource in `feature.lead`. Enables
                           // `uid == leadUid` (Task Lead write).
```

- `assignedUids` is needed (not raw `resources`) because (a) rules can't resolve a
  resource id → its `linkedUid` for each element of an array, and (b) subtask
  assignments live in `Feature.children[].resources` (array-of-objects), which rules
  can't iterate — the denorm flattens both into one scalar array.
- `leadUid` mirrors `feature.lead` (a resource id) as the lead's account uid.
- **Maintainer: client-maintained now (P12 resolved).** The write path already has the
  full resource roster in `pulseStore`, so the client writes both denorms on every
  feature write and performs the `linkedUid`-change fan-out (updating every referencing
  feature — a bounded loop it already runs for `myResourceIds`). The server hardening is
  **not** an open decision — it's tracked as **`Server-Functions-Spec.md` SF1** (Feature
  denormalization maintainer), which becomes authoritative when it ships.

### 4.3 My-Beat Viewer — restricted **read** (the query-shape crux)

Read gate on features OR-s a beat arm:

```
match /features/{featureId} {
  allow read: if isPulseMember(pulseId) && (
       myCaps(pulseId).readScope == 'all'
    || request.auth.uid in resource.data.get('assignedUids', []));
  // writes: §4.5
}
```

For a **single-doc `get`**, this is exact per-doc. For a **`list`**, Firestore requires
the query itself to guarantee only-allowed docs, so the **client must query**:

```ts
// My-Beat Viewer's feature subscription:
query(collection(db,'pulses',p,'features'), where('assignedUids','array-contains', uid))
```

Consequences to design around:

- A My-Beat Viewer's client **must not** issue an unconstrained `features` list — it
  would be rejected entirely (not filtered). `pulseStore.subscribeFeatures` needs a
  role-aware variant that adds the `array-contains` filter for `readScope == 'beat'`.
- **Composite index:** a lone `array-contains` on `assignedUids` needs **no composite
  index** (single-field). If the beat query is combined with an `orderBy` or another
  `where`, add a composite index to `firestore.indexes.json`. Recommendation: keep the
  beat query a bare `array-contains` (order client-side) to avoid the index.
- **Other collections for a My-Beat Viewer:**
  - `epics`, `resources` — **readable in full** (recommended): they're low-sensitivity
    structural context needed to render the rows/badges of the visible tasks. (Flag
    P6 if the roster must also be hidden.)
  - `comments` — a comment is visible iff its target feature is in the beat. Per-doc
    this is enforceable (`get()` the target feature, check `uid in assignedUids`); for
    lists the client queries comments **per visible feature** (comments are already
    fetched per-target in the DetailsTab flow). Pulse-level comments (`targetId==null`)
    → treat as visible to beat viewers (recommend) or hide (P6).
  - `pulse` doc, `presence`, own `notifications` — unchanged (membership-gated).

**Enforceability verdict (My-Beat Viewer): enforceable in rules, conditionally.** The
read *gate* is exact per document, but safe operation requires (i) the `assignedUids`
denorm and (ii) the client issuing the matching `array-contains` query — an
unconstrained list is refused wholesale. It is **not** "rules silently filter a broad
read"; that's not how Firestore lists work.

### 4.4 Task Lead — restricted **write** (clean)

Full read (recommended §3.4) ⇒ no read/query constraints at all. The only change is the
`features` **write** gate:

```
match /features/{featureId} {
  allow read: if isPulseMember(pulseId) && (myCaps(pulseId).readScope == 'all'
                 || request.auth.uid in resource.data.get('assignedUids', []));
  allow create: if isPulseMember(pulseId) && myCaps(pulseId).editScope == 'all';   // leads don't create
  allow update: if isPulseMember(pulseId) && (
       myCaps(pulseId).editScope == 'all'
    || (myCaps(pulseId).editScope == 'lead'
        && resource.data.get('leadUid', null) == request.auth.uid       // I lead it now
        && request.resource.data.get('leadUid', null) == request.auth.uid)); // can't hand off lead to escape scope
  allow delete: if isPulseMember(pulseId) && myCaps(pulseId).editScope == 'all';   // leads don't delete
}
```

- Pinning `leadUid` across the update stops a Task Lead reassigning `lead` away from
  themselves mid-edit to keep write access; changing who leads a task is an
  editor/owner action.
- **Field-level narrowing within a led task** (e.g. "a lead may set `status`/`notes`
  but not `duration`/`epicId`") is possible via `diff().affectedKeys().hasOnly([...])`
  but the content-vs-structure allow-list is brittle; **recommend client-only field
  narrowing for v1** (blast radius is limited to tasks the lead already legitimately
  owns). See P8.

**Enforceability verdict (Task Lead): fully enforceable in rules.** Per-doc `leadUid ==
uid` write gate with a pinned `leadUid`; no query constraints (full read); no composite
index. The clean case.

### 4.5 The other gates

| Surface | Today | Proposed |
|---|---|---|
| `epics` write (`:193`) | `canEditPulse` | `isPulseMember && myCaps(p).editEpics` |
| `resources` write (`:214`) | `canEditPulse` | `isPulseMember && myCaps(p).editResources` |
| `features` write | `canEditPulse` | §4.4 (scope-aware) |
| `pulses.update` (`:117`) | `canEditPulse` (+invite guard) | split by `affectedKeys()`: pure `invite` change ⇒ `myCaps(p).invite`; else ⇒ `myCaps(p).editConfig` (keep the "links can't grant owner" role allow-list) |
| `comments` create (`:206`) | `isPulseMember` | `isPulseMember && myCaps(p).comment` (+ read of a comment follows the feature's read gate, §4.3) |
| `comments` update/delete | author / owner | unchanged (author, or `deletePulse` owner-delete) |
| `joinLinks`/`invites` create | `canEditPulse` | `myCaps(p).invite` |
| `pulseMembers` update/delete | `isPulseOwner` | `myCaps(p).manageMembers` (+ self carve-out, §4.6) |
| `pulses` delete (`:120`) | `isPulseOwner` | `myCaps(p).deletePulse` |
| all **reads** except features/comments | `isPulseMember` | unchanged |

### 4.6 Preserving the invariants

- **No self-escalation.** The `pulseMembers` self-update rule keeps pinning identity
  and now also pins `caps`/`role`; add one self-writable hint field (`linkedResourceId`,
  §7) that is **advisory only** (rules never trust it for access — the authority is
  `Resource.linkedUid` and the feature denorms). So a My-Beat Viewer can't widen their
  own `readScope`, and a Task Lead can't grant themselves `editScope:'all'`:

  ```
  allow update: if myCaps(pulseId).manageMembers
    || (memberUid == request.auth.uid
        && request.resource.data.uid   == resource.data.uid
        && request.resource.data.role  == resource.data.role
        && request.resource.data.email == resource.data.email
        && request.resource.data.joinedAt == resource.data.joinedAt
        && request.resource.data.get('caps', null) == resource.data.get('caps', null));
  ```
- **Only manage-members may re-grant** roles/caps (owner keeps this; the four presets
  never get `manageMembers`).
- **`deletePulse` is the true "owner" bit**; `isPulseOwner` = `myCaps.deletePulse`, so
  delete and last-owner semantics are unchanged.
- **Last-owner "≥1 owner"** stays client-enforced (rules can't count) — already the
  case (`CollaboratorsDialog.tsx:39-40`).
- **Self-owned `myPulses` index untouched**; caps live only on the Pulse-side member
  doc. `MyPulseIndexEntry.role` stays a display cache.

### 4.7 What is client-side-only, and why acceptable

| Concern | Why not in rules | Acceptability |
|---|---|---|
| My-Beat Viewer must issue the `array-contains` query | Firestore lists gate on the query, not results | Client owns the query shape; a wrong query fails *closed* (rejected), never leaks. |
| Field narrowing within a Task-Lead's led task | Brittle field allow-list | Blast radius = tasks the lead already owns; rules still enforce *which* tasks. |
| `assignedUids`/`leadUid` integrity | Client maintains the denorm (now); `Server-Functions-Spec.md` SF1 later | Written only by editors (`editScope:'all'`); scoped roles can't write features, so can't forge their own inclusion/lead. A stale denorm fails **closed** (fewer tasks, never more). |
| "≥1 owner always" | No count/query in rules | Existing client guard; self-write can't drop own owner caps. |

None of these lets a user reach **another member's data** beyond their scope or touch
the Pulse lifecycle — the acceptable v1 line.

---

## 5. UX — assigning & displaying (extend `CollaboratorsDialog.tsx`)

- **Preset picker.** The Editor/Viewer `<select>` (`:124-133`) widens to **Owner ·
  Editor · Full Viewer · My-Beat Viewer · Task Lead**, each with a one-line helper:
  - Full Viewer — "reads & comments on the whole Pulse."
  - My-Beat Viewer — "sees only tasks their linked resource is on."
  - Task Lead — "edits only the tasks they lead; reads the rest." ("Make owner" stays
    the separate transfer action, `:134-141`.) Only a member with `manageMembers`
    (owner) sees the picker.
- **Linked-resource dependency surfaced inline.** For My-Beat Viewer and Task Lead,
  the row shows the linked resource; if the member is **unlinked**, show an amber
  "Not linked — sees nothing / can edit nothing until linked" warning with a deep-link
  to the Team-tab account-link dropdown (`TeamTab.tsx:186-200`) — mirroring the
  disabled-My-Beat-toggle affordance (`Toolbar.tsx:220`).
- **Badges.** `ROLE_BADGE` (`:19-23`) gains: Owner (orange), Editor (blue), Full
  Viewer (grey), My-Beat Viewer (teal, matching the link ring `#12A594`, tooltip "Sees
  only their beat"), Task Lead (violet, tooltip "Edits only tasks they lead"), Custom
  (dashed/neutral, tooltip lists enabled caps).
- **Advanced (optional).** An "Advanced…" disclosure exposes the raw capability
  toggles + the `readScope`/`editScope` selectors; any deviation from a preset flips
  the label to **Custom** with a "Reset to preset" link. Keeps the everyday path to
  "pick a role" while leaving full granularity available.
- **Self-view.** Non-managers see their own badge + a plain-language summary ("You can:
  see your beat, comment") so scoped members understand why parts of the Pulse are
  hidden or read-only.
- **Join-link roles.** The link role picker (Collaboration-Spec §3.1) may offer Full
  Viewer / My-Beat Viewer / Task Lead / Editor, never Owner (extends the existing
  "links can't mint owners" rule, `:117-119`). P7.

---

## 6. Interaction with the Teams / workspace layer

Supersedes Collaboration-Spec **D11b** (raise-only). **A per-Pulse grant overrides the
team role for that Pulse — it can narrow as well as raise** (product owner decision,
P11 resolved):

- **Team roles stay owner/editor/viewer** (Collaboration-Spec §3.2), mapping to the
  Owner/Editor/Full-Viewer bundles. They are the **default/floor only when the member
  has no per-Pulse membership doc** on that Pulse.
- **Per-Pulse membership is authoritative.** If a `pulseMembers/{uid}` doc exists for
  the Pulse, **its `caps` fully replace** the team-role bundle — higher *or* lower. So a
  team Editor can be set to **My-Beat Viewer** or **Task Lead** on one Pulse and is
  genuinely restricted there; scoped roles now bite team members too, not just guests.
- **Effective capability (no union):** `caps = pulseMembersDoc ? caps(pulseMembersDoc)
  : bundle(workspaceRole)`. Precedence is *presence of the per-Pulse doc*, not
  max-of-the-two.
- **Rule shape (changes from the old OR-cascade).** Reads/writes can **no longer** be a
  simple `isPulseMember || isWorkspaceMember` OR — that would re-grant the team floor and
  defeat a narrowing grant. Instead: `myCaps(pulseId)` = if the caller's
  `pulseMembers/{uid}` doc `exists()`, use its materialized `caps`; **else** `get()` the
  pulse doc for `workspaceId` and use the workspace-role bundle. Every gate (read, edit,
  beat, lead, manage) evaluates against that single resolved `caps`.

---

## 7. Data-model changes

Additive; existing docs stay valid.

**`PulseMember` (`types/index.ts:78-91`) — add:**

```ts
role: PulseRole;              // widened enum (§3.3): +fullViewer/myBeatViewer/taskLead/custom
caps?: Capabilities;          // materialized bundle rules read (§4.1). Absent on legacy docs.
linkedResourceId?: string|null; // ADVISORY hint of the member's linked resource; self-writable
                                // like photoURL. Rules never trust it for access (authority is
                                // Resource.linkedUid + the feature denorms) — UI convenience only.
```

**New types:** `Capabilities`, `ReadScope`, `EditScope` (§3.2); widened `PulseRole`.

**`Feature` (`types/index.ts:237-264`) — add (§4.2):**

```ts
assignedUids?: string[];      // linkedUids of resources on this feature or any subtask (My-Beat read)
leadUid?: string | null;      // linkedUid of feature.lead's resource (Task Lead write)
```

**`InviteLink`/`JoinLink.role`** widens to the link-grantable presets
(`fullViewer|myBeatViewer|taskLead|editor`), never owner (P7). No changes to
`Epic`/`Resource`/`Pulse`/`Workspace`.

**Defaults preserve today's behaviour:** a member with no `caps` is read via the
legacy fallback (§4.1) = owner/editor/viewer exactly as now. A feature with no
`assignedUids`/`leadUid` yields empty/absent in the scoped tests, so a My-Beat Viewer
sees it as *not* in their beat and a Task Lead as *not* led — until the denorm is
(re)written; full-read/full-edit roles ignore both fields.

**`firestore.indexes.json`:** no new index if the beat query is a bare
`array-contains` (§4.3); add a composite index only if beat queries gain an `orderBy`/
second `where`.

---

## 8. Migration & rollout

Each phase is independently shippable; 1–2 are behaviour-preserving.

1. **Caps plumbing, no behaviour change.** Add the `Capabilities` type, the
   preset→caps table (shared TS module + used to author the rule helper `myCaps`), and
   the legacy fallback. `setMemberRole` starts materializing `caps` alongside `role`.
   No backfill — legacy docs resolve via fallback; presets == old roles ⇒ no-op.
2. **Feature denorm groundwork.** Start maintaining `assignedUids`/`leadUid` on every
   feature write and on `linkedUid` changes, for **one release**, so existing features
   acquire the fields before any rule relies on them. Still no rule change.
3. **Task Lead (restricted write).** Ship the `features` write gate (§4.4), the preset,
   badge, and unlinked-warning. Cleanest scoped role; no client-query changes (full
   read). Editors/viewers unaffected.
4. **My-Beat Viewer (restricted read).** Ship the beat read gate (§4.3) **and** the
   role-aware `subscribeFeatures`/comments queries that add `array-contains`. Gate the
   rule behind the query change so a beat member's client never issues an
   unconstrained (now-rejected) list. Most delicate phase — sequence last.
5. **Split config/invite/manage gates + Advanced UI.** The `pulses.update`
   `affectedKeys()` split (§4.5) and the optional per-capability/`custom` UI (§5).

Rollback at any phase = stop writing the new field; the legacy fallback keeps older
docs working. No destructive migration.

---

## 9. Open decisions (P-list)

1. **P1 — Capability/scope model behind fixed presets.** *Recommend:* yes —
   `(readScope, editScope, bits)` materialized on the member doc, legacy fallback,
   five presets as the only UI. *Confirm.*
2. **P2 — The two `Feature` denorms (`assignedUids`, `leadUid`).** *Recommend:* adopt
   both — they're what make the scoped roles rule-enforceable with scalar tests.
   *Confirm the denormalization (and its maintenance cost, P12).*
3. **P3 — Owner unchanged; four presets in addition.** *Recommend & confirm:* Owner
   keeps full control + manage-members + delete; none of Editor/Full-Viewer/My-Beat-
   Viewer/Task-Lead get manage/delete. **(Product owner already fixed this.)**
4. **P4 — True read-only tier?** Today Full Viewer can comment (legacy behaviour). The
   fixed four-role set has no no-comment tier. *Recommend:* keep Full Viewer
   comment-capable; add a silent-viewer preset only if a real need appears.
5. **P5 — Task Lead read scope + name.** *Recommend:* name **"Task Lead"**; read scope
   **full Pulse, edit only led tasks** (context matters, costs nothing in rules).
   *Alternative:* read only led tasks (enforceable like §4.3, hides context). *Confirm
   name and full-read.*
6. **P6 — My-Beat Viewer's non-feature reads.** *Recommend:* epics + resources readable
   (context for the visible tasks); comments visible only on visible features
   (per-doc enforced, client queries per-feature); Pulse-level comments visible.
   *Confirm, or tighten to also hide the roster.*
7. **P7 — Link-grantable roles.** *Recommend:* links may grant Full Viewer / My-Beat
   Viewer / Task Lead / Editor, never Owner. *Confirm the scoped roles are
   link-grantable.*
8. **P8 — Field narrowing within a Task-Lead's led task.** *Recommend:* client-only
   for v1 (rules enforce *which* tasks, not *which fields*). *Confirm client-only is
   acceptable.*
9. **P9 — Per-epic / per-field ACLs.** Explicit **non-goal** (§2). *Confirm deferral.*
10. **P10 — Materialized caps vs derive-in-rules.** *Recommend:* materialize on the
    member doc (rules read values; one `get()`), legacy fallback, no backfill.
    *Confirm the client↔rules preset table sync is acceptable.*
11. **P11 — Teams composition. ✅ RESOLVED (raise-only removed).** A per-Pulse grant is
    **authoritative for that Pulse and may narrow *or* raise** the team floor (§6);
    presence of a `pulseMembers` doc replaces the team role. So My-Beat Viewer / Task
    Lead now restrict team members too. Supersedes Collaboration-Spec D11b; rules resolve
    a single `caps` (per-Pulse doc if present, else workspace role) — **no** OR-cascade.
12. **P12 — `assignedUids`/`leadUid` maintainer. ✅ RESOLVED (client-maintained now).**
    The client maintains both denorms and the `linkedUid`-change fan-out in v1. Server
    hardening is tracked as **`Server-Functions-Spec.md` SF1** (not a loose open
    decision); it becomes authoritative when it ships.
```
