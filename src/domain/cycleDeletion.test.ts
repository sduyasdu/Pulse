import { describe, expect, it } from "vitest";
import { cycleDeletionBlockers, tasksHoldingStage } from "./cycleDeletion";
import type { Epic, Feature } from "@/types";

/**
 * A cycle in use cannot be deleted.
 *
 * What is being pinned is not the refusal but its *precision*: the caller has to
 * be able to say which tasks and which epics, and to distinguish the ones that
 * can be reassigned from the ones that cannot, because those need different
 * actions from the person clearing them.
 */
const task = (id: string, cycleId: string | undefined, status = "planned"): Feature =>
  ({ id, title: id, status, cycleId, x: 0, y: 0, duration: 1, work: 1, resources: [], ai: false }) as Feature;
const epic = (id: string, cycleId?: string): Epic =>
  ({ id, name: id, color: "#000", y0: 0, y1: 1, cycleId }) as Epic & { cycleId?: string };

describe("an unused cycle", () => {
  it("is deletable", () => {
    const b = cycleDeletionBlockers("rev", [task("a", "std")], [epic("e1", "std")], "std");
    expect(b.deletable).toBe(true);
    expect(b.reassignable).toEqual([]);
    expect(b.epics).toEqual([]);
  });
});

describe("tasks holding the cycle", () => {
  it("block it, and are named", () => {
    const b = cycleDeletionBlockers("rev", [task("a", "rev"), task("b", "std")], [], "std");
    expect(b.deletable).toBe(false);
    expect(b.reassignable.map((t) => t.id)).toEqual(["a"]);
  });

  it("separates done tasks, which cannot be reassigned", () => {
    // CY2b forbids changing a completed task's cycle, so telling someone to
    // reassign these would send them at a control the app will refuse. The only
    // ways past are to reopen or delete.
    const b = cycleDeletionBlockers("rev", [task("open", "rev"), task("shut", "rev", "done")], [], "std");
    expect(b.reassignable.map((t) => t.id)).toEqual(["open"]);
    expect(b.doneTasks.map((t) => t.id)).toEqual(["shut"]);
    expect(b.deletable).toBe(false);
  });

  it("counts tasks with no cycleId against the Beat's default", () => {
    // They resolve to the default everywhere else (CY11); deleting it without
    // counting them would orphan every task that predates cycles.
    const b = cycleDeletionBlockers("std", [task("legacy", undefined)], [], "std");
    expect(b.reassignable.map((t) => t.id)).toEqual(["legacy"]);
  });

  it("does not count them against a different cycle", () => {
    const b = cycleDeletionBlockers("rev", [task("legacy", undefined)], [], "std");
    expect(b.reassignable).toEqual([]);
  });
});

describe("epics defaulting to the cycle", () => {
  it("block it even with no tasks, because new tasks would inherit a dead cycle", () => {
    const b = cycleDeletionBlockers("rev", [], [epic("design", "rev")], "std");
    expect(b.deletable).toBe(false);
    expect(b.epics.map((e) => e.id)).toEqual(["design"]);
  });
});

describe("the Beat's own default", () => {
  it("is never deletable, even with nothing using it", () => {
    // A Beat always has a default; deleting it would leave new tasks with
    // nothing to inherit.
    const b = cycleDeletionBlockers("std", [], [], "std");
    expect(b.isBeatDefault).toBe(true);
    expect(b.deletable).toBe(false);
  });
});

describe("naming things that have no name", () => {
  it("still lists an untitled task and an untitled epic", () => {
    // A blocker the user cannot see is a blocker they cannot clear.
    const anon = { ...task("t", "rev"), title: "" } as Feature;
    const b = cycleDeletionBlockers("rev", [anon], [{ ...epic("e", "rev"), name: "" } as Epic], "std");
    expect(b.reassignable[0].title).toBe("Untitled task");
    expect(b.epics[0].name).toBe("Untitled epic");
  });
});

describe("deleting a stage from a cycle (CY7)", () => {
  const all = [
    task("a", "std", "blocked"),
    task("b", "std", "planned"),
    task("c", "rev", "blocked"),
    task("legacy", undefined, "blocked"),
  ];

  it("names the tasks rather than merely counting them", () => {
    // CY7 forbids deleting a stage tasks hold "without first asking what to
    // remap them to", and you cannot ask that without naming them.
    const held = tasksHoldingStage("std", "blocked", all, "std");
    expect(held.map((f) => f.id).sort()).toEqual(["a", "legacy"]);
  });

  it("does not count another cycle's tasks in the same-named stage", () => {
    // Every cycle has `done`, and a cloned cycle shares more than that, so a
    // Beat-wide count would refuse deletions it has no reason to.
    expect(tasksHoldingStage("rev", "blocked", all, "std").map((f) => f.id)).toEqual(["c"]);
  });

  it("counts unstamped tasks against the Beat's default", () => {
    // Otherwise deleting a stage from the default cycle reports zero while
    // stranding every task that predates cycles — which is all of them.
    expect(tasksHoldingStage("std", "blocked", all, "std").some((f) => f.id === "legacy")).toBe(true);
    expect(tasksHoldingStage("std", "blocked", all, "rev").some((f) => f.id === "legacy")).toBe(false);
  });

  it("is empty for a stage nothing holds", () => {
    expect(tasksHoldingStage("std", "in-progress", all, "std")).toEqual([]);
  });
});
