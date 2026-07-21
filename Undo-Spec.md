# Pulse — Undo / Redo Specification

Status: **Decisions locked (D1–D4)** · Scope: v1 (single-user, per-Pulse, in-memory)

## 1. Goal

Let an editor reverse their recent changes to a Pulse with a familiar
`Cmd/Ctrl+Z` (and redo with `Shift+Cmd/Ctrl+Z`), covering the everyday canvas
edits: adding/moving/resizing/deleting tasks and epics, assigning people,
editing subtasks and attachments, and epic membership changes.

Undo must behave sanely in Pulse's **real-time, multi-user** model: it reverses
*the acting user's* logical action against the *current* state — it is not a
time-machine that rolls the whole document back to an earlier global snapshot.

## 2. Constraints from the current architecture

These are load-bearing facts (see `src/stores/pulseStore.ts`,
`src/services/firestore/*`), and they dictate the design:

1. **Firestore is the source of truth.** Every mutation is a
   `createFeature` / `updateFeature` / `deleteFeature` (and epic/resource/pulse
   equivalents). Local `features`/`epics`/`resources` arrays are *derived* from
   `onSnapshot` listeners; the store never sets them directly.
2. **No optimistic layer.** A change is only visible after its snapshot echoes
   back. Undo therefore is not "revert local state" — it is "issue the inverse
   write," which then echoes back the same way.
3. **Concurrent editors.** Between an action and its undo, a teammate may have
   changed or deleted the same doc. Undo must degrade gracefully, never
   clobber unrelated concurrent edits, and never resurrect data the user
   couldn't otherwise write (rules still apply — undo uses the same
   `canEditPulse` write paths).
4. **Compound mutations exist.** `removeEpic` = delete epic + patch every child
   feature's `epicId`; `removeResource` = delete resource + patch every feature
   that referenced it. These must undo **atomically** (all-or-nothing, one
   history entry).
5. **Embedded sub-documents.** Subtasks and attachments live *inside* a
   feature's `children` / `attachments` arrays, so their edits are already
   `updateFeature` patches — undoing them is just restoring the prior array.
6. **Throttled drag writes.** Canvas drags (`startDrag` in `CanvasView.tsx`)
   fire many `patchFeature` calls per gesture but already capture the feature's
   pre-drag state in `dragRef.current.orig`. A gesture must be **one** undo
   entry, not dozens.

## 3. Design: inverse-command stack

Undo is modeled as a stack of **commands**, each carrying enough state to
re-issue itself forward (redo) or issue its inverse (undo). Each op records a
**field-level diff** — only the keys the action actually touched, with their
prior and new values — so an undo restores *just those fields* and leaves a
concurrent editor's changes to other fields intact (see §6). Create and delete
are modeled as lifecycle ops that carry the whole document.

```ts
type DocKind = "feature" | "epic" | "resource" | "pulse";

type DocOp =
  | { kind: DocKind; id: string; op: "create"; doc: Record<string, unknown> }
  | { kind: DocKind; id: string; op: "delete"; doc: Record<string, unknown> }
  | {
      kind: DocKind;
      id: string;
      op: "patch";
      keys: string[];                        // the fields this action owns
      before: Record<string, unknown>;       // values of `keys` before
      after: Record<string, unknown>;        // values of `keys` after
    };

interface UndoCommand {
  label: string;          // e.g. "Move task", "Delete epic" (for the toast/menu)
  pulseId: string;        // guard: drop on Pulse change
  ops: DocOp[];           // all docs touched by this one logical action
  ts: number;
}
```

- **Undo(command):** for each op — `create` → delete the doc; `delete` →
  recreate the whole `doc`; `patch` → write `before` for `keys` only.
- **Redo(command):** the mirror — `create` → recreate; `delete` → delete;
  `patch` → write `after` for `keys` only.

Undoing a delete recreates the doc **with its original id** (ids are
client-generated — `newFeatureId` etc. — so this is safe), and undoing a create
deletes it. For embedded arrays (`children`, `attachments`, `resources`,
`alloc`), the "field" is the whole array/map — subtask/attachment/assignment
edits restore that one key, which is already the granularity the store writes.

### Where snapshots are captured

A thin wrapper around the store mutations records the before/after. Two options
(recommendation: **B**):

- **A — Service interception:** wrap each `services/firestore/*` writer. Rejected:
  writers don't have the before-image; the store does.
- **B — Store-level recording (recommended):** the store already reads current
  state before writing (e.g. `assignResource` looks up `feature`). Introduce a
  helper `record(label, ops)` that each mutation calls with the docs it is about
  to change, capturing `before` from current store arrays and `after` from the
  payload it is writing. Keeps the Firestore layer dumb and undo logic in one
  place.

## 4. Mutation → inverse map

| Store action | Undo entry | Notes |
|---|---|---|
| `addFeature` / `addEpic` / `addResource` | delete the created doc | before = null |
| `removeFeature` | recreate feature (full doc) | capture whole `Feature` first |
| `removeEpic` | recreate epic **+** restore each child's `epicId` | one entry, N+1 ops |
| `removeResource` | recreate resource **+** restore each feature's `resources`/`alloc`/`lead`/`children` | one entry, potentially many ops |
| `patchFeature` / `patchEpic` / `patchResource` | restore prior field values of that doc | whole-doc before-image |
| `moveFeatureToEpic` | restore prior `epicId` + `y` | single feature op |
| `assign` / `unassign` / `setAlloc` | restore `resources` + `alloc` (+ `lead`) | single feature op |
| `add/patch/removeSubtask`, `toggleSubtaskResource` | restore prior `children` | embedded array |
| `add/removeAttachment` | restore prior `attachments` (or child's) | embedded array |
| `renamePulse` / `setGraphConfig` / `setResourceTypes` | restore prior pulse field | pulse-doc op |

## 5. Gesture coalescing

Canvas drags (move / resize-left / resize-right / resize-effort) and the epic
resize handles must record **one** entry per gesture:

- On `pointerdown`, snapshot the target's before-image (already available as
  `dragRef.current.orig` / `epicResizeRef.current.band`).
- Suppress per-frame recording during the drag.
- On `pointerup`, push a single command: `before` = the pointerdown snapshot,
  `after` = the final committed state.

Debounced text edits (`useDebouncedText` for titles/pulse name) similarly record
once per "settled" edit, not per keystroke — record on the debounced commit
using the value at focus-in as `before`.

## 6. Concurrency & conflict handling

v1 uses **field-level restore** (decision D1): an undo/redo `patch` only ever
writes the `keys` its command owns, never the whole document. This is what keeps
a teammate's concurrent edit to *other* fields alive.

When applying an op, per doc:

- **Target unchanged since:** apply normally.
- **Target changed by someone else, different fields:** unaffected — we only
  touch our `keys`, so their edit survives. This is the whole point of D1.
- **Same field co-edited:** the undo wins for that field (documented
  last-writer semantics). We do *not* block or three-way-merge in v1.
- **Target deleted by someone else** (a `patch` whose doc is now gone): skip that
  op, keep the rest of the command, surface a non-blocking toast ("Couldn't undo
  — an item was removed"). A `delete`-undo (recreate) still succeeds and brings
  it back.
- **Permission lost** (role downgraded to viewer): undo/redo disabled; the write
  would be denied by rules anyway.
- **Pulse changed / reloaded:** history is dropped (see §8).

Implementation note: applying a `patch` op reads the current doc from the store,
overlays only `keys`, and issues the existing `updateX` writer — so field-level
restore reuses the normal write path and the normal `canEditPulse` rules.

## 7. Redo

A standard second stack. Any *new* recorded action clears the redo stack.
Undo pops from undo→applies inverse→pushes to redo; redo is the mirror.

## 8. History lifecycle & scope

- **In-memory only**, not persisted to Firestore and **not shared** between
  users — it is the local editing history of this browser session.
- **Per-Pulse.** Scoped by `pulseId`; navigating to another Pulse or back to the
  dashboard **clears** both stacks (guard: commands carry `pulseId`).
- **Bounded** to the last N actions (proposal: 50) to cap memory.
- Cleared on full reload (acceptable for v1; persistence is a non-goal).

## 9. UI / UX

- Keyboard: `Cmd/Ctrl+Z` = undo, `Shift+Cmd/Ctrl+Z` (and `Ctrl+Y`) = redo.
  Handlers ignore events while a text input/textarea is focused (browsers own
  the caret there), except our own debounced canvas fields.
- Toolbar: `↶` / `↷` buttons next to the existing `⟲` reset control, disabled
  when the respective stack is empty, tooltip showing the next action's label
  ("Undo Move task").
- Feedback: a small transient toast on undo/redo ("Undid: Delete epic"),
  reusing the existing floating-hint styling (`dimHint`).
- Only shown to editors (`canEdit`); hidden for viewers.

## 10. Non-goals (v1)

- Cross-user / server-side collaborative undo (OT/CRDT). Out of scope.
- Persisting history across reloads or devices.
- Undoing membership/invite/workspace changes (people & access), Pulse
  create/delete, and resource-type reordering side effects — these live outside
  the canvas edit loop; revisit later.
- A visible history panel / named checkpoints.

## 11. Proposed implementation phases

1. **`undoStore` + `record()` helper**, wired into all `patch*`/`add*`/`remove*`
   store actions, capturing each mutation's touched **keys** with before/after
   (D1). Keyboard + toolbar + redo wired. Covers the 80% (single-doc edits,
   assigns, subtasks, attachments).
2. **Compound atomicity** for `removeEpic` / `removeResource` via grouped ops
   (and consider a Firestore `writeBatch` on undo so the N+1 writes land together).
3. **Gesture coalescing** for drags and debounced text.
4. **Conflict policy** (§6) hardening + toasts.

## 12. Testing

- Unit (Vitest, no Firestore): the inverse-map builder — given a before/after
  pair, produces the correct inverse ops. Table-driven over §4.
- Rules-emulator integration: undo of a delete recreates with the same id and
  passes `canEditPulse`; undo after role downgrade is denied.
- Coalescing: a simulated drag (many patches) yields exactly one command.
- Concurrency: apply an undo whose target was deleted/edited by a second client
  → correct skip / field-preserving behavior.

## 13. Resolved decisions

1. **D1 — Field-level restore in v1.** An undo/redo `patch` writes only the
   fields its command owned, preserving a concurrent editor's changes to other
   fields. Same-field co-edits are last-writer-wins. (§3, §6.) Consequence:
   `record()` must capture the exact key set of every mutation.
2. **D2 — History: 50 actions, in-memory, per-Pulse, cleared on reload.** No
   cross-reload or cross-device persistence in v1. (§8.)
3. **D3 — "Move task to another epic" is one undo entry**, reversing both the
   `epicId` and the `y` reposition together. (§4, `moveFeatureToEpic`.)
4. **D4 — Redo ships in v1**, as the mirror stack described in §7.
