import { describe, expect, it } from "vitest";
import { copyCycleTemplate, epicCycleApply } from "./cycleTemplate";
import type { Cycle, Feature } from "@/types";

/**
 * Copying an org template into a Beat.
 *
 * CY1's whole point is that the copy is independent. What that means in
 * practice is entirely about which ids survive — so that is what this pins.
 */
const tpl: Cycle = {
  id: "org-support",
  name: "Support",
  statuses: [
    { id: "triage", label: "Triage", color: "#64748B" },
    { id: "working", label: "Working", color: "#F5A524" },
    { id: "done", label: "Done", color: "#12A594" },
  ],
};

describe("copying an org cycle template", () => {
  it("gives the copy its own id", () => {
    // Sharing the template's id would make two Beats' cycles compare equal
    // while being independently editable.
    expect(copyCycleTemplate(tpl).id).not.toBe(tpl.id);
  });

  it("gives every stage its own id, except Done", () => {
    // CY5: ~30 call sites compare against DONE_STATUS_ID to stamp finishedAt,
    // lock the task and count it complete. Renaming it here produces a cycle
    // whose last stage never locks and never counts as finished, silently.
    const copy = copyCycleTemplate(tpl, "X");
    expect(copy.statuses.map((s) => s.id)).toEqual(["st-X-0", "st-X-1", "done"]);
  });

  it("keeps the labels, colours and order", () => {
    const copy = copyCycleTemplate(tpl, "X");
    expect(copy.name).toBe("Support");
    expect(copy.statuses.map((s) => s.label)).toEqual(["Triage", "Working", "Done"]);
    expect(copy.statuses.map((s) => s.color)).toEqual(["#64748B", "#F5A524", "#12A594"]);
  });

  it("carries the qualification of each stage", () => {
    // CY16. Losing it on the copy would make a template's carefully set
    // "stalled" stage silently revert to position-inferred "ongoing".
    const withQ: Cycle = { ...tpl, statuses: [{ id: "blocked", label: "Blocked", color: "#E5484D", qualifies: "stalled" }] };
    expect(copyCycleTemplate(withQ, "X").statuses[0].qualifies).toBe("stalled");
  });

  it("does not mutate the template", () => {
    // It is the org's document; a Beat-level copy that edited it in place would
    // be CY1a's "nothing flows back" broken at the first step.
    const before = JSON.stringify(tpl);
    copyCycleTemplate(tpl);
    expect(JSON.stringify(tpl)).toBe(before);
  });

  it("gives two copies of one template different ids", () => {
    // Adding the same template twice is allowed, so the ids must not collide.
    expect(copyCycleTemplate(tpl, "A").id).not.toBe(copyCycleTemplate(tpl, "B").id);
    expect(copyCycleTemplate(tpl, "A").statuses[0].id).not.toBe(copyCycleTemplate(tpl, "B").statuses[0].id);
  });
});

describe("applying an epic's new cycle to its existing tasks (CY3)", () => {
  const target: Cycle = {
    id: "rev",
    name: "Review",
    statuses: [{ id: "triage", label: "Triage", color: "#000" }, { id: "done", label: "Done", color: "#000" }],
  };
  const f = (id: string, epicId: string, status: string, cycleId?: string) =>
    ({ id, title: id, epicId, status, cycleId, x: 0, y: 0, duration: 1, work: 1, resources: [], ai: false }) as Feature;

  const all = [
    f("keep", "e1", "triage", "std"),     // target defines "triage" — moves cleanly
    f("orphan", "e1", "in-progress", "std"), // target has no "in-progress"
    f("finished", "e1", "done", "std"),   // done — never moves
    f("already", "e1", "triage", "rev"),  // already on the target
    f("elsewhere", "e2", "triage", "std"), // another epic
    // Already on the target AND already holding a stage it does not define —
    // it is unmapped now and will be unmapped after, so this move does not
    // cause it.
    f("stuck", "e1", "legacy-qa", "rev"),
  ];

  it("counts only the tasks that would actually move", () => {
    const r = epicCycleApply("e1", target, all, "std", "done");
    expect(r.moving.map((x) => x.id).sort()).toEqual(["keep", "orphan"]);
  });

  it("excludes done tasks and reports them separately", () => {
    // CY2b: a completed task's workflow is history. Reported rather than
    // dropped, because "12 tasks (3 done, unchanged)" is honest and "12 tasks"
    // is not.
    const r = epicCycleApply("e1", target, all, "std", "done");
    expect(r.done.map((x) => x.id)).toEqual(["finished"]);
    expect(r.moving.some((x) => x.id === "finished")).toBe(false);
  });

  it("says how many statuses would be left unmapped", () => {
    // The second number CY3's checkbox has to show.
    const r = epicCycleApply("e1", target, all, "std", "done");
    expect(r.orphaning.map((x) => x.id)).toEqual(["orphan"]);
  });

  it("counts only orphans this move would cause", () => {
    // "stuck" is already on the target and already unmapped. Counting it would
    // blame this change for a state that predates it and does not alter — the
    // checkbox would overstate its own consequence, which is the one thing a
    // confirmation must not do.
    const r = epicCycleApply("e1", target, all, "std", "done");
    expect(r.orphaning.some((x) => x.id === "stuck")).toBe(false);
  });

  it("ignores tasks already on the target cycle", () => {
    // Moving them is a no-op, and counting them inflates the number shown.
    expect(epicCycleApply("e1", target, all, "std", "done").moving.some((x) => x.id === "already")).toBe(false);
  });

  it("ignores other epics' tasks", () => {
    expect(epicCycleApply("e1", target, all, "std", "done").moving.some((x) => x.id === "elsewhere")).toBe(false);
  });

  it("counts an unstamped task against the Beat's default", () => {
    // Unstamped and the default IS the target: nothing to do.
    const legacy = [f("old", "e1", "triage", undefined)];
    expect(epicCycleApply("e1", target, legacy, "rev", "done").moving).toEqual([]);
    expect(epicCycleApply("e1", target, legacy, "std", "done").moving.map((x) => x.id)).toEqual(["old"]);
  });
});
