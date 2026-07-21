import { describe, expect, it } from "vitest";
import {
  allocSum,
  assignedEffort,
  boxHeight,
  durationForAssignedResources,
  elapsedOf,
  estimateEffort,
  graphEffort,
  isEstimateLocked,
  staffingLevel,
  theoreticalElapsed,
  workOf,
} from "./graphEffort";
import { DEFAULT_GRAPH_CONFIG } from "@/types";

// x=0 is a Wednesday (see dateUtils.test.ts); a 7-day span from day 0
// contains exactly one weekend (Sat/Sun), i.e. 5 working days.
const graph = DEFAULT_GRAPH_CONFIG; // { stepPx: 16, workPerStep: 1 }

describe("workOf", () => {
  it("defaults to 1 when neither work nor effort is set", () => {
    expect(workOf({}, graph)).toBe(1);
  });

  it("falls back to legacy `effort` when `work` is unset", () => {
    expect(workOf({ effort: 3 }, graph)).toBe(3);
  });

  it("prefers `work` over `effort` when both are set", () => {
    expect(workOf({ work: 5, effort: 3 }, graph)).toBe(5);
  });

  it("snaps to whole steps and floors at workPerStep", () => {
    expect(workOf({ work: 0 }, graph)).toBe(1);
    expect(workOf({ work: 2.4 }, graph)).toBe(2);
  });

  it("respects a non-1 workPerStep", () => {
    const g = { stepPx: 16, workPerStep: 5 };
    expect(workOf({ work: 12 }, g)).toBe(10); // round(12/5)*5 = 2*5
    expect(workOf({ work: 1 }, g)).toBe(5); // floored to workPerStep
  });
});

describe("boxHeight", () => {
  it("computes body height from work steps", () => {
    // work=2 -> steps=2 -> bodyHeight=18+2*16=50 -> total=30+50=80
    expect(boxHeight({ work: 2 }, graph)).toBe(80);
  });

  it("clamps steps at 24", () => {
    // work=100 -> steps clamped to 24 -> bodyHeight=18+24*16=402 -> total=432
    expect(boxHeight({ work: 100 }, graph)).toBe(432);
  });

  it("switches to the subtask-list height when expanded", () => {
    const children = [
      { id: "c1", title: "a", status: "planned" as const, resources: [], effort: 1 },
      { id: "c2", title: "b", status: "planned" as const, resources: [], effort: 1 },
    ];
    expect(boxHeight({ work: 2, children, collapsed: false }, graph)).toBe(30 + 2 * 27 + 10);
  });

  it("ignores children height while collapsed", () => {
    const children = [{ id: "c1", title: "a", status: "planned" as const, resources: [], effort: 1 }];
    expect(boxHeight({ work: 2, children, collapsed: true }, graph)).toBe(80);
  });
});

describe("elapsedOf", () => {
  it("excludes weekends by default", () => {
    expect(elapsedOf({ x: 0, duration: 7 })).toBe(5);
  });

  it("counts every calendar day when useWeekends is set", () => {
    expect(elapsedOf({ x: 0, duration: 7, useWeekends: true })).toBe(7);
  });
});

describe("graphEffort / estimateEffort", () => {
  const base = { x: 0, duration: 7, work: 2 }; // elapsed=5, work=2 -> graphEffort=10

  it("Graph Effort = elapsed x work", () => {
    expect(graphEffort(base, graph)).toBe(10);
  });

  it("Estimate Effort tracks Graph Effort when not locked", () => {
    expect(isEstimateLocked({ estEffort: null })).toBe(false);
    expect(estimateEffort({ ...base, estEffort: null }, graph)).toBe(10);
  });

  it("Estimate Effort uses the manual override once locked", () => {
    expect(isEstimateLocked({ estEffort: 8 })).toBe(true);
    expect(estimateEffort({ ...base, estEffort: 8 }, graph)).toBe(8);
  });
});

describe("allocSum / assignedEffort", () => {
  it("sums resource % allocation as a fraction", () => {
    expect(allocSum({ resources: ["A", "B"], alloc: { A: 100, B: 50 } })).toBe(1.5);
  });

  it("defaults an assigned resource with no explicit alloc to 100%", () => {
    expect(allocSum({ resources: ["A"] })).toBe(1);
  });

  it("ignores subtask assignments (subtasks are responsibility markers, not load)", () => {
    const feature = {
      resources: ["A"],
      alloc: { A: 50 },
      children: [
        { id: "c1", title: "a", status: "planned" as const, resources: ["B"], alloc: { B: 80 } },
        { id: "c2", title: "b", status: "planned" as const, resources: ["C"] },
      ],
    };
    expect(allocSum(feature)).toBeCloseTo(0.5); // only the task-level A@50%
  });

  it("Assigned Effort = elapsed x sum of allocations", () => {
    expect(assignedEffort({ x: 0, duration: 7, resources: ["A", "B"], alloc: { A: 100, B: 50 } })).toBe(7.5);
  });
});

describe("theoreticalElapsed", () => {
  const base = { x: 0, duration: 7, work: 2, estEffort: 8 };

  it("is null when nobody is assigned", () => {
    expect(theoreticalElapsed({ ...base, resources: [] }, graph)).toBeNull();
  });

  it("divides Estimate Effort by total allocation", () => {
    // estEffort=8, allocSum=1.5 -> 8/1.5 = 5.333... -> rounds to 5.3
    expect(theoreticalElapsed({ ...base, resources: ["A", "B"], alloc: { A: 100, B: 50 } }, graph)).toBe(5.3);
  });
});

describe("staffingLevel", () => {
  const base = { x: 0, duration: 7, work: 2, estEffort: 8 }; // planned = 8

  it("is exactly-on-plan at the tolerance boundary (not under)", () => {
    // assigned=7.5 -> gap=-0.5, tol=max(0.5, 8*0.05=0.4)=0.5 -> gap == -tol, not < -tol
    expect(staffingLevel({ ...base, resources: ["A", "B"], alloc: { A: 100, B: 50 } }, graph)).toBe("right");
  });

  it("flags clearly under-staffed work", () => {
    expect(staffingLevel({ ...base, resources: ["A"], alloc: { A: 50 } }, graph)).toBe("under");
  });

  it("flags clearly over-staffed work", () => {
    expect(
      staffingLevel({ ...base, resources: ["A", "B", "C"], alloc: { A: 100, B: 100, C: 100 } }, graph),
    ).toBe("over");
  });

  it("floors the tolerance at 0.5 man-days for tiny estimates", () => {
    // planned=1 -> 5% tolerance would be 0.05, but floors to 0.5
    const tiny = { x: 0, duration: 1, work: 1, estEffort: 1 };
    // assigned effort for 1 working day at 100% = 1 -> gap=0 -> right regardless
    expect(staffingLevel({ ...tiny, resources: ["A"] }, graph)).toBe("right");
  });
});

describe("durationForAssignedResources", () => {
  const base = { x: 0, duration: 7, work: 2, estEffort: 8 };

  it("is null when nobody is assigned", () => {
    expect(durationForAssignedResources({ ...base, resources: [] }, graph)).toBeNull();
  });

  it("returns the calendar span needed to deliver Estimate Effort at the current staffing", () => {
    // wd = round(8 / 1.5) = 5 working days -> businessToSpan(0, 5, false) = 7
    expect(durationForAssignedResources({ ...base, resources: ["A", "B"], alloc: { A: 100, B: 50 } }, graph)).toBe(7);
  });
});
