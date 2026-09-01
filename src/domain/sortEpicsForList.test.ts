import { describe, expect, it } from "vitest";
import { sortEpicsForList } from "./layout";

const DEFAULT = "New epic";
const C = "#8B5CF6";

interface Band {
  id: string;
  name: string;
  color: string;
  initialColor: string;
  count: number;
  y0: number;
}

/** A settled epic: named, holding work, at a given vertical position. */
const settled = (id: string, y0: number): Band => ({ id, name: id, color: C, initialColor: C, count: 2, y0 });
/** An untouched epic: default name, original colour, no tasks. */
const untouched = (id: string, y0: number): Band => ({ id, name: DEFAULT, color: C, initialColor: C, count: 0, y0 });

const order = (bands: Band[]) => sortEpicsForList(bands, DEFAULT).map((b) => b.id);

describe("the canvas's own order", () => {
  // compactLayout sorts by y0 before packing, so this makes the list read
  // top-to-bottom the way the swimlanes do.
  it("sorts settled epics by y0", () => {
    expect(order([settled("c", 300), settled("a", 100), settled("b", 200)])).toEqual(["a", "b", "c"]);
  });

  it("does not care what order they arrived in", () => {
    const asc = order([settled("a", 100), settled("b", 200)]);
    const desc = order([settled("b", 200), settled("a", 100)]);
    expect(asc).toEqual(desc);
  });

  it("handles an empty list", () => {
    expect(order([])).toEqual([]);
  });
});

describe("untouched epics are staged at the top", () => {
  // A new epic is created at the vertical middle of wherever the reader was
  // looking, so by y0 alone it lands somewhere arbitrary in the list.
  it("puts an untouched epic first even when its y0 is last", () => {
    expect(order([settled("a", 100), settled("b", 200), untouched("new", 900)])).toEqual(["new", "a", "b"]);
  });

  it("puts an untouched epic first even when its y0 is in the middle", () => {
    expect(order([settled("a", 100), untouched("new", 150), settled("b", 200)])).toEqual(["new", "a", "b"]);
  });

  it("keeps several untouched epics in their own y0 order", () => {
    expect(order([untouched("second", 400), settled("a", 100), untouched("first", 200)])).toEqual(["first", "second", "a"]);
  });

  it("leaves the settled ones in y0 order behind them", () => {
    expect(order([settled("c", 300), untouched("n", 50), settled("a", 100), settled("b", 200)])).toEqual(["n", "a", "b", "c"]);
  });
});

// The staging area empties itself — an epic leaves it the moment it is named,
// recoloured or given a task, the same rule that ends its emphasis on the
// canvas. So this is not a permanent reordering.
describe("an epic leaves the top as soon as it is touched", () => {
  it("drops back to its y0 position once named", () => {
    const named: Band = { id: "n", name: "Billing", color: C, initialColor: C, count: 0, y0: 900 };
    expect(order([settled("a", 100), named])).toEqual(["a", "n"]);
  });

  it("drops back once recoloured", () => {
    const recoloured: Band = { id: "n", name: DEFAULT, color: "#EF4444", initialColor: C, count: 0, y0: 900 };
    expect(order([settled("a", 100), recoloured])).toEqual(["a", "n"]);
  });

  it("drops back once it holds a task", () => {
    const filled: Band = { id: "n", name: DEFAULT, color: C, initialColor: C, count: 1, y0: 900 };
    expect(order([settled("a", 100), filled])).toEqual(["a", "n"]);
  });
});

describe("it does not disturb the caller's array", () => {
  // `bands` comes out of a useMemo and is rendered elsewhere; sorting in place
  // would mutate memoised state.
  it("returns a new array and leaves the input alone", () => {
    const input = [settled("c", 300), settled("a", 100)];
    const out = sortEpicsForList(input, DEFAULT);
    expect(out).not.toBe(input);
    expect(input.map((b) => b.id)).toEqual(["c", "a"]);
  });
});
