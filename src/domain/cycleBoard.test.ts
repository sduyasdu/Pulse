import { describe, expect, it } from "vitest";
import { buildCycleBoard, matchesCycleFilter, sectionOfTask, canDropInSection, placeColumns, cycleChangeEffect, UNMAPPED_STATUS_ID } from "./cycleBoard";
import type { Cycle, Epic, Feature } from "@/types";

/**
 * Grouping the board by cycle.
 *
 * The behaviour that matters is not "it groups" — it is that it *stops*
 * grouping when there is nothing to group, because the overwhelming majority of
 * Beats will have one cycle and must look exactly as they do today.
 */
const DONE = { id: "done", label: "Done", color: "#12A594" };
const standard: Cycle = {
  id: "std",
  name: "Standard",
  statuses: [{ id: "planned", label: "Planned", color: "#64748B" }, { id: "in-progress", label: "In progress", color: "#F5A524" }, DONE],
};
const review: Cycle = {
  id: "rev",
  name: "Review",
  statuses: [{ id: "planned", label: "Planned", color: "#64748B" }, { id: "in-review", label: "In review", color: "#6366F1" }, DONE],
};

const epics: Epic[] = [{ id: "e1", name: "Platform", color: "#8B5CF6", y0: 0, y1: 100 } as Epic];

const task = (id: string, status: string, cycleId?: string): Feature =>
  ({ id, title: id, status, x: 0, y: 0, duration: 1, work: 1, resources: [], ai: false, epicId: "e1", cycleId }) as Feature;

describe("when only one cycle is in play", () => {
  it("does not group — today's board, unchanged", () => {
    const b = buildCycleBoard([task("a", "planned", "std"), task("b", "done", "std")], epics, [standard, review]);
    expect(b.grouped).toBe(false);
    expect(b.sections).toHaveLength(1);
    expect(b.sections[0].columns.map((c) => c.status)).toEqual(["planned", "in-progress", "done"]);
  });

  it("does not group tasks that predate cycles either", () => {
    // No cycleId at all: they belong to the Beat's default, not to a limbo.
    const b = buildCycleBoard([task("a", "planned"), task("b", "done")], epics, [standard, review]);
    expect(b.grouped).toBe(false);
    expect(b.sections[0].count).toBe(2);
  });

  it("ignores cycles the Beat defines but nothing uses", () => {
    // Five defined, one used, one header would be noise — so no header at all.
    const b = buildCycleBoard([task("a", "planned", "std")], epics, [standard, review]);
    expect(b.sections.map((s) => s.cycleId)).toEqual(["std"]);
  });
});

describe("when several cycles are in play", () => {
  const mixed = [task("a", "planned", "std"), task("b", "in-progress", "std"), task("c", "in-review", "rev")];

  it("gives each its own section, in its own status order", () => {
    const b = buildCycleBoard(mixed, epics, [standard, review]);
    expect(b.grouped).toBe(true);
    expect(b.sections.map((s) => s.name)).toEqual(["Standard", "Review"]);
    expect(b.sections[1].columns.map((c) => c.label)).toEqual(["Planned", "In review", "Done"]);
  });

  it("puts every task in exactly one section", () => {
    const b = buildCycleBoard(mixed, epics, [standard, review]);
    const ids = b.sections.flatMap((s) => s.columns.flatMap((c) => c.groups.flatMap((g) => g.tasks.map((t) => t.id))));
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("counts per section, for the header", () => {
    const b = buildCycleBoard(mixed, epics, [standard, review]);
    expect(b.sections.map((s) => s.count)).toEqual([2, 1]);
  });

  it("never invents a column one cycle does not define", () => {
    // The union arrangement would show "In progress" and "In review" side by
    // side as if a task could be in either. Grouping is what avoids that.
    const b = buildCycleBoard(mixed, epics, [standard, review]);
    expect(b.sections[0].columns.map((c) => c.status)).not.toContain("in-review");
    expect(b.sections[1].columns.map((c) => c.status)).not.toContain("in-progress");
  });
});

describe("a task pointing at a cycle the Beat no longer has", () => {
  it("is shown in a trailing section rather than disappearing", () => {
    const b = buildCycleBoard([task("a", "planned", "std"), task("ghost", "planned", "deleted")], epics, [standard]);
    expect(b.grouped).toBe(true);
    const last = b.sections[b.sections.length - 1];
    expect(last.name).toBe("Unknown cycle");
    expect(last.columns.flatMap((c) => c.groups.flatMap((g) => g.tasks.map((t) => t.id)))).toEqual(["ghost"]);
  });
});

describe("the widest section sets the layout", () => {
  it("reports the widest section's column count", () => {
    // Standard has 3 statuses, Review has 3 — both counting Done.
    const b = buildCycleBoard([task("a", "planned", "std"), task("c", "in-review", "rev")], epics, [standard, review]);
    expect(b.slots).toBe(3);
  });

  it("counts the widest, not the first", () => {
    const wide: Cycle = { id: "wide", name: "Wide", statuses: [
      { id: "a", label: "A", color: "#000" }, { id: "b", label: "B", color: "#000" },
      { id: "c", label: "C", color: "#000" }, DONE] };
    // `review` is first in the list and narrower; the wider one must win.
    const b = buildCycleBoard([task("x", "planned", "rev"), task("y", "a", "wide")], epics, [review, wide]);
    expect(b.slots).toBe(4);
  });

  it("is zero when there is nothing to lay out", () => {
    expect(buildCycleBoard([], epics, []).slots).toBe(0);
  });
});

describe("filtering the canvas by cycle", () => {
  it("an empty filter means no filter, not nothing", () => {
    // The canvas's other filters read `size === 0 || has(x)`; this must match,
    // or turning a filter on and off again would empty the canvas.
    expect(matchesCycleFilter({ cycleId: "std" }, new Set(), "std")).toBe(true);
  });

  it("keeps tasks in a selected cycle and drops the rest", () => {
    const f = new Set(["rev"]);
    expect(matchesCycleFilter({ cycleId: "rev" }, f, "std")).toBe(true);
    expect(matchesCycleFilter({ cycleId: "std" }, f, "std")).toBe(false);
  });

  it("treats a task with no cycle as the Beat's default", () => {
    // Every task created before cycles shipped has no cycleId. Filtering to the
    // default cycle must include them, or the filter hides most of the Beat.
    expect(matchesCycleFilter({}, new Set(["std"]), "std")).toBe(true);
    expect(matchesCycleFilter({}, new Set(["rev"]), "std")).toBe(false);
  });

  it("accepts several cycles at once", () => {
    const f = new Set(["std", "rev"]);
    expect(matchesCycleFilter({ cycleId: "std" }, f, "std")).toBe(true);
    expect(matchesCycleFilter({ cycleId: "sup" }, f, "std")).toBe(false);
  });
});

describe("degenerate input", () => {
  it("returns nothing rather than throwing when a Beat defines no cycles", () => {
    expect(buildCycleBoard([task("a", "planned")], epics, [])).toEqual({ grouped: false, sections: [], slots: 0, gridSlots: 0 });
  });
});

describe("dragging a card between sections", () => {
  const mixed = [task("a", "planned", "std"), task("c", "in-review", "rev")];
  const board = buildCycleBoard(mixed, epics, [standard, review]);

  it("knows which section a card is in", () => {
    expect(sectionOfTask(board, "a")?.cycleId).toBe("std");
    expect(sectionOfTask(board, "c")?.cycleId).toBe("rev");
    expect(sectionOfTask(board, "nope")).toBeNull();
  });

  it("refuses a drop into another cycle's section", () => {
    // CY2a: a drag is a scheduling gesture. Letting it land here would change
    // the task's workflow silently, which is the one thing the design forbids.
    expect(canDropInSection(board, "a", "rev")).toBe(false);
    expect(canDropInSection(board, "c", "std")).toBe(false);
  });

  it("allows a drop within the card's own section", () => {
    expect(canDropInSection(board, "a", "std")).toBe(true);
  });

  it("does not interfere with the single-cycle board", () => {
    // The board the overwhelming majority of Beats see. Every drop targets the
    // one section the card is already in, so the guard answers true — which is
    // why an explicit `!grouped` short-circuit would be unreachable.
    const single = buildCycleBoard([task("a", "planned", "std")], epics, [standard, review]);
    expect(single.grouped).toBe(false);
    expect(canDropInSection(single, "a", single.sections[0].cycleId)).toBe(true);
  });

  it("allows a card the board cannot place", () => {
    // Filtered out, or arrived mid-drag. Refusing on the strength of not
    // finding the card is worse than permitting the drop.
    expect(canDropInSection(board, "unknown", "rev")).toBe(true);
  });
});

describe("placing a section's columns in the grid (CY14)", () => {
  // A five-slot board: the widest cycle has four stages plus Done.
  const long: Cycle = {
    id: "long",
    name: "Long",
    statuses: [
      { id: "planned", label: "Planned", color: "#64748B" },
      { id: "spec", label: "Spec", color: "#64748B" },
      { id: "build", label: "Build", color: "#F5A524" },
      { id: "in-review", label: "In review", color: "#6366F1" },
      DONE,
    ],
  };
  const board = buildCycleBoard(
    [task("a", "planned", "std"), task("b", "planned", "long")],
    epics,
    [standard, long],
  );

  const slotOf = (cycleId: string, status: string) => {
    const section = board.sections.find((x) => x.cycleId === cycleId)!;
    return placeColumns(section.columns, board.slots).find((p) => p.col.status === status)!.slot;
  };

  it("aligns Done across sections of different lengths", () => {
    // The whole point of CY14. The short cycle has three columns and the long
    // one five; Done must sit in the same grid column in both, or the eye has
    // no shared reference down the page.
    expect(board.slots).toBe(5);
    expect(slotOf("std", "done")).toBe(5);
    expect(slotOf("long", "done")).toBe(5);
  });

  it("packs the shorter cycle's stages left, leaving the gap visible", () => {
    // Not stretched to fill: the gap says this cycle is shorter, which is true
    // and worth seeing.
    expect(slotOf("std", "planned")).toBe(1);
    expect(slotOf("std", "in-progress")).toBe(2);
    // ...and nothing of the short cycle occupies slots 3 or 4.
    const std = board.sections.find((x) => x.cycleId === "std")!;
    const slots = placeColumns(std.columns, board.slots).map((p) => p.slot);
    expect(slots).toEqual([1, 2, 5]);
  });

  it("does not let a hidden stage shift Done", () => {
    // The status filter hides "Spec". The stages after it close up, but Done
    // stays in the last slot — otherwise filtering one cycle's stage would
    // knock its Done column out of line with every other section's.
    const long_ = board.sections.find((x) => x.cycleId === "long")!;
    const visible = long_.columns.filter((c) => c.status !== "spec");
    expect(placeColumns(visible, board.slots).map((p) => p.slot)).toEqual([1, 2, 3, 5]);
  });

  it("does not leave a hole where a hidden Done was", () => {
    // Done filtered out entirely: the remaining stages still pack from 1, and
    // no slot is reserved for a column that is not being drawn.
    const std = board.sections.find((x) => x.cycleId === "std")!;
    const visible = std.columns.filter((c) => c.status !== "done");
    expect(placeColumns(visible, board.slots).map((p) => p.slot)).toEqual([1, 2]);
  });

  it("never emits grid column 0", () => {
    // An empty board reports slots 0, and `gridColumn: 0` is invalid CSS — the
    // browser drops the rule and the column lands wherever auto-placement puts
    // it. Done collides with the first stage here, which is acceptable only
    // because a board with no sections has no columns to draw.
    expect(placeColumns(board.sections[0].columns, 0).map((p) => p.slot)).toEqual([1, 2, 1]);
  });
});

describe("where an unstamped task lands (CY11)", () => {
  // Every task created before cycles shipped has no `cycleId`, so this is the
  // shape of every existing Beat — not an edge case.
  const legacy = task("old", "planned", undefined);

  it("follows the Beat's default, not the first cycle in the list", () => {
    // The Beat's default is Review, which is *second*. `cycleOfTask` resolves
    // this task's statuses through `defaultCycleId`, so the board must group it
    // the same way — otherwise the card sits in Standard's section while its
    // status is read from Review's list.
    const board = buildCycleBoard([legacy], epics, [standard, review], true, "rev");
    expect(board.sections.map((x) => x.cycleId)).toEqual(["rev"]);
  });

  it("falls back to the first cycle when the Beat names no default", () => {
    const board = buildCycleBoard([legacy], epics, [standard, review]);
    expect(board.sections.map((x) => x.cycleId)).toEqual(["std"]);
  });

  it("falls back to the first cycle when the named default is gone", () => {
    // A default pointing at a deleted cycle would otherwise leave the board
    // with no fallback at all and drop every unstamped task.
    const board = buildCycleBoard([legacy], epics, [standard, review], true, "deleted");
    expect(board.sections.map((x) => x.cycleId)).toEqual(["std"]);
    expect(board.sections[0].count).toBe(1);
  });

  it("groups unstamped tasks with ones explicitly stamped to the default", () => {
    // They resolve to the same cycle, so two sections for one workflow would be
    // a split that exists only in the data, not in the user's model.
    const board = buildCycleBoard([legacy, task("new", "planned", "rev")], epics, [standard, review], true, "rev");
    expect(board.sections).toHaveLength(1);
    expect(board.sections[0].count).toBe(2);
    expect(board.grouped).toBe(false);
  });
});

describe("a task holding a status its cycle no longer defines (CY7)", () => {
  // "qa" is in neither cycle — the stage was deleted from the cycle editor, or
  // the task was moved to a cycle that never had it.
  const orphan = task("orphan", "qa", "std");
  const normal = task("ok", "planned", "std");

  it("shows it rather than dropping it", () => {
    // The bug: `buildBoard` buckets by iterating the status list, so a task
    // matching no stage was simply absent from its own board. Not greyed, not
    // flagged — gone, with no empty state to say so.
    const board = buildCycleBoard([orphan, normal], epics, [standard]);
    const ids = board.sections[0].columns.flatMap((c) => c.groups.flatMap((g) => g.tasks.map((t) => t.id)));
    expect(ids).toContain("orphan");
  });

  it("puts it in a trailing column, after Done", () => {
    // An orphan is not a stage of the workflow and must not read as one, so it
    // sits past the terminal column rather than among the stages.
    const board = buildCycleBoard([orphan, normal], epics, [standard]);
    const cols = board.sections[0].columns;
    expect(cols[cols.length - 1].status).toBe(UNMAPPED_STATUS_ID);
    expect(cols[cols.length - 1].count).toBe(1);
  });

  it("keeps the task's own status id", () => {
    // CY7: preserved, never silently rewritten. Its history and any report
    // that already counted it stay true.
    const board = buildCycleBoard([orphan], epics, [standard]);
    const col = board.sections[0].columns.find((c) => c.status === UNMAPPED_STATUS_ID)!;
    expect(col.groups[0].tasks[0].status).toBe("qa");
  });

  it("adds no column when nothing is orphaned", () => {
    // The column must not appear on the ordinary board, which is every board.
    const board = buildCycleBoard([normal], epics, [standard]);
    expect(board.sections[0].columns.some((c) => c.status === UNMAPPED_STATUS_ID)).toBe(false);
  });

  it("orphans per cycle, not per Beat", () => {
    // "in-review" is a real stage of Review and an orphan in Standard. A
    // Beat-wide notion of "unknown status" would call it orphaned in both.
    const board = buildCycleBoard(
      [task("a", "in-review", "rev"), task("b", "in-review", "std"), task("c", "planned", "std")],
      epics,
      [standard, review],
    );
    const std = board.sections.find((x) => x.cycleId === "std")!;
    const rev = board.sections.find((x) => x.cycleId === "rev")!;
    expect(std.columns.find((c) => c.status === UNMAPPED_STATUS_ID)?.count).toBe(1);
    expect(rev.columns.some((c) => c.status === UNMAPPED_STATUS_ID)).toBe(false);
  });

  it("widens the grid without moving Done", () => {
    // The two numbers answer different questions: `slots` is where Done goes
    // (the longest workflow), `gridSlots` is how many tracks to draw. Sizing
    // the grid from `slots` would leave the Unmapped column outside the
    // declared tracks, where the browser adds an implicit one at content width
    // rather than the 260px every other column has.
    const clean = buildCycleBoard([normal], epics, [standard]);
    const withOrphan = buildCycleBoard([orphan, normal], epics, [standard]);
    expect(withOrphan.slots).toBe(clean.slots);
    expect(withOrphan.gridSlots).toBe(clean.gridSlots + 1);
    expect(clean.gridSlots).toBe(clean.slots);
  });

  it("does not let the extra column push Done out of line", () => {
    // `slots` is computed from the section column counts, so an Unmapped
    // column in one section would otherwise widen the board and move every
    // other section's Done.
    const board = buildCycleBoard([orphan, normal], epics, [standard]);
    const done = placeColumns(board.sections[0].columns, board.slots).find((x) => x.col.status === "done")!;
    const unmapped = placeColumns(board.sections[0].columns, board.slots).find((x) => x.col.status === UNMAPPED_STATUS_ID)!;
    expect(unmapped.slot).toBeGreaterThan(done.slot);
  });
});

describe("moving a task to another cycle (CY2b)", () => {
  it("keeps the status when the new cycle defines it", () => {
    // Both cycles have "planned", so nothing moves but the stamp.
    const e = cycleChangeEffect({ status: "planned", cycleId: "std" }, review, "done");
    expect(e).toEqual({ blocked: false, keepsStatus: true, orphanedStatus: null });
  });

  it("reports the status that would be orphaned", () => {
    // "in-progress" is Standard's; Review has no such stage. CY2b requires the
    // user be shown WHICH status before confirming, not merely that something
    // will happen.
    const e = cycleChangeEffect({ status: "in-progress", cycleId: "std" }, review, "done");
    expect(e.keepsStatus).toBe(false);
    expect(e.orphanedStatus).toBe("in-progress");
  });

  it("refuses a done task", () => {
    // Its workflow is part of the record of how it was completed, and
    // `finishedAt` is already stamped.
    const e = cycleChangeEffect({ status: "done", cycleId: "std" }, review, "done");
    expect(e.blocked).toBe(true);
  });

  it("describes no consequence for a change it refuses", () => {
    // A cycle without Done at all: the task's status would orphan if it moved.
    // It cannot move, so saying so would invite a dialog that warns and then
    // refuses.
    const noDone: Cycle = { id: "nd", name: "No done", statuses: [{ id: "x", label: "X", color: "#000" }] };
    const e = cycleChangeEffect({ status: "done", cycleId: "std" }, noDone, "done");
    expect(e.blocked).toBe(true);
    expect(e.orphanedStatus).toBeNull();
  });

  it("treats an already-orphaned status as orphaned by the move too", () => {
    // A task sitting in the Unmapped column keeps sitting there unless the new
    // cycle happens to define its stage.
    expect(cycleChangeEffect({ status: "qa", cycleId: "std" }, review, "done").orphanedStatus).toBe("qa");
    const withQa: Cycle = { id: "q", name: "Q", statuses: [{ id: "qa", label: "QA", color: "#000" }] };
    expect(cycleChangeEffect({ status: "qa", cycleId: "std" }, withQa, "done").keepsStatus).toBe(true);
  });
});
