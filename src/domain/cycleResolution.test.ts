import { describe, expect, it } from "vitest";
import { cyclesOf, cycleOfTask, statusesForTask, initialStatusOf, statusMetaInCycle, IMPLICIT_CYCLE_ID, DEFAULT_STATUSES } from "./constants";
import type { Cycle, StatusDef } from "@/types";

/**
 * Resolving a Beat's cycles, and a task's.
 *
 * The property under test throughout is that **a Beat that predates cycles is
 * not migrated** (CY11) — it resolves to exactly what it renders today, with
 * nothing written. The feature has to be revertable without having touched
 * customer data.
 */
const custom: StatusDef[] = [
  { id: "a", label: "A", color: "#000" },
  { id: "done", label: "Done", color: "#12A594" },
];
const rev: Cycle = { id: "rev", name: "Review", statuses: [{ id: "r", label: "R", color: "#000" }, { id: "done", label: "Done", color: "#000" }] };
const std: Cycle = { id: "std", name: "Standard", statuses: DEFAULT_STATUSES };

describe("a Beat with no cycles", () => {
  it("resolves to one cycle built from the built-in statuses", () => {
    const c = cyclesOf({});
    expect(c).toHaveLength(1);
    expect(c[0].id).toBe(IMPLICIT_CYCLE_ID);
    expect(c[0].statuses.map((s) => s.id)).toEqual(["planned", "in-progress", "blocked", "done"]);
  });

  it("keeps the statuses it customised", () => {
    // The whole point of computing rather than migrating: a Beat that edited
    // its statuses must not silently get the defaults back.
    expect(cyclesOf({ statuses: custom })[0].statuses).toEqual(custom);
  });

  it("is not treated as having cycles", () => {
    // An empty array must behave like absent, or a Beat whose cycles were all
    // deleted would render no columns at all.
    expect(cyclesOf({ cycles: [] })[0].id).toBe(IMPLICIT_CYCLE_ID);
  });
});

describe("a task's cycle", () => {
  const pulse = { cycles: [std, rev], defaultCycleId: "rev" };

  it("is the one it was stamped with", () => {
    expect(cycleOfTask({ cycleId: "std" }, pulse).id).toBe("std");
  });

  it("falls back to the Beat's default when unstamped", () => {
    // Every task created before cycles has no cycleId.
    expect(cycleOfTask({}, pulse).id).toBe("rev");
  });

  it("falls back to the first cycle when the Beat names no default", () => {
    expect(cycleOfTask({}, { cycles: [std, rev] }).id).toBe("std");
  });

  it("falls back rather than returning nothing when the stamp is stale", () => {
    // CY7: an orphan is shown, not crashed on. A caller must always get a cycle.
    expect(cycleOfTask({ cycleId: "deleted" }, pulse).id).toBe("rev");
  });

  it("never consults the task's epic", () => {
    // CY2a. The signature does not even accept one — stated as a test because
    // the temptation to "just pass the epic" is what would break the rule.
    expect(cycleOfTask.length).toBe(2);
  });
});

describe("what a task may be set to", () => {
  it("is its own cycle's statuses, not the Beat's whole vocabulary", () => {
    const pulse = { cycles: [std, rev] };
    expect(statusesForTask({ cycleId: "rev" }, pulse).map((s) => s.id)).toEqual(["r", "done"]);
    expect(statusesForTask({ cycleId: "std" }, pulse).map((s) => s.id)).toEqual(
      DEFAULT_STATUSES.map((s) => s.id),
    );
  });
});

describe("where a new task starts", () => {
  it("is the first stage of its cycle", () => {
    expect(initialStatusOf(rev)).toBe("r");
    expect(initialStatusOf(std)).toBe("planned");
  });

  it("does not assume the literal 'planned'", () => {
    // The hardcoded "planned" it replaces is correct only for the built-in
    // cycle; a support cycle starting in "Triage" would have been created in a
    // status it does not define.
    expect(initialStatusOf({ id: "s", name: "S", statuses: [{ id: "triage", label: "T", color: "#000" }] })).toBe("triage");
  });

  it("degrades rather than throwing on an empty cycle", () => {
    expect(initialStatusOf({ id: "x", name: "X", statuses: [] })).toBe("planned");
  });
});

describe("resolving a status in its owner's cycle", () => {
  // Review's own stage. Not in Standard's list, and not a built-in.
  const pulse = { cycles: [std, rev], defaultCycleId: "std" };

  it("reads a stage from the task's own cycle, not the Beat's", () => {
    // The bug this replaces: resolved against the Beat's list, "r" is in no
    // cycle the lookup can see, so it fell through to grey-with-a-raw-id — a
    // chip that looks deliberate and says nothing.
    expect(statusMetaInCycle("r", { cycleId: "rev" }, pulse).label).toBe("R");
    expect(statusMetaInCycle("r", { cycleId: "std" }, pulse).label).toBe("r");
  });

  it("resolves a subtask through its parent, not through the default", () => {
    // A subtask has a status but no cycleId. Passing it as its own owner would
    // resolve it against the Beat default — the very bug being removed — so the
    // parent is what gets passed.
    const parent = { cycleId: "rev" };
    expect(statusMetaInCycle("r", parent, pulse).label).toBe("R");
  });

  it("falls back to the Beat's default for an unstamped task", () => {
    const beatDefaultsToReview = { cycles: [std, rev], defaultCycleId: "rev" };
    expect(statusMetaInCycle("r", {}, beatDefaultsToReview).label).toBe("R");
    expect(statusMetaInCycle("r", {}, pulse).label).toBe("r");
  });

  it("still honours a renamed built-in", () => {
    // `statusMetaOf` keeps the hand-tuned palette for built-ins but takes the
    // label from the list. Routing through a cycle must not lose that.
    const renamed: Cycle = { id: "c", name: "C", statuses: [{ id: "planned", label: "Backlog", color: "#64748B" }] };
    expect(statusMetaInCycle("planned", { cycleId: "c" }, { cycles: [renamed], defaultCycleId: "c" }).label).toBe("Backlog");
  });
});
