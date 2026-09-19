import { describe, expect, it } from "vitest";
import { statusFilterOptions, groupOptions } from "./statusFilterOptions";
import { copyCycleTemplate } from "./cycleTemplate";
import { BASELINE_CYCLES } from "./baselineCycles";

/**
 * The defect this exists to fix: a Beat running two cycles listed "Planned"
 * twice, "In progress" twice, identical and unselectable apart, because the
 * flat list deduped by id and every cycle has its own stage ids.
 */
// Two baseline templates that genuinely collide: both have a "Design" stage
// and both have "On hold", with different ids in each. That is the real shape
// of the problem, not a contrived one.
const std = copyCycleTemplate(BASELINE_CYCLES.find((c) => c.id === "cy-pd-digital")!, "A");
const rev = copyCycleTemplate(BASELINE_CYCLES.find((c) => c.id === "cy-pd-physical")!, "B");
const DIGITAL = "Product development (digital)";
const PHYSICAL = "Product development (physical)";

describe("a Beat with more than one cycle", () => {
  const opts = statusFilterOptions({ cycles: [std, rev] });

  it("gives every entry a heading that identifies it", () => {
    // The whole point. Two stages named "Design" are fine as long as the list
    // says which cycle each belongs to.
    const design = opts.filter((o) => o.name === "Design");
    expect(design).toHaveLength(2);
    expect(design.map((o) => o.group)).toEqual([DIGITAL, PHYSICAL]);
    expect(new Set(design.map((o) => o.id)).size).toBe(2);
  });

  it("separates the stalled stages too", () => {
    // Every baseline template calls its stalled stage "On hold", so this is
    // the collision that happens in EVERY multi-cycle Beat, not an edge case.
    const hold = opts.filter((o) => o.name === "On hold");
    expect(hold).toHaveLength(2);
    expect(hold.map((o) => o.group)).toEqual([DIGITAL, PHYSICAL]);
  });

  it("lists Done once, ungrouped", () => {
    // One reserved id shared by every cycle (CY5). Under each heading it would
    // be the same checkbox offered twice.
    const done = opts.filter((o) => o.id === "done");
    expect(done).toHaveLength(1);
    expect(done[0].group).toBeUndefined();
  });

  it("puts Done last, after every cycle", () => {
    expect(opts[opts.length - 1].id).toBe("done");
  });

  it("carries each stage's own colour", () => {
    expect(opts.find((o) => o.name === "On hold")?.color).toBe("#E5484D");
  });
});

describe("a Beat with one cycle", () => {
  it("has no headings at all", () => {
    // The overwhelming majority. A heading over the only group says nothing,
    // and this list must look exactly as it did before cycles existed.
    const opts = statusFilterOptions({ cycles: [std] });
    expect(opts.every((o) => o.group === undefined)).toBe(true);
    expect(opts.map((o) => o.name)).toEqual(["Discovery", "Design", "Build", "Test", "On hold", "Done"]);
  });

  it("works for a Beat that predates cycles", () => {
    // `cyclesOf` computes the implicit single cycle (CY11) — nothing written.
    const opts = statusFilterOptions({ statuses: [{ id: "a", label: "Backlog", color: "#000" }] });
    expect(opts.map((o) => o.name)).toEqual(["Backlog"]);
    expect(opts[0].group).toBeUndefined();
  });
});

describe("bucketing the list for render", () => {
  it("keeps groups in order and Done at the end", () => {
    const buckets = groupOptions(statusFilterOptions({ cycles: [std, rev] }));
    expect(buckets.map((b) => b.group)).toEqual([DIGITAL, PHYSICAL, undefined]);
    expect(buckets[2].options.map((o) => o.id)).toEqual(["done"]);
  });

  it("does not hoist an ungrouped entry out of position", () => {
    // Done is ungrouped and last. Collecting all ungrouped entries first would
    // put it above the cycles, where it reads as a heading for them.
    const buckets = groupOptions([
      { id: "a", name: "A", group: "G1" },
      { id: "z", name: "Z" },
      { id: "b", name: "B", group: "G2" },
    ]);
    expect(buckets.map((b) => b.group)).toEqual(["G1", undefined, "G2"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupOptions([])).toEqual([]);
  });

  it("does not merge a group that appears twice apart", () => {
    // Buckets are cut where the heading changes, not gathered by name. Merging
    // would move the second G1 entry up above B, silently reordering a list the
    // caller built deliberately — and the order here IS the meaning: it is what
    // puts Done last.
    //
    // `statusFilterOptions` never emits a split group, so nothing in the app
    // reaches this. It is pinned because `groupOptions` is exported and general,
    // and a gather-by-name rewrite passes every other test in this file.
    const buckets = groupOptions([
      { id: "a", name: "A", group: "G1" },
      { id: "b", name: "B", group: "G2" },
      { id: "c", name: "C", group: "G1" },
    ]);
    expect(buckets.map((b) => b.group)).toEqual(["G1", "G2", "G1"]);
    expect(buckets.map((b) => b.options.map((o) => o.id))).toEqual([["a"], ["b"], ["c"]]);
  });
});
