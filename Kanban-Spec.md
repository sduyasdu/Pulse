# Pulse — Kanban Board View Specification

Status: **Draft for sign-off (D1–D12)** · Scope: v1 (one alternative view inside a single Pulse; desktop + mobile)

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

Dragging a card from column A to column B commits
`patchFeature(id, { status: B })` (status grouping) — a single write, a single
undo entry (§9). Consequences to honor:

- **Into "done":** the card becomes locked for content edits everywhere
  (DetailsTab, canvas). No confirmation needed; it's reversible via drag-back or
  ⌘Z. The board should *allow* the drag for editors regardless of the source
  lock, because status is the one field that stays editable on a done task
  (`DetailsTab.tsx:465` keeps the status `<select>` on `canEditProp`, not
  `canEdit`).
- **Out of "done":** unlocks the card. Trivial `patchFeature`.
- **Finished-date behavior:** *subtasks* carry `finishedAt` and auto-stamp/clear
  it when their own status flips (`DetailsTab.tsx:81-88` `setSubtaskStatus`).
  **A Feature has no `finishedAt` field.** So moving a *card* to Done does **not**
  touch any date today. Two open choices (D6):
  1. Keep it simple — card→Done sets only `status`, subtasks untouched.
     (Recommended for v1: least surprising, no cascade, no schema change.)
  2. Cascade — card→Done also marks all `children` done and stamps their
     `finishedAt`. Powerful but destructive and awkward to undo cleanly; defer.

### 5.2 Reorder within a column

**D5 — Pulse tasks have no order field, so v1 does NOT persist intra-column
order.** Cards within a column render in a stable derived order (recommended:
by `x` start day ascending, then title) so the board is deterministic and
useful without a schema change. Drag-to-reorder within the same column is
**disabled** in v1 (a same-column drop is a no-op). Adding a real `order: number`
field to `Feature` is possible but costs a migration, new write paths, and undo
coverage — see §7 D5-alt. Recommendation: ship without it; revisit if users ask.

### 5.3 Open, add, duplicate, delete

- **Click / tap a card → open DetailsTab.** Reuse `handleSelect(id)`
  (`PulsePage.tsx:188`) which sets `selectedId` and switches the sidebar to the
  Details tab — the board shares selection with the canvas.
- **Add card per column.** A "+" in each column header calls `addFeature({ x,
  y, status: <column status> })` (`pulseStore.ts:182`) pre-seeded with that
  column's status, then `handleSelect(newId)` to open it. (`x`/`y` get sensible
  defaults, e.g. `todayIndex()` like the mobile add, `MobilePulseView.tsx:41`.)
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

**Ideally none.** The board renders entirely from existing `Feature` fields, and
every mutation is an existing store action. Specifically:

- Columns = `status` (exists).
- Card content = `title`, `epicId`, `resources`/`lead`/`alloc`, `x`/`duration`,
  `children`, `attachments`, `plannedX`, `ai`, `labelColor` (all exist).
- Moves = `patchFeature`/`moveFeatureToEpic` (exist).

**The only field the board *might* want and doesn't have is intra-column order.**

**D5-alt (deferred):** adding `order?: number` to `Feature` would enable
persisted drag-to-reorder within a column. Cost: a backfill for existing docs,
reorder-write logic (fractional ranking or renumber), and undo coverage for it.
**Recommendation: skip in v1** — derive a stable order from `x`/title (D5) and
avoid the schema change until there's demand.

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

No new undo work is required for status moves. `patchFeature(id, { status })`
already calls `recordSingle("Edit task", pulseId, patchOp("feature", id, before,
{ status }))` (`pulseStore.ts:206`), which is a **field-level** patch op — undo
restores only `status`, preserving any concurrent edit to other fields (D1 of
Undo-Spec). Redo is the mirror. Notes:

- A column drag is a **single** `patchFeature`, so — unlike canvas x/y drags,
  which need gesture coalescing (Undo-Spec §5) — it is already exactly one undo
  entry. No coalescing needed.
- Epic-grouping drags go through `moveFeatureToEpic`, already a single "Move
  task to epic" entry that reverses `epicId` **and** `y` together (Undo-Spec D3).
- Add/duplicate/delete from the board reuse `addFeature`/`duplicateFeature`/
  `removeFeature`, each of which already records ("Add task" / "Duplicate task" /
  "Delete task"). The toolbar's existing ↶/↷ buttons and ⌘Z/⇧⌘Z handlers
  (`PulsePage.tsx:94-111`, `Toolbar.tsx:203`) work over the board with zero
  changes.

**D8:** relabel the status-move undo entry from the generic "Edit task" to
"Move task" when the patch is a lone `{ status }` change, so the toast/tooltip
reads naturally on the board (small tweak in `patchFeature`'s `record` label, or
a dedicated `moveFeatureStatus` wrapper).

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

## 12. Non-goals (v1)

- Persisted intra-column ordering (needs a schema field — D5).
- WIP limits / column policies / swimlanes.
- Drag-driven assignment when grouping by assignee (read-only lens only).
- A "cascade subtasks to done" behavior (D6 option 2).
- Multi-select / bulk-move of cards.
- Cross-Pulse boards or a portfolio board (single-Pulse only).

## 13. Proposed implementation phases

1. **`KanbanView` with status columns + drag-to-move** (`patchFeature({status})`),
   card renderer mirroring the canvas header, click-to-open DetailsTab,
   per-column add, viewer read-only, undo working for free. Toolbar
   Canvas|Board toggle; hide canvas-only controls + assignment panel.
2. **Filters wired** (reuse `featureQuery` / `MultiSelectFilter` status+epic /
   `filterResource`) with the "hide columns" status semantics (D7); overflow
   menu (duplicate/delete). Undo label tweak (D8).
3. **Epic grouping** (drag = `moveFeatureToEpic`) and the group-by segmented
   control.
4. **Mobile Board mode** in the Tasks tab (single-column + status picker, D9);
   subtask progress count on cards (D4).
5. **Assignee grouping** as a read-only lens (phase 3+).

## 14. Testing

- Unit (Vitest, no Firestore): the column-bucketing + stable-order function
  (given features, produce per-column ordered lists) — table-driven over the 4
  statuses, empty columns, and done-last ordering.
- Interaction: a status drag issues exactly one `patchFeature({status})` and
  exactly one undo entry; same-column drop is a no-op (D5).
- Permissions: viewer renders no drag handles/actions; a done card is draggable
  between columns but its DetailsTab stays locked.
- Rules-emulator: a board `patchFeature` from a viewer is denied; from an
  editor is allowed (reuses existing `features` write coverage).

## 15. Decisions to confirm (D-list)

1. **D1 — Default grouping = Status** (Planned/In progress/Blocked/Done), from
   `STATUS_META`. *Recommend: yes.*
2. **D2 — Done column muted/collapsible**, cards show 🔒. *Recommend: yes.*
3. **D3 — Selectable groupings:** Status (drag), Epic (drag =
   `moveFeatureToEpic`), Assignee (read-only lens). *Recommend: phase in that
   order.*
4. **D4 — Add `done/total` subtask progress to the card** (optionally back-port
   to canvas/mobile). *Recommend: yes.*
5. **D5 — No intra-column order field in v1**; derive stable order from
   `x`/title; same-column reorder disabled. *Recommend: yes; defer `order`
   field until requested.*
6. **D6 — Moving a card to Done sets only `status`** (no subtask cascade, no
   feature-level finished date — the model has none). *Recommend: option 1
   (simple).* Confirm you don't want the cascade.
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
