import { describe, expect, it } from "vitest";
import { allocInRange, assignmentsFor, resourcePeakPct, utilizationPct } from "./assignments";
import type { Feature } from "@/types";

function feature(over: Partial<Feature>): Feature {
  return { id: "f1", title: "F", x: 0, y: 0, duration: 5, status: "planned", resources: [], ...over };
}

describe("assignmentsFor", () => {
  it("includes task-level assignments but excludes subtask responsibility markers", () => {
    const features = [
      feature({ id: "f1", title: "Parent", x: 2, duration: 5, resources: ["A"], alloc: { A: 60 } }),
      feature({
        id: "f2",
        title: "Other",
        x: 10,
        duration: 3,
        resources: [],
        children: [{ id: "c1", title: "Sub", status: "planned", resources: ["A"], alloc: { A: 40 } }],
      }),
    ];
    const rows = assignmentsFor(features, "A");
    // Only the task-level assignment on f1 — the subtask on f2 doesn't count.
    expect(rows).toEqual([{ title: "Parent", start: 2, duration: 5, status: "planned", pct: 60 }]);
  });
});

describe("resourcePeakPct / utilizationPct", () => {
  it("finds the busiest overlapping day across assignments", () => {
    const features = [
      feature({ id: "f1", x: 0, duration: 5, resources: ["A"], alloc: { A: 60 } }),
      feature({ id: "f2", x: 2, duration: 3, resources: ["A"], alloc: { A: 50 } }), // overlaps days 2-4 -> 110%
    ];
    expect(resourcePeakPct(features, "A")).toBe(110);
    expect(utilizationPct(features, { id: "A", capacity: 100 })).toBe(110);
    expect(utilizationPct(features, { id: "A", capacity: 200 })).toBe(55);
  });

  it("is 0 for an unassigned resource", () => {
    expect(resourcePeakPct([feature({})], "nobody")).toBe(0);
  });
});

describe("allocInRange", () => {
  it("averages allocation over a period, treating non-working days as 0%", () => {
    const features = [feature({ id: "f1", x: 0, duration: 2, resources: ["A"], alloc: { A: 100 } })];
    // 2 working days at 100% + 3 idle days across a 5-day period -> (200)/5 = 40
    expect(allocInRange(features, "A", 0, 5)).toBe(40);
  });
});
