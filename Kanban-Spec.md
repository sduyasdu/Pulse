# Pulse — Kanban Board View Specification

Status: **Draft for sign-off (D1–D14)** · Scope: v1 (one alternative view inside a single Pulse; desktop + mobile). Custom statuses (D14) designed but phased.

## 1. Goal

Give an editor/viewer a **status-first, board-style** way to look at one Pulse's
tasks, as an alternative to the time-based canvas. The canvas
(`src/components/canvas/CanvasView.tsx`) answers *"when does everything
happen and who's over/under-loaded on the timeline?"*; the assignment panel
(`src/components/assignmentPanel/AssignmentPanel.tsx`) answers *"who is doing
what, day by day?"*. Neither gives a fast *"what's in each state, and let me
move things between states"* workflow. The Kanban view fills exactly that gap:

- One column per `FeatureStatus`, cards grouped by state at a glance.
- Drag a card to a new column to change its status — one gesture, no dialog.
- Reuse the same tasks, the same store mutations, the same DetailsTab editor,
  the same filters. It is a **view**, not a new data model.

Non-goal for v1: replacing the canvas. The two views coexist and share
selection, filters, and the sidebar.

## 2. Constraints inherited from the architecture

These are load-bearing facts (same source-of-truth model as `Undo-Spec.md` §2)
and they shape every decision below:

1. **Firestore is the source of truth.** A card move is a `patchFeature(id,
   { status })` (→ `updateFeature`) that echoes back through
   `subscribeFeatures`; there is no optimistic local mutation. The board
   re-renders when the snapshot lands, exactly like the canvas.
2. **All persistence already exists.** `usePulseStore`
   (`src/stores/pulseStore.ts`) exposes `patchFeature`, `addFeature`,
   `duplicateFeature`, `removeFeature`, `moveFeatureToEpic`, etc. The Kanban
   **must reuse these** and invent no new writers.
3. **`FeatureStatus` is a fixed 4-value union** (`src/types/index.ts:120`):
   `"planned" | "in-progress" | "blocked" | "done"`. `STATUS_META`
   (`src/domain/constants.ts:24`) gives each a label, border, bg, and text
   color — these are the natural, self-labeling columns.
4. **"Done" is a lock, not just a color.** `DetailsTab`
   (`src/components/leftPanel/DetailsTab.tsx:35`) computes
   `locked = feature.status === "done"` and every content field becomes
   read-only; only the status control itself stays live (so it can be
   reopened). The canvas honors the same lock — `box.status === "done"`
   disables move/resize (`CanvasView.tsx:465, 498, 928`).
5. **A Feature has no explicit ordering field.** Its position is
   `x` (start day) and `y` (vertical px) — both meaningful only on the
   *canvas* (`Feature`, `src/types/index.ts:154`). There is no `order`/`rank`
   for "position within a status column." This is the single biggest data-model
   question for the board (see §7, D5).
6. **Permissions come from role.** `canEdit = myRole === "owner" || "editor"`
   (`PulsePage.tsx:90`); `firestore.rules` gates every `features` write behind
   `canEditPulse(pulseId)`. Viewers can select/inspect but not write.
7. **Undo already wraps the mutations.** `patchFeature` records a field-level
   `patchOp` via `recordSingle("Edit task", …)` (`pulseStore.ts:206`), so a
   status change is *already* undoable with no new work (see §9).

## 3. Columns

**D1 (recommended): default grouping is by `FeatureStatus`,** one column each in
`STATUS_META` order: **Planned → In progress → Blocked → Done.** Column header
reuses `STATUS_META[status].label` and its `bg`/`border`/`text` colors so the
board reads identically to the canvas boxes and the mobile list pills
(`MobileTaskList.tsx:100`). Each header shows a count of cards in the column.
(The v1 board assumes today's fixed four statuses; §12 / D14 generalizes these
columns to per-Pulse custom statuses in a later phase, at which point the
columns render from `pulse.statuses` instead of the constant.)

Within each column, cards are further **grouped by epic and sorted by start
date** — see §5.2 / D5.

Alternative selectable groupings (a small segmented control in the toolbar,
"Group by: Status · Epic · Assignee"):

- **By Epic** — columns are the Pulse's epics plus a "No epic" column, mirroring
  the epic grouping `MobileTaskList` already builds (`MobileTaskList.tsx:38-42`)
  and the `epicFilter` semantics. Dragging a card between epic columns calls the
  existing `moveFeatureToEpic(id, epicId)` (`pulseStore.ts:233`) — note this also
  repositions `y`, and is already one undo entry ("Move task to epic", D3 of
  Undo-Spec).
- **By Assignee / Resource** — one column per `Resource`, plus "Unassigned."
  Cards can appear in multiple columns (a task with two assignees). Dragging
  here is ambiguous (assign vs. reassign vs. move) so v1 makes assignee-grouping
  **read-only for drag** (reorder/move disabled; click still opens DetailsTab).

**Recommendation:** ship **Status grouping** first (full drag support), add
**Epic grouping** in phase 2 (drag = `moveFeatureToEpic`), and treat
**Assignee grouping** as a read-only lens in phase 3.

**D2:** When grouping by status, the **Done** column is visually de-emphasized
(muted, collapsible) and cards in it show the 🔒 lock, matching canvas/mobile,
since done tasks are locked for content edits.

## 4. Card content

A Kanban card mirrors the canvas box header (`CanvasView.tsx:867-908`) and the
mobile list row (`MobileTaskList.tsx:85-114`) so nothing feels new. Top to
bottom:

- **Status dot + title.** Colored dot from `STATUS_META[status].border` (or the
  canvas's `staffingColor` if we want the staffing signal), title truncated;
  `line-through` when `status === "done"` (matches `MobileTaskList.tsx:96`).
- **Label-color stripe/swatch** — `feature.labelColor` shown as the left stripe
  the canvas already draws (`CanvasView.tsx:866, 875`), for grouping related
  tasks visually.
- **Epic chip** — the epic's `color` dot + name (only shown when *not* grouping
  by epic, to avoid redundancy). Same chip as `MobileTaskList.tsx:80-81`.
- **Assignee badges** — initials avatars via `colorForName(resource.id)`, lead
  rendered as a square amber-bordered badge exactly like the canvas
  (`CanvasView.tsx:892-904`); overflow "+N" past ~4 (mobile pattern,
  `MobileTaskList.tsx:109`).
- **Date range** — `fmt(f.x) → fmt(f.x + f.duration)` (`MobileTaskList.tsx:101`).
- **Subtask progress** — `done/total` derived from `children`
  (`count(children where status === "done") / children.length`). **New render,
  not currently shown on canvas or mobile** — recommended (D4).
- **Coverage %** — `Math.round(assignedEffort / max(0.1, estimateEffort) * 100)`
  from `src/domain/graphEffort` (the canvas computes this as `coverage`,
  `CanvasView.tsx:805-807, 906`), with the same over/under color semantics.
- **Icon row** — 📌 when `plannedX != null` (baseline set), 📎N when
  `attachments.length`, ✨ when `ai`, 🔒 when `done` — identical to
  `CanvasView.tsx:878-881`.

**D4 (recommended):** add the `done/total` subtask progress count to the card
(and optionally back-port it to the canvas box and mobile row for consistency),
since a board is where subtask burn-down is most useful.

Cards do **not** show `work`/effort height (that's a canvas-only visual encoding
via the Graph Effort scale); the numeric coverage % carries the load signal
instead.

## 5. Interactions

### 5.1 Move between columns (the core gesture)

Dragging a card from column A to column B changes its status — a single write,
a single undo entry (§9). This must go through the shared status-change path
that also maintains the finished date (see D6 below), i.e. a
`setFeatureStatus(id, status)` store action rather than a bare
`patchFeature({ status })`. Consequences to honor:

- **Into "done":** the card becomes locked for content edits everywhere
  (DetailsTab, canvas). No confirmation needed; it's reversible via drag-back or
  ⌘Z. The board should *allow* the drag for editors regardless of the source
  lock, because status is the one field that stays editable on a done task
  (`DetailsTab.tsx:465` keeps the status `<select>` on `canEditProp`, not
  `canEdit`).
- **Out of "done":** unlocks the card and clears `finishedAt` (via the same
  `setFeatureStatus` path).
- **Finished-date behavior (settled — D6):** a Feature now carries its own
  `finishedAt?: string | null` (YYYY-MM-DD, `src/types/index.ts:151`), mirroring
  the subtask field. `DetailsTab` has a `setFeatureStatus` helper
  (`DetailsTab.tsx:81-88`) that stamps `todayISO()` when the task **first**
  becomes `done` and clears it when reopened — the exact mirror of
  `setSubtaskStatus` (`DetailsTab.tsx:93-100`), and an editable "finished:" date
  input is shown while `status === "done"` (`DetailsTab.tsx:486-499`). **The board
  must move a card to Done through this same finished-date logic, not a bare
  `patchFeature({ status: "done" })`** — otherwise the end date wouldn't be
  stamped. Concretely: promote `setFeatureStatus` into a store action (e.g.
  `setFeatureStatus(id, status)` on `usePulseStore`) so both DetailsTab and the
  board call one code path that maintains `finishedAt`, records a single undo
  entry, and applies the lock. Moving a card **out** of Done clears `finishedAt`
  and unlocks. Subtasks are **not** cascaded (each subtask keeps its own
  `finishedAt`, edited from DetailsTab).

### 5.2 In-column layout: grouped by epic, sorted by start date

**D5 — Within each column, cards are grouped by epic** (an epic sub-header/band
inside the column, its tasks listed beneath it), and **within an epic group,
ordered by start date (`Feature.x` ascending).** Tasks with no epic (or an
`epicId` that no longer resolves) form their own "No epic" group at the bottom
of the column. This reuses the exact grouping `MobileTaskList` already builds
(`MobileTaskList.tsx:38-42`: an epic band with a color dot + name + count, loose
tasks appended as a "No epic" group) — so a status column reads like a mini
version of the mobile list.

This design **removes the need for any manual reorder or an `order` field
entirely**: order is fully derived (epic grouping → start-date sort), so there
is nothing to persist. Free-form drag-to-reorder within a column is therefore
**not offered** — dragging a card is always a *column change* (status), never a
within-column re-rank. A drop back into the same column is a no-op.

Because columns are subdivided by epic, the board doubles as a status × epic
matrix, and adding an epic (D13) surfaces a new empty band in every column.

### 5.3 Open, add, duplicate, delete

- **Click / tap a card → open DetailsTab.** Reuse `handleSelect(id)`
  (`PulsePage.tsx:188`) which sets `selectedId` and switches the sidebar to the
  Details tab — the board shares selection with the canvas.
- **Add card per column / per epic-group.** A "+" in each column header calls
  `addFeature({ x, y, status: <column status> })` (`pulseStore.ts:182`)
  pre-seeded with that column's status, then `handleSelect(newId)` to open it.
  A "+" on an epic band inside the column additionally seeds `epicId: <that
  epic>` so the new card lands in the right group. (`x`/`y` get sensible
  defaults, e.g. `todayIndex()` like the mobile add, `MobilePulseView.tsx:41`.)
- **Add epic from the board** — see §5.5 / D13.
- **Duplicate / delete** — per-card overflow menu reusing `duplicateFeature`
  and `removeFeature` (with the existing `confirmAt` guard used in
  `DetailsTab.tsx:106`, whose copy already says "You can undo this (⌘Z)").

### 5.4 Keyboard / touch parity

Match the canvas's established model (`CanvasView.tsx:472-523`):

- **Mouse:** press-and-drag moves a card; click selects/opens.
- **Coarse pointer (touch):** quick **tap** opens the card (DetailsTab);
  **long-press (500 ms)** could show a lightweight context menu (duplicate /
  delete / move-to); **drag past ~8px** picks the card up to move columns.
  Apply the `.no-select` class (`index.css:113`) to card and column surfaces to
  suppress the iOS long-press callout, exactly as the canvas does.
- Respect `touch-action: none` on draggable cards (canvas pattern) so the board
  scroll and the card drag don't fight.

### 5.5 Add epic from the board

**D13 — Board mode needs an "add epic" affordance**, since with epic-grouped
columns (D5) an epic is how you organize the board, not just the canvas. Reuse
the store's existing `addEpic(y0)` (`pulseStore.ts:147`) — the same action the
canvas toolbar's "Add epic" button drives (`Toolbar.tsx:177`,
`PulsePage.tsx:233`). Because the board doesn't have a canvas `y` to seed from,
pass a nominal `y0` (e.g. `0`); `addEpic` only needs it for canvas placement and
the board ignores it. The new epic immediately appears as an **empty band in
every status column**, ready to receive tasks (drag a card in, or use the band's
"+"). `addEpic` already records an "Add epic" undo entry, so this is undoable for
free. Surface it either in the toolbar (the existing "Add epic" button is
already shared) or as a footer "+ Add epic" affordance on the board.

## 6. Filtering & search

Reuse the toolbar controls verbatim — they already live in `Toolbar.tsx` and
flow as props/state from `PulsePage`:

- **Feature search** (`featureQuery`) — same predicate the canvas/mobile use:
  match title **and** subtask titles (`CanvasView.tsx:801`,
  `MobileTaskList.tsx:26-35`). Non-matching cards are hidden (board) rather than
  dimmed (canvas), since a board has no spatial context to preserve.
- **Status multi-select** (`featureStatusFilter`, via `MultiSelectFilter`) —
  when grouping **by status**, selecting statuses simply **hides the
  non-selected columns** (empty set = all columns), which is the intuitive
  reading. When grouping by epic/assignee, it filters cards as usual.
- **Epic multi-select** (`epicFilter`, `MultiSelectFilter`) — filters cards to
  the chosen epics; when grouping by epic, hides non-selected columns.
- **Resource filter** (`filterResource`) — filters cards to that assignee, same
  as the canvas.

No new filter UI: the same `MultiSelectFilter`
(`src/components/shared/MultiSelectFilter.tsx`) instances carry over.

**D7:** In status grouping, a status filter hides columns rather than filtering
within them (there's nothing to filter within a status column *by* status).

## 7. Data-model impact

**For the v1 board (fixed statuses): none.** The board renders entirely from
existing `Feature` fields, and every mutation is an existing (or trivially
wrapped) store action. Specifically:

- Columns = `status` (exists).
- In-column layout = epic grouping + `x` sort — both derived, **no new field**
  (D5). There is deliberately no `order`/`rank` field.
- Card content = `title`, `epicId`, `resources`/`lead`/`alloc`, `x`/`duration`,
  `finishedAt`, `children`, `attachments`, `plannedX`, `ai`, `labelColor` (all
  exist; `finishedAt` was just added, `types/index.ts:151`).
- Moves = `setFeatureStatus` (thin wrapper over `patchFeature`, D6) /
  `moveFeatureToEpic` (exists); add-epic = `addEpic` (exists).

**The one change that *does* touch the data model is custom statuses (§12) —
and it is the largest work item in this spec.** It converts `FeatureStatus`
from a hardcoded union + static `STATUS_META` into per-Pulse configurable data.
It is intentionally **out of scope for the v1 board** and phased later (D14).

## 8. Permissions

Reuse `canEdit` and the done-lock unchanged (no rules change — `features`
writes are already `canEditPulse`-gated, `firestore.rules:148-151`):

- **Viewer:** cards are read-only. No drag handles, no "+", no overflow actions.
  Tap/click still opens DetailsTab in its read-only form (DetailsTab already
  renders read-only for viewers). Mirrors `canEdit &&`-guarded controls in the
  canvas and mobile.
- **Editor / Owner:** full drag, add, duplicate, delete.
- **Done lock:** a done card can be dragged to another column (status stays
  editable) but its content stays locked in DetailsTab; the board shows 🔒 and,
  optionally, disables the overflow "edit" affordances that would deep-link into
  locked fields.

## 9. Undo / redo

Status moves ride on the existing undo engine with essentially no new work.
`patchFeature` already records a **field-level** `patchOp` via
`recordSingle("Edit task", …)` (`pulseStore.ts:206`) that restores only the keys
it touched — here `{ status }` (and `{ finishedAt }` when crossing the Done
boundary, D6) — preserving concurrent edits to other fields (D1 of Undo-Spec).
Redo is the mirror. Notes:

- A column drag is a **single** write (the `setFeatureStatus` wrapper issues one
  `patchFeature` with `status` ± `finishedAt`), so — unlike canvas x/y drags,
  which need gesture coalescing (Undo-Spec §5) — it is already exactly one undo
  entry. No coalescing needed. The `finishedAt` and `status` changes ride in the
  same patch op, so undo restores them together.
- Epic-grouping drags go through `moveFeatureToEpic`, already a single "Move
  task to epic" entry that reverses `epicId` **and** `y` together (Undo-Spec D3).
- Add/duplicate/delete from the board reuse `addFeature`/`duplicateFeature`/
  `removeFeature`, each of which already records ("Add task" / "Duplicate task" /
  "Delete task"). The toolbar's existing ↶/↷ buttons and ⌘Z/⇧⌘Z handlers
  (`PulsePage.tsx:94-111`, `Toolbar.tsx:203`) work over the board with zero
  changes.

**D8:** the `setFeatureStatus` store action (D6) is the natural home for a
status-specific undo label — record it as **"Move task"** instead of the generic
"Edit task", so the toast/tooltip reads naturally on the board.

## 10. Mobile

The phone UI is a bottom-tab shell (`MobilePulseView.tsx`) with **Tasks / Team /
Capacity** tabs; **Tasks** today is the epic-grouped `MobileTaskList`. Two ways
to introduce the board on mobile:

**D9 (recommended): make "Tasks" a toggle between List and Board,** and on the
Board render **one status column at a time** with a segmented status picker
(Planned/In progress/Blocked/Done) at the top — full-width cards, vertical
scroll. This respects the narrow viewport far better than a horizontally
scrolling multi-column board and reuses the existing card renderer.

- Moving a card between statuses on mobile is done via the card's status control
  (tap card → DetailsTab status select), **not** cross-column drag, since
  horizontal drag across off-screen columns is a poor touch interaction.
  Optionally add quick "move to →" chips on the card.
- The existing floating "+" add-task FAB (`MobilePulseView.tsx:69`) seeds the
  currently-selected status column.

Horizontal multi-column scroll (D9-alt) is possible but rejected for v1 as the
default phone layout; it can be the tablet layout, which already gets the
desktop code path (`PulsePage.tsx:258` routes phones to `MobilePulseView`,
tablets to the desktop layout).

## 11. View switching & layout

- **Toggle lives in the `Toolbar`** — a segmented "Canvas | Board" control next
  to the density/zoom controls (`Toolbar.tsx:192-199` is the natural home).
  `PulsePage` holds a `view: "canvas" | "kanban"` state and renders either
  `<CanvasView>` or a new `<KanbanView>` in the same center slot
  (`PulsePage.tsx:346`).
- **Sidebar persists.** The left panel (Details / Team / Capacity,
  `PulsePage.tsx:309-344`) stays mounted across views; `selectedId` and
  `handleSelect` are shared, so selecting a card on the board opens the same
  DetailsTab a canvas box would, and vice-versa when you switch back.
- **Assignment panel is canvas-specific** (it's a timeline strip keyed to
  `offsetX`/`dayWidth`/`startDay`/`endDay`, `PulsePage.tsx:422-438`). **D10:
  hide the assignment panel in Kanban** (it has no meaning without the
  timeline), and restore it on switching back to Canvas.
- **Zoom / density / fit / compact / "delays" / "shrink epics"** are
  canvas-only; **D11: disable or hide those toolbar controls in Kanban** and
  keep the shared ones (search, status/epic filters, add task/epic, undo/redo,
  invite, effort scale).

## 12. Custom statuses (per-Pulse configurable)

**D14 — Statuses become per-Pulse configurable data**: users can add a new
status, **insert it in the middle**, recolor/rename it, and reorder columns —
except **"Done", which is a reserved terminal status** that cannot be removed,
renamed away from its identity, or reordered out of the terminal slot, and which
retains its special behavior (moving a task into it stamps `finishedAt` and
locks the task, §5.1 / D6).

This is **the single change that touches the data model**, and the **largest
work item** in the spec. It is deliberately **not** in the v1 board — v1 ships on
today's fixed four statuses — and lands as a later phase (see §14).

### 12.1 Where statuses live today (what has to change)

The current model hardcodes statuses in three places, all of which must become
dynamic:

- `FeatureStatus = "planned" | "in-progress" | "blocked" | "done"` — a string
  union (`src/types/index.ts:120`), used by both `Feature.status` and
  `Subtask.status`.
- `STATUS_META: Record<FeatureStatus, {border,bg,text,label}>`
  (`src/domain/constants.ts:24`) — the static label/color table read by the
  canvas box (`CanvasView.tsx:842-843, 906`), the mobile row
  (`MobileTaskList.tsx:86, 100`), and every DetailsTab status dropdown
  (`DetailsTab.tsx:214, 470`).
- `STATUS_OPTIONS` — a second hardcoded list in the toolbar
  (`Toolbar.tsx:46-51`) feeding the `MultiSelectFilter`.

### 12.2 Proposed model

Store an **ordered status list on the Pulse doc**, alongside the existing
per-Pulse config it already carries (`Pulse.graphConfig`, `Pulse.resourceTypes`,
`src/types/index.ts:42-47`), managed by a new store action in the same shape as
the existing `setResourceTypes` (`pulseStore.ts:140`, which already records an
undo entry and writes one pulse field):

```ts
interface StatusDef { id: string; label: string; color: string } // color = base; bg/text derived
interface Pulse { /* … */ statuses: StatusDef[] }  // ordered; "done" reserved, pinned terminal
```

- `Feature.status` (and `Subtask.status`) change from the union to a **status
  `id`** (`string`). `id` is stable and opaque so rename/recolor never rewrites
  feature docs; only reorder/insert changes the Pulse's `statuses` array, never
  the features.
- **`done` is a reserved id.** It always exists, is always the terminal column,
  and cannot be deleted or moved out of terminal position. The board's Done
  affordances (mute/collapse, lock, `finishedAt`) key off `status === "done"`
  exactly as today.
- **Derived colors.** `STATUS_META` currently stores `border`/`bg`/`text` per
  status; for custom statuses, store one base `color` per status and derive the
  soft `bg`/`text` at render (the codebase already has `hexA()` for exactly this
  alpha-derivation, `constants.ts:59`). Default color for a newly added status =
  next entry from a palette, reusing the `EPIC_PALETTE` / `colorForName` pattern
  (`constants.ts:31-56`).

### 12.3 Migration

- **Backfill / default.** A Pulse with no `statuses` array defaults to today's
  four (`planned`, `in-progress`, `blocked`, `done`) with their current
  `STATUS_META` colors — so existing Pulses look unchanged. Because ids equal
  today's string values, **existing `Feature.status` values need no rewrite**
  (they already are the ids). This makes the migration additive and lazy: write
  the default `statuses` on first edit, or fall back to a constant default when
  the field is absent (mirrors how `graphConfigOf` falls back to
  `DEFAULT_GRAPH_CONFIG`, `pulseStore.ts:436`).
- **Lookups become Pulse-scoped.** Replace direct `STATUS_META[status]` reads
  with a helper `statusMetaOf(pulse, id)` that resolves from `pulse.statuses`
  (with the derived bg/text) and returns a safe fallback for an unknown id
  (e.g. a task on a status that was just deleted → treat as the nearest
  remaining, or a neutral "unknown" chip). Every current `STATUS_META[...]` and
  `Object.entries(STATUS_META)` site
  (`CanvasView.tsx`, `MobileTaskList.tsx`, `DetailsTab.tsx:214,470`,
  `Toolbar.tsx`) routes through it.

### 12.4 Ripple effects

- **Status filter** (`MultiSelectFilter` fed by `STATUS_OPTIONS`,
  `Toolbar.tsx:213-218`): build its options from `pulse.statuses` instead of the
  constant. The "hide columns" semantics (D7) are unchanged.
- **Canvas** `STATUS_META` lookups (box bg/border/text) → `statusMetaOf`.
- **Mobile status picker** (D9) enumerates `pulse.statuses`.
- **DetailsTab dropdowns** (`Object.entries(STATUS_META)`, `DetailsTab.tsx:214,
  470`) enumerate `pulse.statuses`.
- **Deleting a status in use is blocked** (user decision). A status can only be
  deleted once **no task (or subtask) references it** — the status editor
  disables/denies delete while any card still uses it and tells the user how
  many, so they move those cards to another status first. This keeps delete a
  pure config change (no bulk task rewrite, no compound reassign op), at the
  cost of a manual move-first step. (`done` is never deletable regardless.)
- **Status editor UI.** A small management surface (add / rename / recolor /
  reorder, drag handles, "done" pinned) — natural home is the board itself
  (edit-columns affordance) and/or a Pulse settings menu.

**Recommendation:** phase it. Ship the v1 board on the fixed four statuses;
implement custom statuses as a dedicated later phase because it spans the type
system, three render sites, the filter, migration, and a new editor UI.

## 13. Non-goals (v1)

- Persisted free-form intra-column ordering (not needed — order is derived from
  epic grouping + start date, D5).
- Custom / configurable statuses in the **first** board release (designed in
  §12, D14, but phased later).
- WIP limits / column policies / swimlanes.
- Drag-driven assignment when grouping by assignee (read-only lens only).
- Cascading a card→Done down to its subtasks (each subtask keeps its own
  `finishedAt`).
- Multi-select / bulk-move of cards.
- Cross-Pulse boards or a portfolio board (single-Pulse only).

## 14. Proposed implementation phases

1. **`setFeatureStatus` store action** wrapping `patchFeature` + the
   finished-date logic (D6), then reused by DetailsTab so there's one status
   path. Small, unblocks the board.
2. **`KanbanView` with the fixed 4 status columns + drag-to-move** (via
   `setFeatureStatus`), cards grouped by epic and sorted by start date (D5),
   card renderer mirroring the canvas header, click-to-open DetailsTab,
   per-column / per-epic-group add, add-epic affordance (D13), viewer read-only,
   undo working for free. Toolbar Canvas|Board toggle; hide canvas-only controls
   + assignment panel.
3. **Filters wired** (reuse `featureQuery` / `MultiSelectFilter` status+epic /
   `filterResource`) with the "hide columns" status semantics (D7); overflow
   menu (duplicate/delete). Undo label tweak (D8).
4. **Explicit epic grouping mode** (columns = epics, drag = `moveFeatureToEpic`)
   and the group-by segmented control.
5. **Mobile Board mode** in the Tasks tab (single-column + status picker, D9);
   subtask progress count on cards (D4).
6. **Assignee grouping** as a read-only lens.
7. **Custom statuses (§12, D14)** — the data-model change: `Pulse.statuses`,
   `Feature.status` as id, `statusMetaOf` helper replacing static `STATUS_META`,
   migration/default, status-editor UI, and the filter/canvas/mobile ripple.
   Largest phase; ships after the board is proven on the fixed statuses.

## 15. Testing

- Unit (Vitest, no Firestore): the column-bucketing function (given features,
  produce per-column → per-epic-group → start-date-sorted lists), table-driven
  over the statuses, empty columns/groups, "No epic" fallback, and done-last.
- Interaction: a status drag issues exactly one `setFeatureStatus` write and
  exactly one undo entry; a card→Done stamps `finishedAt`, card→(not done)
  clears it; a same-column drop is a no-op (D5).
- Permissions: viewer renders no drag handles/actions; a done card is draggable
  between columns but its DetailsTab stays locked.
- Rules-emulator: a board status write from a viewer is denied; from an editor
  is allowed (reuses existing `features` write coverage).
- (Custom-statuses phase) migration: a Pulse with no `statuses` field resolves
  to the default four and existing `Feature.status` ids render unchanged;
  deleting a status is disabled while any task/subtask still references it
  (user must move those cards first) and always disabled for `done`.

## 16. Decisions to confirm (D-list)

1. **D1 — Default grouping = Status** (Planned/In progress/Blocked/Done), from
   `STATUS_META`. *Recommend: yes.*
2. **D2 — Done column muted/collapsible**, cards show 🔒. *Recommend: yes.*
3. **D3 — Selectable groupings:** Status (drag), Epic (drag =
   `moveFeatureToEpic`), Assignee (read-only lens). *Recommend: phase in that
   order.*
4. **D4 — Add `done/total` subtask progress to the card** (optionally back-port
   to canvas/mobile). *Recommend: yes.*
5. **D5 — In-column layout = grouped by epic, sorted by start date** (`Feature.x`
   asc), "No epic" group last; no manual reorder and no `order` field.
   *Settled (user decision).*
6. **D6 — Moving a card to Done stamps the feature's `finishedAt`** and locks it;
   moving out clears it. Uses the new `Feature.finishedAt` field
   (`types/index.ts:151`) and `setFeatureStatus` (`DetailsTab.tsx:81`), promoted
   to a shared store action. No subtask cascade. *Settled (user decision).*
7. **D7 — Status filter hides columns** when grouping by status. *Recommend:
   yes.*
8. **D8 — Relabel the lone-`{status}` undo entry to "Move task."** *Recommend:
   yes (cosmetic).*
9. **D9 — Mobile board = one status column at a time** with a status picker,
   status changes via the card's control (not horizontal drag). *Recommend:
   yes.*
10. **D10 — Hide the assignment panel in Kanban.** *Recommend: yes.*
11. **D11 — Hide/disable canvas-only toolbar controls** (zoom, density, fit,
    compact, delays, shrink epics) in Kanban; keep shared ones. *Recommend:
    yes.*
12. **D12 — View toggle lives in the Toolbar**, `view` state in `PulsePage`,
    shared `selectedId`/filters across Canvas ↔ Kanban. *Recommend: yes.*
13. **D13 — Add-epic affordance on the board** (reuse `addEpic`,
    `pulseStore.ts:147`); a new epic appears as an empty band in every column.
    Keep add-task per column / per epic-group. *Settled (new scope).*
14. **D14 — Custom per-Pulse statuses** (§12): ordered `Pulse.statuses`
    (`{id,label,color}[]`), `Feature.status` becomes a status **id**, **"Done"
    reserved + terminal** (stamps finished date + lock), migrate off the
    hardcoded `FeatureStatus` union + `STATUS_META`, derive bg/text via `hexA`,
    default color from a palette, ripple through the status filter / canvas /
    mobile picker. **The one data-model change; largest work item.**
    *Recommend: phase last — v1 board ships on the fixed four statuses.*
