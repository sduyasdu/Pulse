# Beats — Cycles (workflow processes) Specification

Status: **Draft for sign-off (CY1–CY12).** Extends `Kanban-Spec.md` D14, which
shipped per-Beat custom statuses. · Owner: product + eng ·
Related: `Kanban-Spec.md` (§12 statuses, D6 the terminal lock),
`Resource-Master-Spec.md` (RM15 — the copy-not-reference precedent this follows),
`Permissions-Spec.md` (who may edit org-level config), `MCP-Spec.md` (the
connector already publishes status labels).

---

## 0. What this is

Today a Beat has **one** status list. `Pulse.statuses` (`src/types/index.ts:245`)
is an ordered `StatusDef[]`, defaulting to four built-ins when unset
(`src/domain/constants.ts:36`). Every task in the Beat draws from that one list.

A **Cycle** is a named, ordered status list — a workflow — and a Beat may have
several. A task belongs to exactly one Cycle and may only hold statuses from it.
Cycles are defined once at organisation level and copied into Beats, and are
assigned at Beat, epic, or task level.

This is what lets one Beat carry design work that goes
`Planned → In progress → In review → Done` alongside delivery work that goes
`Planned → In progress → Blocked → Done`, without inventing a superset list
where half the columns are meaningless for half the tasks.

## 1. The model

```ts
export interface Cycle {
  id: string;
  name: string;              // "Standard", "Design review", "Support"
  statuses: StatusDef[];     // ordered; exactly one has terminal: true
}

export interface StatusDef {
  id: string;
  label: string;
  color: string;
  terminal?: boolean;        // NEW — see §3
}
```

Cycles live in two places, and the distinction matters:

| Where | Field | Who edits | What it is |
| --- | --- | --- | --- |
| Organisation | `Workspace.cycles?: Cycle[]` | Workspace admins | **Templates.** Never read at render time. |
| Beat | `Pulse.cycles?: Cycle[]` | Beat editors | **The live definitions.** Everything renders from here. |

**CY1 — Org cycles are templates, copied into a Beat, not referenced from it.**

This follows RM15 exactly, and for the same three reasons the roster does:

- **Permissions.** A Beat editor may not be a workspace admin. If a Beat
  rendered from org data, either editors could rewrite org config for every
  other Beat, or they could not adjust their own workflow at all. Neither is
  acceptable.
- **Blast radius.** Renaming an org status must not silently relabel every
  historical task in twenty Beats.
- **Reads.** `Pulse.cycles` is already inside the document the canvas
  subscribes to. A reference would mean a cross-collection read on a path the
  rules scope per Beat — the same problem `myPulses` exists to solve.

*Rejected: live references with copy-on-write.* It gets the "update once,
applies everywhere" property, at the cost of a Beat's columns changing under
someone mid-sprint because an admin edited a template. The roster made this
call already; consistency is worth more than the convenience.

## 2. Assignment and inheritance

**CY2 — A task's cycle is stamped at creation and never recomputed.**

This is the decision the brief actually turns on. *"All the new tasks in the
epic inherit the cycle, but not the ones moved from other epics"* is only
achievable if inheritance happens **once, at creation**, and is then materialised
on the task:

```ts
Feature.cycleId: string     // stamped at creation, never rewritten by a move
Epic.cycleId?: string       // the default for tasks created in this epic
Pulse.defaultCycleId: string
```

Resolution **at creation time only**:

```
task.cycleId  =  epic.cycleId  ??  pulse.defaultCycleId
```

`moveFeatureToEpic` (`src/stores/pulseStore.ts:505`) does **not** touch
`cycleId`. A task carries its workflow with it.

**CY2a — A cycle never changes on its own. It changes when someone changes it.**
Stated as a rule because it is the property the whole design protects: no drag,
no epic edit, no template update, and no bulk operation rewrites a task's cycle
without the person doing it having chosen that specific outcome.

**CY2b — A task's cycle is user-changeable, unless the task is done.** From the
task's own detail panel, alongside its status. Gated on the task not holding the
terminal status, for the same reason D6 locks a done task's other fields: its
workflow is part of the record of how it was completed, and `finishedAt` is
already stamped. Reopening the task (moving it off `done`) makes the cycle
editable again.

Changing the cycle keeps the current status if the new cycle defines it, and
otherwise orphans it per §4 — the user is shown which, before confirming.

*Rejected: resolving the cycle dynamically from the task's current epic.* It is
less data and needs no migration, and it is wrong: dragging a task between
epic bands on the canvas would silently change its workflow, and a task in
"In review" moved to an epic without that status would be instantly orphaned. A
drag on the canvas is a scheduling gesture, not a process decision.

**CY3 — Changing an epic's cycle offers to apply it to existing tasks, and
defaults to not.** The epic's `cycleId` governs future tasks. Existing tasks
already have their own. Silently rewriting them would orphan statuses (§4); not
offering at all makes a mistake at epic-creation time unfixable. So: a checkbox,
unchecked, saying how many tasks it would move and how many statuses would be
remapped.

**Done tasks are excluded from that bulk apply**, per CY2b — the count shown
says so. A completed task's workflow is history.

**CY4 — A Beat is asked for its cycle at creation, defaulting to the org's
first.** `CreatePulseDialog` asks only for a name today
(`src/components/dashboard/CreatePulseDialog.tsx:20`). It gains one select,
below the name, defaulting to the organisation's first cycle so the common path
stays a name and Enter. Changeable afterwards in the Beat's cycle manager.

## 3. The terminal status — the hard part

`Kanban-Spec.md` D6 makes `done` special: moving a task into it stamps
`finishedAt`, locks every other field, strikes the title, and de-emphasises the
column. **30 call sites compare the literal string `"done"`** or
`DONE_STATUS_ID`, across `CanvasView`, `KanbanView`, `StatusEditorDialog`,
`DetailsTab`, `MobileBoard`, `MobileTaskList`, `constants.ts` and `pulseStore`.

With one status list that works. With several it does not: a support cycle whose
terminal status is `resolved`, or a design cycle ending in `shipped`, would never
lock, never stamp `finishedAt`, and never count as complete in a report.

**CY5 — `Done` stays a reserved, hard-coded status, last in every cycle.**
*(Decided by the product owner 2026-09-17, reversing this spec's first
recommendation. The earlier draft proposed a `terminal: true` flag; the
reasoning and its cost are kept below because the trade-off is real and someone
will revisit it.)*

Every cycle ends with the same built-in `done` status. Cycles differ only in the
statuses **before** it. `done` cannot be removed, reordered out of last place, or
duplicated, exactly as `Kanban-Spec.md` D14 already requires — that rule simply
now applies per cycle rather than per Beat.

**What this buys:** the 30 call sites comparing `feature.status` against the
literal `"done"` keep working, unchanged. `DONE_STATUS_ID` stays meaningful.
`finishedAt`, the edit lock, the strike-through, the de-emphasised final column,
the MCP subtask count at `functions/src/mcpServer.ts:312` and the plugin's
completion bucket all keep their current implementation. This removes what was
the largest and quietest-breaking work item in the spec.

**What it costs, stated once so it is not rediscovered as a bug:** a cycle
cannot have a differently-*identified* terminal status. A support workflow
ending in "Resolved" or a design workflow ending in "Shipped" must store the id
`done` and relabel it. D14 already permits relabelling a built-in, so the board
will read "Shipped" — but the stored id remains `done`, and the MCP connector
publishes ids alongside labels, so an assistant asked about that task reports
`done`. That is the accepted cost. If it ever bites, the `terminal` flag is the
way out and this section is the argument for it.

**CY6 — Done is always last; a cycle is defined by the statuses before it.**
The editor appends `done` to every cycle and refuses to move it. A cycle with
one status is `Planned → Done`; the minimum is therefore two.

## 4. When the statuses under a task change

Changing a task's cycle — or editing a cycle to remove a status — can leave a
task holding a status its cycle no longer defines.

**CY7 — An orphaned status is preserved, shown, and flagged; never silently
rewritten.** `statusMetaOf` (`src/domain/constants.ts:56`) already falls back to
neutral grey for an unknown id rather than crashing, and that instinct is right.
Extended:

- The task keeps the orphaned id. Its history and any report that already
  counted it stay true.
- The board renders it in a trailing **"Unmapped"** column, greyed, with the
  orphaned label.
- Editing the task offers the new cycle's statuses; picking one resolves it.
- The cycle editor refuses to delete a status that tasks still hold without
  first asking what to remap them to.

*Rejected: auto-remapping to the first status of the new cycle.* It is tidy and
it destroys information — a task that was "Done" silently becomes "Planned",
`finishedAt` is stale, and the roadmap report changes retroactively with no
record of why.

## 5. Where cycles are managed

**CY8 — Two surfaces, matching where the data lives.**

- **Dashboard level** — org templates, on `PeoplePage`, the existing home for
  workspace configuration (`Workspace.resourceRoles`, RM22, is edited there
  today). Workspace admins only.
- **Beat level** — the Beat's own cycles, from the toolbar (§5.1). Beat editors.

The Beat-level manager also offers **"Add from organisation"**, copying a
template in — the same gesture and the same wording as the roster's "from
People" (`AddFromRosterDialog`), including the note that the copy is
independent.

### 5.1 The gear moves to the toolbar

**CY9 — Cycle management moves from the board header to the Beat toolbar.**

It sits at `KanbanView.tsx:148` today, which means it is reachable only from the
Board view. Cycles govern the canvas, the mobile list and the reports too, so
the control belongs with the other Beat-wide settings — beside **Effort scale**,
`Toolbar.tsx:246`.

**Two constraints on doing it.**

First, `KanbanView`'s header keeps *its* board-specific controls. Only the
cycle/status gear moves; "Add epic" stays.

Second, and this is a trap this repo has already fallen into: Effort scale is in
the toolbar's **first row**, and **that is the row that overflowed horizontally
on narrow displays**. The fix is recent, and adding a control there is precisely
what regresses it. Before merging, re-run the layout probe
(`build/layoutProbe/`) — it has a `toolbar` scene and a self-check that a
control provably cannot fit — **at every probed width and in all six
languages**, because the overflow was language-dependent and German and French
carry the longest labels.

*Fallback if row 1 will not take it:* row 3, beside Layout (`Toolbar.tsx:393`).
Worse placement — that row is view settings, and a cycle is Beat configuration —
but the measurement decides, not the taxonomy.

## 6. What this changes downstream

Statuses are not internal. Three consumers already publish or depend on them:

- **The MCP connector.** `get_beat` and `search_tasks` return a status label
  resolved through a map built from `beat.statuses`
  (`functions/src/mcpServer.ts:228, 266, 294, 329`). That map becomes
  per-task-cycle. The completion count at `:312` counts the status **id**
  `done` — which CY5 retires, so it must count "the task's terminal status"
  instead.
- **The plugin skills.** `beats-roadmap-report` buckets tasks into
  Completed / Ongoing / Stalled / Planned. With per-task cycles, those buckets
  must derive from position-in-cycle and terminality, not from four known ids.
  The plugin lives in a separate repository
  (`github.com/sduyasdu/beats-roadmap-toolkit`) and does **not** update itself;
  shipping CY5 without updating it is how the report starts mis-bucketing.
- **New tasks.** `status: "planned"` is hardcoded twice
  (`src/stores/pulseStore.ts:435` for tasks, `:638` for subtasks). Both become
  "the first status of the resolved cycle".

**CY10 — Subtasks inherit their parent task's cycle and are not separately
assignable.** A subtask is a checklist item on a task, not an independently
scheduled unit. Giving it its own workflow multiplies the model for no case
anyone has asked for.

## 7. Migration

**CY11 — Every existing Beat migrates to exactly one cycle, computed, with no
write.**

An existing Beat has `Pulse.statuses` or nothing. Both map cleanly:

```
cyclesOf(pulse) =
  pulse.cycles?.length  ? pulse.cycles
                        : [{ id: "default", name: "Standard",
                             statuses: statusesOf(pulse) }]
```

`statusesOf` (`constants.ts:48`) already resolves defaults, so a Beat that never
touched statuses gets the built-in four and a Beat that customised them gets
what it customised. A task with no `cycleId` resolves to that single cycle.

**No backfill write.** Nothing is migrated in the database until someone edits
cycles in that Beat, at which point the computed cycle is written out as the
first real one. This follows the pattern `statusesOf` already established, and
it means the feature can ship and be reverted without having touched a
customer's data.

**CY12 — The three default org cycles.** New workspaces get:

| Cycle | Statuses |
| --- | --- |
| **Simple** | Planned → In progress → **Done** |
| **Standard** *(default)* | Planned → In progress → Blocked → **Done** |
| **Review** | Planned → In progress → In review → **Done** |

"Standard" is exactly today's `DEFAULT_STATUSES`, which is what makes CY11 an
identity for every existing Beat. It is the default selection in CY4 for the
same reason.

## 7.0 What a stage *means*

**CY16 — Every stage carries one of three qualifications; Done is the fourth and
is not one of them.**

```ts
type StatusQualification = "planned" | "stalled" | "ongoing";   // 01, 02, 03
// done is fourth, and is the terminal status itself — not a qualification.
```

A cycle names its own stages, which is the point of cycles: "Triage", "In
review", "Executing". But anything summarising *across* cycles has to know
whether "Triage" is work not started or work underway, and cannot be expected to
infer it from the word. So each stage declares it, once, where the cycle is
defined — instead of every consumer guessing.

**This is what §8 question 4 was really asking**, and it was overstated there.
Nothing inside Beats buckets tasks this way: the board renders one column per
status, the dashboard card counts tasks not statuses, and the connector's only
status arithmetic is the subtask `done` count at `functions/src/mcpServer.ts:315`
— terminality, which was never ambiguous. The one consumer that needs it is the
plugin's roadmap report, which collapses statuses into Completed / Ongoing /
Stalled / Planned and, per its own Step 3, *"ask[s] the user how to bucket them
rather than guessing"* when the vocabulary does not map. With several cycles it
would ask on every report. Qualifications are what stop it asking.

`qualificationOf(statusId, statuses)` resolves in four steps:

1. The terminal status is always `done`, and that is not overridable.
2. An explicit `qualifies` wins.
3. A **built-in id keeps the meaning it has always had** — `planned` → planned,
   `in-progress` → ongoing, `blocked` → stalled.
4. Otherwise infer from position: first stage `planned`, anything else
   `ongoing`.

**Step 3 exists because the prototype caught its absence.** With only steps 2
and 4, the board rendered Standard's "Blocked" column as ONGOING — because
that Beat's statuses carry no `qualifies`, which is exactly the state CY11
leaves every existing Beat in, since migration writes nothing. Without the
built-in map, every Beat in the product would have silently reported its
stalled work as underway from the day cycles shipped. A custom stage meaning
"stalled" still cannot be inferred and must say so, which is why the editor
asks.

## 7.1 Board layout across sections

**CY14 — Uniform columns, left-aligned; Done sits in the longest cycle's
terminal slot.**

Every column is the same fixed width in every section, packed from the left. The
terminal column is not placed after its own section's columns — it is placed in
the **last slot of the widest cycle**, so Done lands on the same x everywhere and
a shorter cycle shows the gap it actually has.

```
Standard       [Planned][In progress][Blocked][Done]
Design review  [Planned][In review]           [Done]
Support        [Triage] [Working]             [Done]
```

Three properties follow, and all three were problems in earlier attempts:

- **Done is scannable down the page.** Only possible because CY5 keeps Done
  universal — with a per-cycle terminal id there is no column every section
  shares and nothing to align to. The decision made for its cheapness turns out
  to carry the layout.
- **A card is the same size wherever it is.** The eye reads down a column
  instead of re-measuring each section.
- **The gap is information.** It says this cycle is shorter, which is true and
  worth seeing. An earlier version stretched shorter cycles to fill that space;
  it removed the blank area and, with it, the fact.

`CycleBoard.slots` — the widest section's column count — is what makes this
work, and is the reason it is on the interface rather than computed in the
renderer. The grid is `slots` columns wide in every section however few a given
cycle fills, and the terminal column is placed at `slots`.

*Rejected: distributing shorter cycles' columns to fill the row.* Built and
looked at first. It leaves no blank space, and it makes a two-column cycle give
each column half the board — cards far wider than their content, and a different
card size in every section.

**CY15 — Sections run below and the board scrolls; the filter stays put.**

Five cycles do not fit a laptop viewport. The board does not shrink to make them
fit — a section is legible at one size, and three sections squeezed to two-thirds
are three sections nobody can read. They run below, and the region scrolls.

The cycle filter is **outside** that scrolling region, pinned above it. That is
the whole reason it moved to the top: a filter that scrolls away from the thing
it filters is a control you have to hunt for at exactly the moment you want it.

*Rejected: collapsible sections defaulting to open.* Still a reasonable addition
later, and it does not conflict with this. But it is not a substitute: with every
section open — which is the default, and the state that matters — the board is
exactly as tall, so scrolling is needed either way. Collapsing is a convenience
on top of scrolling, not an alternative to it.

## 7.2 Filtering the canvas by cycle

**CY13 — The canvas gains an optional cycle filter, off by default.**

`matchesCycleFilter` (`src/domain/cycleBoard.ts`) mirrors the canvas's existing
filters exactly — a `Set<string>` where **empty means no filter, not "match
nothing"** (`CanvasView.tsx:308-309`). It joins `featureStatusFilter`,
`epicFilter`, `filterResource` and the query in `PulsePage.tsx:295-304`, and
must be added to `filterSignatureOf` so a cycle filter participates in the same
scroll-restore behaviour as the others.

**A task with no `cycleId` counts as the Beat's default.** Every task created
before cycles ship has none, so any other reading would make the filter hide
most of an existing Beat the first time it is used.

**The filter sits above the board, and lists only the cycles the board is
showing.** Its chips are built from `board.sections`, not from every cycle the
Beat defines — a chip for a cycle with nothing in it filters to an empty board,
which is a dead end offered as a control. Each chip carries its task count, so
the row doubles as the summary of what is in the Beat.

Placing it above rather than below matters once the board scrolls (CY15): the
filter must stay visible while what it filters moves.

*Rejected: filtering the canvas by cycle implicitly whenever the board is
grouped.* The two views answer different questions — the board asks "what state
is everything in", the canvas asks "when does it happen" — and a filter that
turns itself on because another view is grouped is exactly the kind of silent
change CY2a exists to forbid.

## 8. Open questions

1. **Deleting a cycle that tasks still use.** CY7 covers an orphaned *status*.
   A deleted *cycle* is worse — the task has no workflow at all. Proposal: refuse
   the delete while tasks reference it, listing them, exactly as the status
   delete does. Needs confirming against how often people will want to clean up.
2. **Does a Beat-level cycle edit propagate back to the org template?** CY1 says
   no. Should the manager offer an explicit "save to organisation" for admins, so
   a refinement made in a Beat is not retyped? Likely yes, as a deliberate
   action, never automatic.
3. **Per-cycle board columns. ✅ DECIDED — group by cycle. Prototyped
   2026-09-17.** Three arrangements were possible: a **union** of every cycle's
   columns, a **filter** to one cycle at a time, or **grouping** into one band
   per cycle. Grouping is the only one where every column means exactly one
   thing and no task is hidden — a union puts "In progress" beside "In review"
   as though a task could be in either.

   `src/domain/cycleBoard.ts` builds it; `cycleBoard.test.ts` pins it; the probe
   scene `cycleBoard` renders it and `.probe-shots/cycleBoard-en-*.png` is what
   it looks like with three cycles, two epics and ten tasks.

   **The rule that matters most is when it does *not* group.** A Beat with one
   cycle in use renders exactly as today — no section headers, no visual change
   — and a Beat that *defines* five cycles but uses one gets no headers either.
   Grouping appears only when there is something to group.

   The first render showed two problems, both now fixed (CY14), and left one
   open:

   - ~~The terminal column does not line up.~~ **Fixed.** Done is pinned to the
     right edge of every section.
   - ~~Whitespace grows with cycle count.~~ **Addressed.** Columns are uniform
     and left-aligned; the remaining gap before Done is deliberate (CY14).
   - ~~Vertical cost.~~ **Resolved (CY15): the sections scroll.** Five cycles do
     not fit an 800px viewport and are not made to — they run below and the
     board scrolls, with the cycle filter fixed above it.

   The canvas and mobile list remain unaffected: they render a status per task,
   not columns.
4. ~~**Reporting across mixed cycles.**~~ **Answered by CY16.** Every stage
   declares whether it counts as planned, stalled or ongoing, so a summary never
   has to infer meaning from a label. Terminality already made "how many are
   done" unambiguous; this does the same for the rest.
