import { describe, expect, it } from "vitest";
import { copyCycleTemplate } from "./cycleTemplate";
import type { Cycle } from "@/types";

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
