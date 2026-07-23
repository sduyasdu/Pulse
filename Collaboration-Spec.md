# Pulse — Collaboration Specification

Status: **Decisions confirmed (D1–D12) — ready to build** · Scope: documents today's shipped
collaboration model, then proposes enhancements. Two directions are now **chosen,
not optional**: (1) activate the dormant workspace layer into real **Teams** that
own Pulses; (2) replace emailed invites with a **copy-link join** model. Both are
called out below. Enhancements are phased; nothing here is built yet unless §1
says it is.

## 1. Current state (what ships today)

Pulse already has a real, working multi-tenant collaboration model. This section
documents it precisely — every proposal in §3+ builds on these exact shapes and
invariants, so they are load-bearing.

### 1.1 Identity & auth

- Firebase Auth (email/password + Google popup) is the identity source
  (`src/stores/authStore.ts:65-96`). `onAuthStateChanged` drives an
  `initializing` → `bootstrapping` → ready lifecycle (`authStore.ts:48-63`).
- On first sign-in, `bootstrap()` (`authStore.ts:33-39`) calls `ensureUserDoc`
  (`src/services/firestore/users.ts:9-24`), which idempotently creates
  `users/{uid}` **and** a personal workspace, then `resolvePendingInvites` (§1.4),
  then reads back the `UserDoc`.
- `RequireAuth` (`src/routes/RequireAuth.tsx:5-19`) blocks the app until both
  `initializing` and `bootstrapping` are false — so the dashboard never queries
  `myPulses` before a freshly-accepted invite has been indexed
  (`authStore.ts:20-24`).
- The verified auth-token email (`request.auth.token.email.lower()`,
  `firestore.rules:33-35`) is the join key for the current invite system. Its
  client-side twin is `emailKey()` (`src/services/firestore/emailKey.ts`) —
  `trim().toLowerCase()` — used as both the invite document id and the value
  compared in rules. (The copy-link model in §3.1 removes this dependency.)

### 1.2 Workspaces (personal only, today — now the basis for Teams)

- `UserDoc.personalWorkspaceId` (`src/types/index.ts:15`); every user gets one
  personal workspace at bootstrap (`createPersonalWorkspace`,
  `src/services/firestore/workspaces.ts:15-30`), created as two **sequential**
  writes (workspace doc, then `workspaceMembers/{uid}` as `owner`) because the
  member-create rule `get()`s the workspace doc and can't see a same-batch,
  not-yet-committed write (`workspaces.ts:5-14`; `firestore.rules:83-89`).
- `WorkspaceRole = "owner" | "member"` (`types/index.ts:27`) and the whole
  `workspaces/**` rules block (`firestore.rules:74-90`), plus the helpers
  `isWorkspaceMember`/`workspaceRole` (`firestore.rules:38-44`), already exist —
  but **workspaces are not yet a user-facing collaboration surface**. Every new
  Pulse is created in the creator's *personal* workspace
  (`DashboardPage.tsx:178-182`, `duplicatePulse` §1.7); there is no UI to create a
  shared workspace, invite people *to a workspace*, or list its members, and no
  rule anywhere grants Pulse access *via* workspace membership. The workspace
  layer is dormant plumbing that per-Pulse sharing bypasses. **§3.2 makes this the
  chosen "Teams" direction.**

### 1.3 Roles — owner / editor / viewer

`PulseRole = "owner" | "editor" | "viewer"` (`types/index.ts:74`). The
authoritative record is `pulses/{pulseId}/pulseMembers/{uid}`
(`PulseMember`, `types/index.ts:76-81`). What each can do:

| Capability | Owner | Editor | Viewer |
|---|---|---|---|
| Read all Pulse data (epics/features/resources) | ✅ | ✅ | ✅ |
| Edit canvas/board/tasks/resources | ✅ | ✅ | ❌ |
| Invite collaborators / revoke invites | ✅ | ✅ | ❌ |
| Change another member's role | ✅ | ❌ | ❌ |
| Remove a member | ✅ | ❌ | ❌ |
| Delete the Pulse | ✅ | ❌ | ❌ |

Enforcement is two-layer, and the rules layer is authoritative:

- **Rules:** `canEditPulse` = member with role in `['owner','editor']`
  (`firestore.rules:54-56`) gates every `epics`/`features`/`resources` write
  (`firestore.rules:143-156`) and `pulses` update (`:105`); `isPulseOwner`
  (`:57-59`) gates Pulse delete (`:106`), `pulseMembers` update/delete (`:122`),
  i.e. role changes and member removal.
- **Client:** `usePulseStore.roleOf(uid)` reads the live `members` roster
  (`src/stores/pulseStore.ts:126`); `PulsePage` derives
  `canEdit = myRole === "owner" || "editor"` (`PulsePage.tsx:90-91`) and gates
  every mutation, the toolbar, undo/redo (`PulsePage.tsx:95-96`), and the Invite
  button. `CollaboratorsDialog` derives `canManage` (owner|editor, may invite)
  and `isOwner` (may remove / re-role) (`CollaboratorsDialog.tsx:37-38`). A viewer
  who forged a client write is still denied by rules.

The role model is **coarse: per-Pulse, whole-Pulse.** No per-epic, per-field, or
"comment-only" role, and editors — not just owners — can invite (§3.8).

### 1.4 Invite-by-email via the discovery index (being replaced — §3.1)

There are **no collection-group queries** anywhere in the model. The file-level
comment in `firestore.rules:1-25` explains why: the emulator rejects any
collection-group `list` the instant its rule references `request.auth`. So
"everything I can access" and "who invited me" are served by two denormalized,
self-listed indexes, each a *pure convenience cache* that never grants access —
real reads/writes are always re-checked against the true `pulseMembers` doc.

Inviting (`inviteToPulse`, `src/services/firestore/invites.ts:16-24`) writes two
docs in one batch:

1. `pulses/{pulseId}/invites/{emailKey}` — the authoritative `Invite`
   (`types/index.ts:90-98`): `{ email, role, invitedBy, createdAt }`. Create is
   gated by `canEditPulse` and `email == emailId` (`firestore.rules:136`).
2. `inviteIndex/{emailKey}/pending/{pulseId}` — a `PendingInviteEntry`
   (`types/index.ts:122-127`) the invitee can discover *before they even have an
   account*. Create is gated by `canEditPulse(pulseId)`; read/delete only by the
   owner of that email (`emailId == myEmail()`, `firestore.rules:93-98`).

**No email is actually sent.** `inviteToPulse` writes Firestore docs and nothing
else — no Cloud Function, no mail extension (`functions/` does not exist; no
`nodemailer`/`sendgrid`/`firestore-send-email` anywhere in the tree). The UI is
honest about this: `InviteDialog` says *"They'll get access as soon as they sign
in with this email"* (`InviteDialog.tsx:41-43`); "sent" means "indexed." An
invitee only learns they were invited if they independently sign in with that
email. This "forget email delivery for now" state is exactly what §3.1 replaces —
and because email was never delivered, replacing it loses no working behavior.

### 1.5 Accepting / joining

`resolvePendingInvites(uid, email)` (`users.ts:35-75`) runs on every sign-in
(via `bootstrap`, `authStore.ts:36`). For each `inviteIndex/{email}/pending/*`:

- Writes `pulses/{pulseId}/pulseMembers/{uid}` with the pending role. The rule
  (`firestore.rules:110-121`, "Case 2") independently re-validates: the caller
  may only self-create their own member doc, `myEmail()` must be non-empty, an
  `invites/{myEmail()}` doc must exist, **and** its `role` must equal the role
  being written. A client claiming a bogus role is denied.
- Writes the `users/{uid}/myPulses/{pulseId}` dashboard entry
  (`MyPulseIndexEntry`, `types/index.ts:108-115`).
- Batch-deletes both the `invites` doc and the `inviteIndex` pointer.
- On any failure (e.g. invite revoked mid-flight) it drops just that stale
  pointer and continues (`users.ts:66-72`) — one bad invite never fails the batch.

The Pulse creator's own membership is the other create path
(`firestore.rules:110-114`, "Case 1"): `createPulse` self-writes an `owner`
`pulseMembers` doc, allowed because the pulse doc's `createdBy == request.auth.uid`
(`pulses.ts:44-45`). The copy-link model (§3.1) adds a **third** create case,
token-bound rather than email-bound.

### 1.6 The `myPulses` dashboard index & its self-heal

`subscribeMyPulses` (`pulses.ts:139-142`) live-lists `users/{uid}/myPulses`
ordered by `joinedAt`. The dashboard (`DashboardPage.tsx`) splits it three ways —
**Your Pulses** (role `owner`), **Shared with me** (role ≠ owner), **Archived**
(`entry.archived`) — filtered by a name search (`DashboardPage.tsx:63-69`).

The index is self-owned: `users/{uid}/myPulses/{pulseId}` is read/write only by
`uid` itself (`firestore.rules:69-71`). Because **no one else can write another
user's index**, entries go stale (owner changed your role or removed you; the
Pulse was deleted) and must be **self-healed by the affected user's own client**:

- Dashboard effect (`DashboardPage.tsx:35-56`): for each entry, `fetchMembership`
  (`memberships.ts:16-19`, always self-readable even after removal) — if `null`,
  `removeMyPulseEntry` drops the dangling card (`pulses.ts:153-155`); if the role
  differs, `updateMyPulseRole` reconciles the cached label (`pulses.ts:168-170`).
  Only acts on a definitive read; transient errors are left for a later retry.
- `PulsePage` effect (`PulsePage.tsx:116-121`): if the opened Pulse is `notFound`
  or `myRole === null`, drop the entry and bounce to the dashboard. `load()`
  carefully waits for **both** the pulse doc and the members roster before
  clearing `loading`, so this check never misfires on a half-loaded state
  (`pulseStore.ts:96-122`).

This self-owned-index / self-heal pattern is a load-bearing invariant that **every
new feature below must preserve**: a client can never write another user's index
or inbox, so anything that needs to reach *another* user's own docs is either
self-healed by that user's client or (for a tamper-proof cross-user write) done
server-side.

### 1.7 Manage collaborators — invite / revoke / role-change / remove

`CollaboratorsDialog` (`CollaboratorsDialog.tsx`), reached from the in-Pulse
**Invite** button (`PulsePage.tsx:428-437`, `MobilePulseView.tsx:56-60`,
`136-145`), is the full management surface:

- **Members list** with role badges; owner can re-role non-owner members via a
  select (`setMemberRole` → owner-only rule) and **Remove** them (`removeMember`,
  behind a `confirmAt` guard). You can't change your own role and can't demote
  another owner (`CollaboratorsDialog.tsx:124`) — a guard against the last owner
  locking themselves out.
- **Pending invitations** list (owner/editor), loaded via `fetchInvites`
  (`invites.ts:8-11`), each **Revoke**-able (`revokeInvite`, `invites.ts:27-33`).
- **Invite form** (editor/viewer roles only, no "invite as owner").

§3.1 reframes this dialog around **Copy invite link** (role picker + revoke +
regenerate); the members list and role management stay.

The dashboard also has a lighter `InviteDialog` (`InviteDialog.tsx`) wired to
`inviteToPulse` for inviting without opening a Pulse (`DashboardPage.tsx:189-197`).

### 1.8 Archive & delete semantics

- **Archive** is per-user and non-destructive: `setMyPulseArchived`
  (`pulses.ts:161-163`) flips `archived` on *your own* index entry only, hiding
  the Pulse into your Archived section without touching the shared Pulse or
  anyone else's view.
- **Delete** is owner-only and global: `deletePulse` (`pulses.ts:207-223`)
  cascade-deletes `invites`/`epics`/`features`/`resources`, then the pulse doc,
  then `pulseMembers` **last** (deleting your own member doc first would deny
  every subsequent step, `pulses.ts:208-211`), then your own index entry. It
  **cannot** clean other members' `myPulses` entries — their client self-heals
  them. The dashboard warns delete "erases the Pulse and all its data for
  everyone" and suggests archiving instead (`DashboardPage.tsx:72-76`).

### 1.9 Live sync & the Resource↔account link

- Every Pulse view is driven by `onSnapshot` (`pulseStore.ts:108-122`):
  `subscribePulse`, `subscribeEpics`, `subscribeFeatures`, `subscribeResources`,
  `subscribePulseMembers`. **Firestore is the source of truth; there is no
  optimistic layer** (see Undo-Spec.md §2). Two people editing the same Pulse
  already see each other's writes land live — the *data* plane of "real-time
  collaboration" exists; the *awareness* plane (presence, cursors) does not.
- A `Resource` (a team-member row on the canvas) can be linked 1:1 to a real
  member account via `Resource.linkedUid` (`types/index.ts:206-215`). The **write
  side already exists**: the Team tab renders a per-resource "link to account"
  dropdown over the member roster and writes it via
  `patchResource(r.id, { linkedUid })` (`src/components/leftPanel/TeamTab.tsx:173-186`),
  with the linked state shown as a teal ring / tooltip (`TeamTab.tsx:104,117`).
  What's **unused is the read/consume side**: nothing keys collaboration behavior
  off `linkedUid` (e.g. "assign to a resource → notify the linked account", or
  auto-linking on join). `Invite.linkResourceId` (`types/index.ts:96-97`) is the
  matching accept-time hook, and it is genuinely unused — `inviteToPulse` never
  sets it. §3.1/§5 wire the read side into the join flow.

## 2. Gaps & goals

What's missing or rough today, in rough priority order:

1. **Invites are undeliverable and email-bound.** The "forget email delivery"
   state (§1.4): an invitee is never notified; discovery depends on them signing
   in with the exact invited email by chance. **Chosen fix: copy-link (§3.1).**
2. **No team layer.** Sharing is per-Pulse, so onboarding the same 5 teammates to
   10 Pulses is 50 manual grants with no group concept; the `workspaces` model
   that should solve this is dormant (§1.2). **Chosen fix: Teams (§3.2).**
3. **No ownership transfer and no self-leave.** Only *an owner removing someone
   else* exists (§1.7). An owner can't hand off ownership, and a member can't
   remove themselves (archiving only hides their card while leaving them a live
   member). The last-owner guard means an owner can't cleanly exit (§3.3).
4. **No awareness / presence.** Data syncs live, but you can't see who else is
   viewing/editing, or who's on the box you're editing (§3.4).
5. **No comments / @mentions** on tasks (§3.5).
6. **No notifications** of any kind — invite/mention/assignment/status (§3.6).
7. **No activity / audit log** — who changed what, when (§3.7).
8. **Coarse permissions** — per-Pulse whole-Pulse only; no comment-only role;
   editors can invite (§3.8).

Design goals for the enhancements: keep Firestore the source of truth; preserve
"indexes/inboxes are self-owned convenience caches, never security boundaries";
keep every new write independently re-validated against `pulseMembers` (or, for
Teams, workspace membership); keep "a client can never write another user's
index"; **prefer serverless** (rules + client) wherever a Cloud Function isn't
strictly required. As §3.1 and §3.9 make explicit, moving invites to links makes
the *entire near-term slice serverless*.

## 3. Proposed features

Each subsection carries a numbered decision (**Dn**) and a recommendation.
Security-rules detail is consolidated in §4, data shapes in §5. The two chosen
directions lead: **copy-link invites (§3.1)** and **Teams (§3.2)**.

### 3.1 Copy-link join model (replaces emailed invites)

**Chosen direction.** Instead of inviting by email address, an owner/editor
**generates a shareable join link** for a Pulse, picks the role it grants
(default **viewer**, optionally **editor**), copies it, and sends it however they
like (Slack, email, DM). **Pulse does not deliver anything** — which is exactly
why this needs no Cloud Function and no mail provider (§3.9).

**Link doc.** `pulses/{pulseId}/joinLinks/{token}`, where `token` is an
unguessable random doc id (≥128 bits) — **the token is the secret / the
capability.** Fields (`JoinLink`, §5): `{ role, createdBy, createdAt, expiresAt?,
disabled? }`. A Pulse can have more than one live link (e.g. a viewer link and an
editor link). Revocation = **delete the link doc** (or flip `disabled`);
regeneration = delete + create a new token, invalidating the old URL.

**Join flow.** The invitee opens `/join/p/{pulseId}/{token}` and, once signed in:

1. Reads `pulses/{pulseId}/joinLinks/{token}` by exact path — a `get` by known id,
   never a `list` (tokens can't be enumerated). Rule: any signed-in user who
   *knows the token* may read that one doc.
2. Self-creates `pulses/{pulseId}/pulseMembers/{uid}` with `role = link.role` and
   `joinToken = token` on the written doc so the rule can re-validate the token
   server-side (§4). New "Case 3" in the `pulseMembers.create` rule
   (`firestore.rules:110-121`): allowed iff `memberUid == request.auth.uid`, the
   referenced `joinLinks/{joinToken}` exists, its `role` equals the role being
   written, and it's neither disabled nor expired.
3. Self-writes `users/{uid}/myPulses/{pulseId}` (already self-writable, §1.6).

Idempotency: re-opening a link when already a member is a no-op (or a role-upgrade
prompt if the link grants more than the current role — recommend no automatic
downgrade). If already a member at ≥ the link role, just navigate in.

**UI reframe (§1.7).** `CollaboratorsDialog` becomes a **Share** panel: a "Copy
invite link" button with a role toggle (Viewer default · Editor), the live-link
list with per-link **Revoke** / **Regenerate** and an optional expiry, alongside
the existing members list and owner role-management. The email input, the
"Pending invitations" list, and the dashboard `InviteDialog` email path all go
away.

**Reconciling with the email/inviteIndex mechanism.** Recommend **retiring
email-address invites entirely and going link-only**: remove the invite-creation
UI immediately; retire `invites.ts` (`inviteToPulse`/`revokeInvite`/`fetchInvites`),
the `pulses/{p}/invites` subcollection, the `inviteIndex/**` tree, and the
`invites`/`inviteIndex` rules blocks (`firestore.rules:92-99,125-141`). For a
clean cutover, keep the **accept side** (`resolvePendingInvites`, `users.ts:35-75`)
running for one deprecation window so already-created pending invites still
convert on next sign-in, then delete it and the `inviteIndex` docs. Nothing is
lost by dropping email invites, because email was never delivered (§1.4). The one
capability email invites had that links don't — *pre-binding a specific person to
a specific resource row* via `linkResourceId` — is preserved differently: after a
member joins by link, the Team tab's existing account-link dropdown
(`TeamTab.tsx:173-186`) binds them to a resource (§1.9); or a link may optionally
carry a `linkResourceId` to auto-bind on join (§5, D10).

**D1 (recommend): go link-only.** `pulses/{p}/joinLinks/{token}` with token-as-id,
default viewer / optional editor, revoke = delete, regenerate = new token.
Token-bound self-join replaces email-bound Case 2. Retire `invites`/`inviteIndex`
after a one-release deprecation window for the accept side. **No email, no server.**

### 3.2 Teams (activate the workspace layer)

**Chosen direction.** Turn the dormant `workspaces` layer (§1.2) into a real
**Team**: a shared space that multiple people belong to and that **owns Pulses**.
Adding someone to a Team grants them access to **every Pulse in that Team**, so a
team of collaborators is set up once, not per-Pulse.

**Access model — cascade, plus per-Pulse guests (recommended).** A Pulse's read
becomes:

```
allow read: if isPulseMember(pulseId)
          || isWorkspaceMember(get(/pulses/$(pulseId)).data.workspaceId);
```

and writes similarly OR-in the team-role check. So there are **two independent
grant sources**, unioned:

- **Team membership** cascades to *all* Pulses whose `workspaceId` is that team —
  the rule reads the pulse doc's `workspaceId` and checks
  `workspaceMembers/{uid}` (helpers already exist, `firestore.rules:38-44`).
- **Per-Pulse `pulseMembers`** still works unchanged, for **guests** — external
  collaborators who should see *one* Pulse but not join the whole team. This is
  why we keep `pulseMembers` rather than folding everything into workspace
  membership: guests are a real need, and it preserves today's model as a subset.

Effective capability on a Pulse = **the higher of** the user's team role and any
per-Pulse role. This union means a team viewer can be bumped to editor on a single
Pulse via a per-Pulse grant, and a guest with no team membership still works
exactly as today.

Cost/consequence to accept: cascading reads/writes make the rule `get()` the pulse
doc (one extra document read per rule evaluation on subcollection access) to learn
`workspaceId`. That's the standard price of the cascade and is acceptable; the
alternative (denormalizing `workspaceId` onto every epic/feature/resource doc)
isn't worth the write-amplification.

**Team roles vs Pulse roles — unify to three tiers (recommended).** Today
`WorkspaceRole = "owner" | "member"` is too coarse. Widen it to mirror
`PulseRole`: **`owner` · `editor` · `viewer`** at the team level, so there's *one*
mental model. Mapping to Pulse capability:

| Team role | On every Pulse in the team | Team-management powers |
|---|---|---|
| owner | owner-equivalent (incl. delete) | rename team, manage team members, generate team links, delete team |
| editor | editor-equivalent | — |
| viewer | viewer-equivalent (read-only) | — |

A per-Pulse `pulseMembers` grant can only *raise* effective capability above the
team role, never lower it (no per-Pulse "revoke from the team" in v1 — that's a
sharp edge; see D11).

**Personal workspace stays private (recommended).** The auto-created personal
workspace (`isPersonal: true`, `workspaces.ts:15-30`) remains a **private,
single-member** space — it is *not* upgradable to a shared team, because
"upgrading" it would retroactively expose every private Pulse a user ever made.
Instead, users **create separate, named Teams**. To share an existing personal
Pulse, the owner **moves it into a Team** by changing its `workspaceId` (an
owner-only action; the pulse `update` rule already requires `canEditPulse`, and we
add a guard that the target workspace is one the caller owns). New Pulses can be
created directly inside a Team.

**Creating / naming / inviting to a Team.**

- **Create:** reuse the `createPersonalWorkspace` two-sequential-write pattern
  (`workspaces.ts:15-30`) with `isPersonal: false` and a user-supplied name;
  creator becomes team `owner`.
- **Invite to a Team:** a **team join link** (§3.1 applied to teams):
  `workspaces/{wsId}/joinLinks/{token}`, granting a team role. Opening it
  self-creates `workspaceMembers/{uid}`, token-validated exactly like the Pulse
  case. Same serverless copy-link UX, one level up.

**Dashboard grouping & team switcher.** Add a team selector to the dashboard
header: **Personal** + each Team the user belongs to. Selecting a Team shows that
Team's Pulses grouped as today (active / archived). Two wiring notes:

- Listing a Team's Pulses is a **plain, filtered query** on the top-level `pulses`
  collection — `query(collection(db,'pulses'), where('workspaceId','==',wsId))` —
  **not** a collection-group query, so it's allowed under the founding constraint
  (`firestore.rules:1-25` only bans collection-*group* lists). Guard it with a new
  `allow list` rule keyed to `isWorkspaceMember(resource.data.workspaceId)` (§4).
  This is how a team member sees Pulses they were never per-Pulse-invited to
  **without** anyone writing into their self-owned `myPulses` index — the §1.6
  invariant holds.
- `myPulses` remains the index for **personal + guest** Pulses (the cases where
  the user *does* have a `pulseMembers` doc). Team-cascade Pulses are discovered
  via the filtered query above, not `myPulses`. `MyPulseIndexEntry.workspaceId`
  already exists (`types/index.ts:110`) for grouping the ones that are indexed.

**Team member management.** A Team settings surface (mirrors `CollaboratorsDialog`):
member list with team-role management (owner-only), remove member, generate/revoke
team links. `workspaceMembers` update/delete is already owner-gated
(`firestore.rules:88`).

**Migration (additive, no forced rewrite).** Every existing Pulse already has a
`workspaceId` pointing at its creator's personal workspace (`createPulse`,
`pulses.ts:30-42`). So:

- Existing Pulses stay exactly as they are — private in their owner's personal
  workspace, shared (if at all) via per-Pulse `pulseMembers`. Nothing breaks.
- The upgrade path is opt-in: create a Team, then **move** chosen Pulses into it
  (change `workspaceId`) and/or create new Pulses there. Per-Pulse guests on a
  moved Pulse keep working (union model).
- No backfill job, no data rewrite, no downtime. The only global change is the
  rule edit that OR-s workspace membership into Pulse reads/writes.

**D2 (recommend the union-cascade model):** Team = shared `workspaces` doc
(`isPersonal:false`); team membership cascades access to all its Pulses via a rule
`get()` on the pulse's `workspaceId`; per-Pulse `pulseMembers` guests still
allowed; effective role = max(team, per-Pulse). Team roles unified to
owner/editor/viewer. Personal workspace stays private and single-member; sharing
is via separate named Teams and moving Pulses into them. Invite to a team by team
join link (§3.1). Dashboard team switcher; team Pulses listed via a filtered
(non-collection-group) `pulses` query. Migration is additive.

### 3.3 Ownership transfer & leave-Pulse (near-term, serverless)

Two missing lifecycle actions (§2.3), both rules+UI only:

- **Transfer ownership:** owner promotes another member to `owner` (optionally
  self-demoting to editor). `setMemberRole` already sets any role via the
  owner-only rule (`memberships.ts:22-24`, `firestore.rules:122`); the UI just
  declines to offer "owner" today (`CollaboratorsDialog.tsx:22-25,140-142`). So
  this is a **UI + guard** change: allow "Make owner", keep the "≥1 owner always"
  invariant. **Quick win.**
- **Leave Pulse:** a member deletes **their own** `pulseMembers/{uid}` + `myPulses`
  docs. Needs a **one-line rules addition**: today `pulseMembers` delete is
  `isPulseOwner` only (`firestore.rules:122`); add
  `|| memberUid == request.auth.uid`. An owner may only leave after transfer or if
  another owner exists (reuse the last-owner guard). **Quick win.**

**D3 (recommend both):** "Make owner" transfer with a last-owner guard, and
"Leave Pulse" as a self-delete of one's own `pulseMembers` + `myPulses` (needs the
`memberUid == request.auth.uid` self-delete rule). For a Team, "leave team" is the
analogous self-delete of one's own `workspaceMembers` doc.

### 3.4 Real-time presence & concurrent editing

Today's data plane is live (§1.9); this adds the **awareness** plane.

**Presence — who's here.**

- **A — RTDB presence** (canonical): `onDisconnect()` clears a user's node when
  the tab dies — no Firestore equivalent. Cost: adds Realtime Database.
- **B — Firestore heartbeat** at `pulses/{pulseId}/presence/{uid}` with `lastSeen`
  refreshed ~every 20s (>45s stale ⇒ gone). One database, one rules file; departure
  is inferred from a stale heartbeat, not instant.

Surfaces as **avatar chips** in the Pulse header ("3 here") and a per-box "editing
now" indicator when a member's `presence.focusId` matches a feature id (`focusId`
reuses the existing `selectedId`, `PulsePage.tsx:138,190-193`).

**Concurrent editing.** Field-scoped `updateFeature` patches already let two people
edit *different* fields of the same task simultaneously (`pulseStore.ts:211-217`).
Hard cases: same-field-same-instant is last-writer-wins (Firestore default),
mitigated socially by the "editing now" chip, not a hard lock; canvas drags are
high-frequency streams (Undo-Spec.md §2.6) where presence is the pragmatic guard.
No OT/CRDT.

**Interaction with Undo.** Undo-Spec.md is explicitly **single-user, in-memory,
per-Pulse, field-level** (Undo-Spec.md §8, D1). Undo issues *inverse writes*
through the same `canEditPulse` path, not a snapshot rollback — so it never
resurrects a teammate's edit to *other* fields (Undo-Spec.md §6). Presence just
makes it visible *why* an undo might not fully revert. Shared/collaborative undo
(OT/CRDT, server history) stays a **non-goal** (Undo-Spec.md §10).

**D4 (recommend B):** Firestore heartbeat presence (`presence/{uid}` + `focusId`),
header avatars + "editing now" chip; last-writer-wins concurrency, no hard locks,
no OT/CRDT, no shared undo. Revisit RTDB (A) only if instant-departure accuracy
proves necessary.

### 3.5 Comments / @mentions on tasks

Threaded comments scoped to a feature:
`pulses/{pulseId}/features/{featureId}/comments/{commentId}` (`Comment`, §5).

- **Read:** any Pulse member (or team member — §3.2). **Author:** any member
  **including viewers** (comment-only participation is the one write a viewer
  should have — see D8/D11). **Edit/delete:** author only; owner may delete any.
- **@mentions:** autocomplete over the member roster (`pulseStore.members`),
  storing mentioned `uid`s in `mentions[]` to drive a notification (§3.6) /
  activity entry (§3.7). Mentioning a non-member is disallowed (they can't read
  the Pulse); offer "share a link instead" (§3.1).
- **Surfacing:** comment count + latest snippet on `DetailsTab` for the selected
  feature, and a Kanban-card comment badge (consistent with the card icon row,
  Kanban-Spec.md §4).

**D5 (recommend):** task-scoped comment subcollection; members read; any member
(incl. viewer) authors; author/owner edit-delete; `mentions[]` of member uids.
Surface as a DetailsTab thread + card badge. Client+rules only — **no server for
the comments themselves** (only cross-user *mention notifications* need §3.6).

### 3.6 Notifications

A per-user inbox at `users/{uid}/notifications/{id}` (`Notification`, §5), self-
owned exactly like `myPulses` (`firestore.rules:69-71`), listed live for a header
bell + unread count. Types: `invite-link-used | mention | assignment |
status-change | comment | role-change | removed`.

**Who writes them?** Under the self-owned rule, user A physically **cannot** write
into user B's `notifications` (§1.6). So notifications *for other people* must be
produced **server-side by a Cloud Function** reacting to the triggering writes
(comment with `mentions`, feature `resources`/`status` change, role change). This
is now **the main reason a backend would exist at all** (§3.9): invites went
serverless (§3.1), so notifications and the audit log (§3.7) are the only
server-needing features — and both are optional/deferrable.

Channels: **in-app first** (the inbox). Because Pulse no longer sends any email
(§3.1), an email channel would re-introduce a mail provider — recommend **in-app
only for v1**, revisit email later (D12).

**D6 (recommend, deferred):** self-owned `users/{uid}/notifications` inbox for
in-app; cross-user entries **written by a Cloud Function**, never by another
client. Start with mention + assignment types. In-app only (no email in v1).
Deferred behind the serverless slice.

### 3.7 Activity / audit log

Append-only per-Pulse feed at `pulses/{pulseId}/activity/{id}` (`Activity`, §5).

- **Read:** any member/team member. **Write:** **server-only via Cloud Function**
  strongly preferred — an audit log a client can forge or selectively omit isn't
  an audit log. (Client-first interim: `create` for `canEditPulse`,
  `update`/`delete` = `false`.)
- **Volume:** log **logical actions**, not throttled drag frames — hook the same
  store-mutation boundary the Undo engine records at (`recordSingle`/`recordMany`,
  `pulseStore.ts`), so one gesture = one entry (matches Undo-Spec.md §5).

**D7 (recommend):** per-Pulse append-only `activity`, written server-side by a
Cloud Function at the logical-action boundary; members read. Ships after
notifications (shares the — optional — backend).

### 3.8 Permission granularity

Coarse today (§1.3). Candidate refinements:

- **Comment-only viewers** — viewers can't edit data but *can* comment (§3.5).
  Cheapest useful bump; recommend shipping with comments.
- **Who may create a link / share** — today editors can invite (`canEditPulse` on
  `invites`, `firestore.rules:136`). For links (§3.1), decide whether link
  *creation* is `canEditPulse` (owner+editor) or `isPulseOwner` (owner-only).
  Policy tradeoff (fewer people can grow the team). See D11.
- **Per-epic / per-field scoping** — large model change (rules consulting per-epic
  ACLs on every `features` write); explicit **non-goal** for now.

**D8 (recommend):** comment-only viewers now; treat "link creation owner-only" as
a policy toggle to confirm (D11); defer per-epic/field scoping.

### 3.9 Serverless reframing (consequence of §3.1)

Moving invites to copy-links (§3.1) removes the only feature that *required* a
backend for delivery. The result:

- **Serverless (rules + client only):** copy-link invites (§3.1), Teams (§3.2),
  ownership transfer + leave (§3.3), presence (§3.4), comments (§3.5). This is the
  entire near-term roadmap.
- **Needs a backend (optional, deferrable):** cross-user notifications (§3.6) and a
  tamper-proof audit log (§3.7) — because a client can't write another user's inbox
  and shouldn't be trusted to write an audit record. Both have client-first interim
  forms and can wait.

So `functions/` (which doesn't exist today) is **no longer on the critical path**
and may never be needed if we accept in-app-only notifications written at the
client's own boundary or skip the audit log. This is the D9 reframe.

## 4. Security-rules impact

Rules delta per feature, preserving the invariants: (i) nothing under
`pulses/{pulseId}/**` is reachable without either a `pulseMembers/{uid}` doc **or**
team membership; (ii) indexes/inboxes are self-owned and never grant access;
(iii) a client can never write **another** user's index/inbox; (iv) no
collection-*group* queries.

| Feature | Collection(s) | Read | Write |
|---|---|---|---|
| Join links (§3.1) | `pulses/{p}/joinLinks/{token}` | `get`: `isSignedIn()` (token = capability); **no `list`** | create/delete: `canEditPulse(p)` (or `isPulseOwner`, D11) |
| Token self-join (§3.1) | `pulses/{p}/pulseMembers/{uid}` | unchanged | **new Case 3**: `memberUid == request.auth.uid && exists(joinLinks/$(request.resource.data.joinToken)) && get(that).data.role == request.resource.data.role && !disabled && (expiresAt == null \|\| expiresAt > request.time)` |
| Retire email invites (§3.1) | `pulses/{p}/invites`, `inviteIndex/**` | — | **delete these rule blocks** (`firestore.rules:92-99,125-141`) after the deprecation window; drop Case 2 (`:118-121`) |
| Team access cascade (§3.2) | `pulses/{p}` + subcollections | `isPulseMember(p) \|\| isWorkspaceMember(get(pulses/$(p)).data.workspaceId)` | writes OR-in `workspaceRole(...) in ['owner','editor']`; delete OR-in team `owner` |
| List a team's Pulses (§3.2) | `pulses` (top-level) | **new** `allow list: if isWorkspaceMember(resource.data.workspaceId)` (plain filtered query, not collection-group) | — |
| Team roles/members (§3.2) | `workspaces/{w}/workspaceMembers` | already `isWorkspaceMember` (`:84`) | already owner-gated (`:88`); widen role enum to owner/editor/viewer |
| Team join link (§3.2) | `workspaces/{w}/joinLinks/{token}` | `get`: `isSignedIn()` | create/delete: team owner; self-join creates `workspaceMembers/{uid}` token-validated (mirror of Case 3) |
| Move Pulse to a team (§3.2) | `pulses/{p}` | unchanged | `update` already `canEditPulse`; add guard that `request.resource.data.workspaceId` is a workspace the caller owns |
| Leave-Pulse (§3.3) | `pulses/{p}/pulseMembers/{uid}` | unchanged | **add** to delete (`:122`): `\|\| memberUid == request.auth.uid` |
| Transfer ownership (§3.3) | `pulses/{p}/pulseMembers/{uid}` | unchanged | already `isPulseOwner` update (`:122`) — **no rules change**, UI only |
| Presence (§3.4) | `pulses/{p}/presence/{uid}` | member/team-member | `create/update/delete: uid == request.auth.uid && (isPulseMember(p) \|\| isWorkspaceMember(...))` |
| Comments (§3.5) | `pulses/{p}/features/{f}/comments/{c}` | member/team-member | `create`: member && `authorUid == request.auth.uid` (**viewers allowed** — deliberately not `canEditPulse`); `update/delete`: author or `isPulseOwner(p)` |
| Notifications (§3.6) | `users/{uid}/notifications/{n}` | `uid == request.auth.uid` | self may write own; **cross-user writes server-only** (same shape as `myPulses`, `:69-71`) |
| Activity log (§3.7) | `pulses/{p}/activity/{a}` | member/team-member | server-only preferred; interim `create: canEditPulse(p)`, `update/delete: false` |

Three constraints to call out, because they shape the architecture:

1. **Token self-join is validated server-side by the rule, not just the client.**
   The joining member doc carries `joinToken`; the rule `get()`s the link and
   matches its `role` and validity — so a client can't forge a role or reuse a
   revoked/expired link. This is the token analogue of today's email-bound Case 2.
2. **Team access is a rule `get()` on the pulse doc.** The cascade learns
   `workspaceId` by reading the pulse doc inside the subcollection rules; the
   self-owned `myPulses` invariant (§1.6) is untouched because team Pulses are
   *listed via a filtered query*, never written into anyone's index.
3. **Cross-user delivery is still server-only by construction** (§1.6): user A
   can't write user B's `notifications`, so §3.6/§3.7 are the *only* things needing
   a backend — and invites are no longer among them (§3.9).

## 5. Data-model additions

New shapes, consistent with today's conventions (millis `Timestamp`, opaque ids,
`null`-not-`undefined` for clearable fields, `types/index.ts:151-158`):

```ts
// pulses/{pulseId}/joinLinks/{token}   — token IS the doc id (the secret)
interface JoinLink { role: PulseRole; createdBy: string; createdAt: Timestamp;
                     expiresAt?: Timestamp | null; disabled?: boolean;
                     linkResourceId?: string | null; } // optional auto-bind on join

// workspaces/{wsId}/joinLinks/{token}  — same shape, role is a team role
interface TeamJoinLink { role: WorkspaceRole; createdBy: string; createdAt: Timestamp;
                         expiresAt?: Timestamp | null; disabled?: boolean; }

// pulses/{pulseId}/pulseMembers/{uid}  — ADD one optional field for token self-join
//   joinToken?: string   // the link token used; the rule re-validates it (§4)

// Workspace / WorkspaceRole (existing) — CHANGES for Teams:
//   Workspace already has `name`; treat isPersonal:false as a Team.
//   WorkspaceRole: widen "owner" | "member"  ->  "owner" | "editor" | "viewer"

// pulses/{pulseId}/presence/{uid}
interface Presence { uid: string; email: string; focusId: string | null; lastSeen: Timestamp; }

// pulses/{pulseId}/features/{featureId}/comments/{commentId}
interface Comment { id: string; authorUid: string; authorEmail: string; body: string;
                    mentions: string[]; createdAt: Timestamp; editedAt?: Timestamp | null; }

// users/{uid}/notifications/{id}   (self-owned; cross-user writes server-only)
type NotificationType = "invite-link-used" | "mention" | "assignment"
                      | "status-change" | "comment" | "role-change" | "removed";
interface Notification { id: string; type: NotificationType; pulseId: string;
                         actorUid: string; entityId?: string; text: string;
                         createdAt: Timestamp; readAt?: Timestamp | null; }

// pulses/{pulseId}/activity/{id}   (append-only; server-written)
interface Activity { id: string; actorUid: string; actorEmail: string; verb: string;
                     entityKind: "feature"|"epic"|"resource"|"member"|"pulse";
                     entityId: string; summary: string; at: Timestamp; }
```

Reuse rather than duplicate:

- **Retire** `Invite` and `PendingInviteEntry` (`types/index.ts:90-127`) with the
  email mechanism (§3.1). `JoinLink` replaces them.
- **`Resource.linkedUid`** already has a working write path
  (`TeamTab.tsx:173-186`); §3.1/§5's optional `JoinLink.linkResourceId` and the
  join flow wire the **read/consume** side so joining by a link that carries a
  `linkResourceId` auto-binds the new member to that resource row (§1.9, D10).
- Presence `focusId` reuses the UI's existing `selectedId` (`PulsePage.tsx:138`).
- `MyPulseIndexEntry.workspaceId` (`types/index.ts:110`) already lets the dashboard
  group indexed Pulses by team.

Core `Feature`/`Epic`/`Resource`/`Pulse` shapes are unchanged for all of the above.

## 6. Phased plan

Ordered so the **serverless near-term slice** lands first, Teams next, and the
optional backend features last.

1. **Copy-link invites (§3.1) + Leave-Pulse + Transfer ownership (§3.3).** The
   near-term, entirely serverless slice. `joinLinks` + token self-join rule, the
   Share-panel UI reframe, the `memberUid == request.auth.uid` self-delete rule,
   and the "Make owner" transfer. Retire the email-invite UI; keep
   `resolvePendingInvites` for one deprecation window.
2. **Retire `invites`/`inviteIndex` (§3.1).** After the window: delete the rule
   blocks, `invites.ts`, `resolvePendingInvites`, and the `inviteIndex` docs/types.
3. **Teams (§3.2).** The workspace activation: widen `WorkspaceRole`, the cascade
   read/write rules, the team-Pulse `list` rule, team creation/naming, team join
   links, move-Pulse-to-team, the dashboard team switcher. Largest serverless
   piece; additive migration.
4. **Presence & concurrent-edit awareness (§3.4).** Heartbeat presence, header
   avatars, "editing now" chip. Riskiest for multi-user correctness; sequenced
   after the access model is settled.
5. **Comments / @mentions (§3.5).** DetailsTab thread + Kanban card badge;
   comment-only viewers (§3.8). Client+rules only.
6. **(Optional backend) Notifications (§3.6).** Only now does `functions/` become
   worthwhile — for cross-user mention/assignment notifications. In-app only.
7. **(Optional backend) Activity / audit log (§3.7).** Server-written, shares the
   function surface.

Non-goals this round: per-epic/per-field permissions (§3.8); OT/CRDT concurrent
editing and shared undo (§3.4, Undo-Spec.md §10); email delivery of anything
(§3.1/§3.6); real-time cursors beyond presence chips.

## 7. Open questions / decisions to confirm (D-list)

1. **D1 — Copy-link invites, link-only. ✅ DECIDED (fully link-only).**
   `pulses/{p}/joinLinks/{token}` (token-as-id), default viewer / optional editor,
   token-validated self-join, revoke = delete / regenerate = new token; **retire
   email invites & `inviteIndex`** after a one-release deprecation window. No
   email, no server. Email-address invites are *not* retained as a secondary path.
2. **D2 — Teams via the workspace layer.** *Recommend:* union-cascade
   (team membership grants all team Pulses; per-Pulse guests still allowed;
   effective role = max(team, per-Pulse)); team roles unified to
   owner/editor/viewer; personal workspace stays private/single-member; share by
   creating named Teams + moving Pulses in; team switcher on the dashboard; team
   Pulses listed via a filtered `pulses` query. *Confirm the union-cascade model
   and the "personal stays private" stance.*
3. **D3 — Ownership transfer & leave-Pulse (near-term).** *Recommend:* ship both in
   phase 1; add the `memberUid == request.auth.uid` self-delete rule; keep a
   last-owner guard; "leave team" as the workspace analogue. *Confirm.*
4. **D4 — Presence backend.** *Recommend:* Firestore heartbeat (`presence/{uid}` +
   `focusId`), last-writer-wins, no hard locks / OT / shared undo. *Confirm the
   stale-heartbeat departure model vs. investing in RTDB `onDisconnect`.*
5. **D5 — Comments.** *Recommend:* task-scoped subcollection, all members read, any
   member (incl. viewer) authors, author/owner edit-delete, `mentions[]` of member
   uids. *Confirm.*
6. **D6 — Notifications (deferred, optional backend).** *Recommend:* self-owned
   `users/{uid}/notifications` inbox, cross-user entries **written server-side
   only**; start mention + assignment; **in-app only** (no email in v1). *Confirm
   the type set and that email is out of scope.*
7. **D7 — Activity log (optional backend).** *Recommend:* per-Pulse append-only
   `activity`, written by a Cloud Function at the logical-action boundary, members
   read. *Confirm server-written vs. a client-append-only interim.*
8. **D8 — Permission granularity.** *Recommend:* comment-only viewers now; defer
   per-epic/field scoping. *Confirm.*
9. **D9 — Backend is now off the critical path.** With invites serverless (§3.1),
   `functions/` is needed *only* for cross-user notifications (D6) and a
   tamper-proof audit log (D7), both deferrable — so most of the roadmap is
   serverless and we may never add Cloud Functions. *Confirm we're happy keeping
   the near-term slice serverless and treating a backend as optional/later.*
10. **D10 — Resource↔account auto-link.** The **write** side already ships
    (`TeamTab.tsx:173-186` writes `linkedUid`); the **read** side is unused
    (§1.9). *Recommend:* let a `JoinLink` optionally carry `linkResourceId` to
    auto-bind a joining member to a resource row, and start keying behavior
    (assignment notifications, §3.6) off `linkedUid`. *Confirm this is desired.*
11. **D11 — Who may create a link, and per-Pulse override direction.**
    (a) Link creation: **✅ DECIDED — `canEditPulse` (owner + editor).** Both
    owners and editors can generate/copy/revoke join links.
    (b) **✅ DECIDED — accepted for v1.** In Teams, a per-Pulse grant can only
    *raise* capability above the team role, never lower it (no per-Pulse
    "exclude a team member" yet); a team member sees every team Pulse at least at
    their team role. Per-Pulse exclusions are a possible later addition.
12. **D12 — Email channel later.** Pulse sends no email at all now (§3.1). If
    notifications (D6) ever want email, that re-introduces a mail provider.
    *Recommend:* defer; in-app only for the foreseeable roadmap. *Confirm.*
