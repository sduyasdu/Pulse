import { describe, expect, it } from "vitest";
import { buildCycleBoard } from "./cycleBoard";
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

describe("degenerate input", () => {
  it("returns nothing rather than throwing when a Beat defines no cycles", () => {
    expect(buildCycleBoard([task("a", "planned")], epics, [])).toEqual({ grouped: false, sections: [] });
  });
});
