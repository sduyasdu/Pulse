import { describe, expect, it } from "vitest";
import { flipDeltas, REORDER_MS } from "./useReorderAnimation";

const m = (o: Record<string, number>) => new Map(Object.entries(o));

describe("the inverse step of a FLIP reorder", () => {
  // Positive delta = the row moved DOWN, so it is put back up by that much for
  // a frame and released.
  it("returns how far a row must be put back to appear where it was", () => {
    expect(flipDeltas(m({ a: 0, b: 60 }), m({ a: 60, b: 0 }))).toEqual(m({ a: -60, b: 60 }));
  });

  it("ignores rows that did not move", () => {
    expect(flipDeltas(m({ a: 0, b: 60 }), m({ a: 0, b: 60 }))).toEqual(new Map());
  });

  it("reports only the rows that moved", () => {
    const out = flipDeltas(m({ a: 0, b: 60, c: 120 }), m({ a: 0, b: 120, c: 60 }));
    expect([...out.keys()].sort()).toEqual(["b", "c"]);
  });

  // A row that was not there before was just added. Animating it from zero
  // would fly it in from the top of the viewport, which is a different effect
  // from a row moving within a list it was already in.
  it("skips a row that is newly present", () => {
    expect(flipDeltas(m({ a: 0 }), m({ a: 0, brandNew: 60 }))).toEqual(new Map());
  });

  it("skips a row that has gone", () => {
    expect(flipDeltas(m({ a: 0, gone: 60 }), m({ a: 0 }))).toEqual(new Map());
  });

  it("handles the first measurement, when nothing was known", () => {
    expect(flipDeltas(new Map(), m({ a: 0, b: 60 }))).toEqual(new Map());
  });

  it("handles an empty list", () => {
    expect(flipDeltas(m({ a: 0 }), new Map())).toEqual(new Map());
  });

  // The case this exists for: an epic leaves the staging area at the top and
  // drops to its place among the settled ones, pushing those above it up.
  it("describes an epic leaving the top of the list", () => {
    const before = m({ neu: 0, a: 60, b: 120 });
    const after = m({ a: 0, b: 60, neu: 120 });
    expect(flipDeltas(before, after)).toEqual(m({ neu: -120, a: 60, b: 60 }));
  });
});

describe("the duration", () => {
  it("is long enough to follow and short enough not to wait for", () => {
    expect(REORDER_MS).toBeGreaterThanOrEqual(150);
    expect(REORDER_MS).toBeLessThanOrEqual(400);
  });
});
