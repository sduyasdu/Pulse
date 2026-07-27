# Pulse — Bring Your Own Storage (BYOS) Spec

Status: **Proposal — decisions open (ST1–ST13)** · Owner: product + eng ·
Related: `Pulse-Product-Spec.md` (§3 attachments, §9 "attachments are base64 data URLs",
§10.5 "real file storage"), `Server-Functions-Spec.md` (**SF5–SF7**, added by this spec),
`Permissions-Spec.md` (read/write scopes), `Plans-Spec.md` (gating candidate),
`Changelog-Spec.md` (`attachment` entries)

## 0. What this is (and isn't)

Pulse stores no files. This spec adds **Bring Your Own Storage**: a Pulse is connected
to a **Google Drive** or **Microsoft OneDrive** account belonging to the customer, and
every file uploaded to that Pulse lands in a folder tree there that mirrors the Pulse's
own shape — workspace → Pulse → epic → task.

The customer's data stays in the customer's storage. Pulse holds a **pointer**, never
the bytes.

The hard problem this spec exists to answer is **§6: what happens to that folder tree
when the Pulse changes underneath it** — a task is renamed, moved to another epic, or
deleted; an epic is renamed; someone reorganizes the folders by hand in Drive.

Not in scope: Pulse-hosted storage (S3/GCS) as an alternative backend (**ST1**), file
preview/thumbnails, in-app editing, versioning beyond what the provider gives, and
Dropbox/Box/SharePoint-library variants (**ST2**).

## 1. Where attachments stand today (the real starting point)

Worth stating precisely, because it differs from the product spec's description:

- **There is no upload.** `Attachments.tsx` accepts a **title + pasted URL** only.
  There is no file input, no drag-and-drop, no `FileReader` anywhere in the attachment
  path. The prototype's base64-data-URL upload was never carried into the real app.
- `Attachment.isData` survives from the prototype and is set by `pulseStore.addAttachment`
  only when the pasted string happens to be a `data:` URI — a paste, not an upload.
- Attachments live **inline on the feature document**: `Feature.attachments: Attachment[]`.
  Subtasks have none (the product spec says otherwise; the type is the truth).

So BYOS does not "replace" an upload mechanism — **it introduces one**. What gets
updated is the link-only `Attachments` component and `addAttachment`/`removeAttachment`
in the store. Pasted links keep working exactly as they do now and are never touched by
the storage layer (§8).

## 2. The connection

```ts
/** pulses/{pulseId}/storage/connection — one per Pulse (§3). */
export interface StorageConnection {
  provider: "gdrive" | "onedrive";
  /** Who authorized it. Their account owns the files. */
  ownerUid: string;
  ownerEmail: string;
  /** Provider account label, for the settings UI ("santiago@nubceo.com"). */
  accountLabel: string;
  /** The folder everything hangs under — chosen or created at connect time. */
  rootFolderId: string;
  rootFolderName: string;
  rootWebUrl: string;
  status: "active" | "needs-reauth" | "revoked" | "error";
  statusDetail?: string | null;
  connectedAt: Timestamp;
  lastSyncAt?: Timestamp | null;
}
```

**Scopes — least privilege, and it matters:**

| Provider | Scope | Why |
|---|---|---|
| Google Drive | `drive.file` | Grants access **only to files this app creates**. Pulse cannot see the rest of the user's Drive, which is the difference between "connect Pulse" being a shrug and being a security review. |
| OneDrive / Graph | `Files.ReadWrite` (+ `offline_access`) | Graph has no true per-file equivalent; the app-folder scope (`Files.ReadWrite.AppFolder`) is narrower but hides the tree from the user in their own OneDrive, defeating the point. **ST3.** |

The asymmetry is real and should be surfaced in the connect dialog rather than papered
over: Google users grant less than OneDrive users do.

## 3. Who owns the connection (the first real decision)

A Pulse is shared; storage accounts are personal. Three options:

1. **Per-Pulse, one connection** *(recommended)* — an owner connects their account and
   every member's uploads land there. One tree, one bill, one place to look.
2. **Per-member** — each person's files go to their own Drive. Fragmented: a task's
   attachments scatter across accounts, and a departing member takes theirs with them.
3. **Per-workspace** — one connection shared by every Pulse in the workspace, with a
   subfolder per Pulse. Natural for teams; needs the workspace layer to be real first.

*Recommend option 1 now, with the tree laid out so option 3 is a re-parent later
(§5's root already nests a workspace level).*

**The consequence to accept and communicate:** files belong to the connecting account.
If that person leaves, revokes access, or deletes the folder, every attachment in the
Pulse breaks. Mitigations: warn on disconnect, name the storage owner in Pulse settings,
require the storage owner to be a Pulse **owner**, and support **transfer** (connect a
new account, re-point or copy the tree — **ST4**).

## 4. Credentials — never in the browser

OAuth **authorization-code flow with PKCE**, completed server-side. The refresh token is
the keys to someone's Drive; it must never reach the client, and must not be readable
through Firestore rules by anyone, including the Pulse owner.

- **`SF5 — Storage OAuth broker`** (new, registered in `Server-Functions-Spec.md`):
  handles the redirect, exchanges the code, and stores the refresh token in **Secret
  Manager** (or an encrypted field in a `storageSecrets/{pulseId}` doc that is
  `allow read, write: if false` — reachable only by the Admin SDK). Mints short-lived
  access tokens for the other functions. Never returns a token to the client.
- The client only ever sees the `StorageConnection` doc (§2) — provider, account label,
  status. No tokens, no scopes, no ids beyond the root folder.
- **Revocation and expiry are normal, not exceptional.** A refresh token dies when the
  user revokes it, changes password (some tenants), or after inactivity. On failure the
  connection flips to `needs-reauth`, uploads are blocked with a clear message, and
  existing attachments still resolve if the provider link is still valid.

## 5. The folder tree — mapped by id, never by path

```
{root chosen at connect}/
  └── {Workspace name}/                ← reserved level, so a workspace-wide
      └── {Pulse name}/                  connection (§3 option 3) is a re-parent
          ├── _Unfiled/                 ← tasks with no epic
          ├── {Epic name}/
          │   └── {Task title}/
          │       └── design-v2.pdf
          └── _Archive/                 ← deleted tasks/epics land here (§6)
              └── 2026-07/{Task title}/
```

**The load-bearing rule: Pulse never addresses a folder by its path.** Every entity that
owns a folder gets a mapping row keyed by the entity's own stable id:

```ts
/** pulses/{pulseId}/storageNodes/{entityId} — entityId is the pulse/epic/feature id. */
export interface StorageNode {
  entityId: string;
  kind: "workspace" | "pulse" | "epic" | "feature";
  parentEntityId: string | null;
  /** The provider's folder id. This — not the name, not the path — is identity. */
  remoteId: string;
  /** What we last named it remotely, so the reconciler knows a rename is pending. */
  remoteName: string;
  state: "ok" | "pending" | "missing" | "error";
  lastSyncAt: Timestamp;
  errorDetail?: string | null;
}
```

Everything difficult about §6 follows from this one choice. A rename becomes a cosmetic
remote operation that can fail, retry, or never happen without breaking a single link,
because nothing resolves files by name.

**Name sanitizing** (`safeName()`, pure, unit-tested):

- Strip `" * : < > ? / \ |`, control characters, and leading/trailing spaces and dots —
  the union of both providers' rules, so one function serves both.
- Truncate to 120 chars (well under the 255 limit, leaving room for suffixes).
- Empty after sanitizing → the entity's kind plus short id (`Task 7f3a`).
- **Collisions:** Drive happily allows two sibling folders with one name; OneDrive does
  not. Rather than branch per provider, always disambiguate deterministically: when a
  sibling name repeats, append the entity's short id — `Conciliaciones ~7f3a`. Ugly in
  the rare case, predictable in every case (**ST5**).

## 6. Keeping the tree in sync when the Pulse changes

### 6.1 Principle — reconcile, don't replay

The sync worker (**SF6**) does **not** consume a log of edits. It computes the **desired**
state for an entity from Firestore, compares it to the **actual** state in `StorageNode` +
the provider, and issues the minimum operation to close the gap. This matches the
repo's existing server-function convention — *"recompute from source and write the
result; never increment"* — and it's what makes the whole thing safe: replaying a diff
stream gets permanently wrong after one dropped or out-of-order event, whereas a
reconciler that runs twice, or late, or after a crash, converges anyway.

### 6.2 What each Pulse change means remotely

| Change in Pulse | Remote operation | If it fails |
|---|---|---|
| Task/epic **renamed** | rename folder (`remoteId` unchanged) | Nothing breaks — links resolve by id. Retried; the folder simply keeps its old name until then. |
| Task **moved to another epic** | move folder to the new parent | Retried. Meanwhile the file lives under the old epic; correct content, stale location. |
| Task **deleted** | move folder to `_Archive/{YYYY-MM}/` | Retried. **Never a hard delete** (§6.3). |
| Epic **deleted** | its tasks are re-parented in Pulse (existing behaviour) → each task folder moves; the empty epic folder moves to `_Archive` | Per-node retry. |
| Pulse **renamed** | rename the Pulse folder | Cosmetic. |
| Attachment **deleted** in Pulse | default: leave the file, drop the pointer (**ST6**) | — |
| Folder **renamed/moved by hand in Drive** | **nothing.** We key by id, so the user's organization wins. `remoteName` re-syncs on next touch. | — |
| Folder **deleted/trashed in Drive** | node → `missing`; re-created lazily on next upload; existing attachments show as broken with a "file removed in Drive" hint | — |

### 6.3 Deletion is never destructive

Pulse must not delete a customer's files from a customer's storage. A deleted task's
folder is **moved to `_Archive/{YYYY-MM}/`**, keeping the content recoverable and out of
the working tree. Emptying `_Archive` is a deliberate, separate action in Pulse settings —
or the user's own job in Drive. This also makes deletion **undo-friendly**: Pulse's undo
restores the task document, and the reconciler moves the folder back out of `_Archive`
because the desired state says it should exist again.

### 6.4 Queue, ordering, coalescing

- One **work queue per Pulse** (`pulses/{p}/storageJobs/{jobId}`), so operations on a
  single tree never race; different Pulses run in parallel.
- Jobs are keyed **by entity id**, not appended: a task renamed five times while offline
  collapses to one reconcile of the current name. (Titles are already debounced by
  `useDebouncedText`, but that only thins the writes; coalescing is what bounds the API
  calls.)
- **Nothing in the user's edit path waits on a remote call.** Renaming a task writes
  Firestore and returns; the tree catches up. Provider latency and outages must never be
  felt while dragging boxes on a canvas.
- Retries with exponential backoff; after N failures the node goes `error` and surfaces
  in a **Storage** settings panel with a **Re-sync** action that re-reconciles the whole
  tree from scratch. Because reconcile is idempotent, "turn it off and on again" is a
  legitimate, safe fix.
- Rate limits (Drive ~queries/100s/user; Graph throttles with `Retry-After`) are handled
  by honouring `Retry-After` and capping concurrency per connection.

### 6.5 Lazy creation

Folders are created **on first upload**, not when a task is created. A Pulse with 400
tasks and 3 attachments should have 3 task folders, not 400. The reconciler creates the
missing ancestors on demand, which also makes the tree self-healing after a manual
delete in Drive.

## 7. Upload and download

**Upload — the browser sends the bytes, the server never touches them.**

1. Client asks **SF7** for an upload target: `{pulseId, featureId, fileName, size, mime}`.
2. SF7 checks Pulse membership and edit scope, resolves/creates the task folder (§6.5),
   and asks the provider for a **single-file upload session** — Drive resumable session
   URL, or Graph `createUploadSession`. Both are short-lived and scoped to *one* file.
3. Client `PUT`s the bytes directly to that URL (chunked, resumable, with progress).
4. Client reports completion; SF7 verifies the file exists and writes the `Attachment`
   record.

This is deliberately **not** "hand the browser an access token": a session URL can only
create the one file it was issued for, whereas a leaked token is the whole Drive.
Proxying bytes through a function would also work but burns egress and function time for
no security gain.

**Download** — asymmetric between providers, and worth being honest about:

- **OneDrive/Graph** returns a short-lived pre-authenticated `@microsoft.graph.downloadUrl`
  per item. SF7 verifies membership, fetches it, redirects. Clean.
- **Google Drive** has no equivalent for `drive.file` content. Options: (a) SF7 streams
  the bytes (simple, costs egress), or (b) grant per-file reader permission and hand back
  a `webContentLink` (cheap, but creates lasting sharing state). *Recommend (a) — a
  proxied download, sized for documents, keeps the sharing surface at zero* (**ST7**).

Either way the membership check happens **server-side on every fetch**, so a link
pasted into Slack doesn't leak the file to a non-member.

## 8. The attachment record

Additive; existing rows keep working untouched.

```ts
export interface Attachment {
  id: string;
  title: string;
  url: string;               // link attachments: the pasted URL. Stored files: empty.
  isData?: boolean;          // legacy prototype paste (kept for back-compat)
  /** Absent = a pasted link, exactly as today. Present = a file in the connected
   * storage, fetched through SF7. */
  storage?: {
    provider: "gdrive" | "onedrive";
    fileId: string;
    /** "Open in Drive" — the provider's own UI, for the connected account. */
    webUrl: string;
    mimeType: string;
    size: number;
    uploadedBy: string;
    uploadedAt: Timestamp;
    state: "ok" | "missing";  // "missing" = deleted provider-side (§6.2)
  };
}
```

Three attachment kinds coexist forever: **pasted link** (no `storage`), **legacy data
URI** (`isData`), and **stored file** (`storage`). The UI distinguishes them by icon and
by what clicking does; nothing migrates automatically (**ST8**).

## 9. Failure modes, stated up front

| Situation | Behaviour |
|---|---|
| No connection configured | Upload control is hidden/disabled with "Connect storage to upload files"; pasting links still works. **BYOS is optional; Pulse without it is exactly today's Pulse.** |
| Connection `needs-reauth` | Uploads blocked with a re-connect prompt; existing files still downloadable if the token can still be refreshed, otherwise a clear error. |
| Provider outage / throttle | Uploads fail with a retry affordance; canvas editing is unaffected (nothing blocks on storage). |
| File deleted in Drive | Attachment renders as `missing` with an explanation, not a dead link. The Pulse record is kept — the pointer is evidence the file existed. |
| Storage owner leaves the Pulse | Warn at removal time; connection keeps working until revoked (files belong to their account). Transfer flow is **ST4**. |
| Quota exhausted | Provider's error surfaced verbatim — it's the customer's quota, and only they can fix it. |

## 10. Permissions, audit, plans

- **Uploading** follows the parent feature's edit gate (same rule costs use): editors
  anywhere, a Task Lead on tasks they lead. **Downloading** follows the feature's read
  scope, enforced in SF7 — a My-Beat viewer can't fetch a file on a task outside their
  beat.
- **Connecting/disconnecting** storage is `editConfig` **and** Pulse-owner (it spends
  someone's personal storage and creates a lasting dependency).
- **Activity log:** add an `attachment` entity kind with `upload` / `remove` verbs,
  `scopeUids` mirroring the parent feature; plus `pulse`-level `storage-connected` /
  `storage-disconnected`. Who put a customer document into a shared Drive is exactly the
  kind of thing an audit trail is for.
- **Plans:** BYOS is a plausible paid feature and a plausible quota (files or bytes per
  Pulse). Listed in `Plans-Spec.md` §3.1 as a candidate; the call is PL2's.

## 11. Migration and rollout

1. **Nothing to migrate, mostly.** There are no stored files today; legacy `data:` URI
   pastes (if any exist in real Pulses) can be swept into the connected drive by a
   one-shot job — worth doing precisely because data URIs bloat feature documents against
   the 1 MiB ceiling (**ST9**).
2. Ship **read-only-ish first**: connect + upload + download, with the reconciler doing
   creation only. Then enable rename/move/archive reconciliation. The tree being slightly
   stale is harmless (§5); the upload path is what users need.
3. Feature-flag per Pulse so early adopters can be onboarded by hand.

## 12. Implementation notes

- **`src/domain/storagePaths.ts`** — pure: `safeName()`, collision suffixing, desired
  ancestor chain for an entity. Unit-tested like `costs.ts` (both providers' character
  rules in one place).
- **`src/services/firestore/storage.ts`** — connection + node reads, job enqueue.
  The client never calls a provider API directly.
- **Functions** (`SF5`/`SF6`/`SF7`) are the first Cloud Functions in the project;
  `Server-Functions-Spec.md` §1 conventions apply (2nd gen, TypeScript, idempotent).
  This also means BYOS is the change that ends "Pulse ships fully serverless" — budget
  for the deployment/CI work that comes with the first function, not just the feature.
- **`Attachments.tsx`** grows a file input + drop zone with progress, shown only when a
  connection is active. Its current paste-a-link path is untouched.
- **i18n:** all six dictionaries; `Dict` is exact, so a missing key is a compile error.
- **Rules:** `storage/connection` readable by members, writable only by functions;
  `storageSecrets/*` denied to everyone; `storageNodes/*` and `storageJobs/*` readable by
  members (useful for a status UI), writable only by functions.

## 13. Open decisions (ST1–ST13)

1. **ST1 — Pulse-hosted storage too?** Offer GCS/S3 as a default backend for customers
   who don't want to connect a drive? *Recommend: not now — BYOS is the differentiator;
   revisit if onboarding friction shows up.*
2. **ST2 — Provider set.** Drive + OneDrive first. Dropbox/Box/SharePoint document
   libraries later? *Recommend: ship two, design the provider interface for a third.*
3. **ST3 — OneDrive scope.** `Files.ReadWrite` (visible tree, broad grant) vs.
   `Files.ReadWrite.AppFolder` (narrow grant, hidden tree). *Recommend the visible tree —
   "your files, in your Drive, where you can see them" is the product promise — and say
   so plainly in the consent screen.*
4. **ST4 — Transfer of the connection.** Re-point to a new account: copy files, move
   them, or just re-link and leave history behind? *Recommend re-link + optional copy;
   copying gigabytes must be explicit.*
5. **ST5 — Collision suffixes.** Always disambiguate deterministically, or only when the
   provider rejects a duplicate? *Recommend always — one behaviour on both providers.*
6. **ST6 — Deleting an attachment in Pulse.** Drop the pointer only (default), move the
   file to `_Archive`, or offer the choice per deletion? *Recommend pointer-only, with
   "also remove from Drive" as an explicit checkbox.*
7. **ST7 — Drive downloads.** Proxy the bytes vs. grant per-file reader links.
   *Recommend proxying (§7).*
8. **ST8 — Legacy/pasted attachments.** Leave all three kinds coexisting forever?
   *Recommend yes; a pasted link is a legitimate thing to want.*
9. **ST9 — Sweep existing data-URI attachments** into the connected drive? *Recommend
   yes, one-shot, opt-in per Pulse — it also shrinks feature docs.*
10. **ST10 — Workspace-level connections** (§3 option 3): when, and does it supersede
    per-Pulse or coexist? *Recommend coexist, Pulse-level overriding workspace-level.*
11. **ST11 — Subtask attachments.** The product spec says subtasks have attachments; the
    type says they don't. Fix the spec, or add them (and give them folders)? *Recommend
    fixing the spec — task-level folders are the right granularity.*
12. **ST12 — Storage status surface.** A dedicated Storage settings panel, or fold it
    into the existing Pulse settings? *Recommend a panel: connection state, tree link,
    failing nodes, re-sync, disconnect.*
13. **ST13 — Plan gating.** Is BYOS a paid feature, and is there a file/byte quota?
    Product's call, tracked as a candidate in `Plans-Spec.md` §3.1.

> **Cross-refs added with this spec:** `Server-Functions-Spec.md` gains **SF5** (OAuth
> broker), **SF6** (folder-tree reconciler) and **SF7** (upload/download broker);
> `Plans-Spec.md` §3.1 lists BYOS as a gating candidate; `Pulse-Product-Spec.md` §9's
> "attachments are base64 data URLs" gap and §10.5's "real file storage" item are
> answered here.
