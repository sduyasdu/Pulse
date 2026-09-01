import { describe, expect, it } from "vitest";
import { OVERLAP_GAP_PX, resolveOverlaps, type Placeable } from "./overlap";

const H = 40;
const heightOf = () => H;

const task = (id: string, x: number, duration: number, y: number, epicId: string | null = "e1"): Placeable =>
  ({ id, x, duration, y, epicId });

/** Convenience: the resulting y for one id, or undefined if it did not move. */
const yOf = (moves: { id: string; y: number }[], id: string) => moves.find((m) => m.id === id)?.y;

describe("nothing in the way", () => {
  it("moves nothing when the tasks do not overlap in time", () => {
    const fs = [task("a", 0, 5, 100), task("b", 20, 5, 100)];
    expect(resolveOverlaps(fs, "a", heightOf)).toEqual([]);
  });

  it("moves nothing when they share time but sit on different rows", () => {
    const fs = [task("a", 0, 10, 100), task("b", 0, 10, 200)];
    expect(resolveOverlaps(fs, "a", heightOf)).toEqual([]);
  });

  it("moves nothing when the moved task is alone", () => {
    expect(resolveOverlaps([task("a", 0, 10, 100)], "a", heightOf)).toEqual([]);
  });

  it("moves nothing for an id that is not there", () => {
    expect(resolveOverlaps([task("a", 0, 10, 100)], "ghost", heightOf)).toEqual([]);
  });

  // Touching end-to-start is not overlapping: a task ending on day 10 and one
  // starting on day 10 occupy no common day.
  it("treats abutting tasks as clear", () => {
    const fs = [task("a", 0, 10, 100), task("b", 10, 5, 100)];
    expect(resolveOverlaps(fs, "a", heightOf)).toEqual([]);
  });
});

describe("pushing a neighbour out of the way", () => {
  // The reported case: a task is lengthened until it covers the next one.
  it("pushes down a task the moved one now covers", () => {
    const fs = [task("a", 0, 20, 100), task("b", 5, 5, 110)];
    expect(resolveOverlaps(fs, "a", heightOf)).toEqual([{ id: "b", y: 100 + H + OVERLAP_GAP_PX }]);
  });

  it("leaves a gap rather than stacking flush", () => {
    const fs = [task("a", 0, 20, 100), task("b", 5, 5, 110)];
    expect(yOf(resolveOverlaps(fs, "a", heightOf), "b")).toBe(152);
  });

  it("never moves the task that was just dragged", () => {
    const fs = [task("a", 0, 20, 100), task("b", 5, 5, 110)];
    expect(resolveOverlaps(fs, "a", heightOf).some((m) => m.id === "a")).toBe(false);
  });

  // Pushing up would move rows the person is not looking at, and can walk
  // content off the top of the canvas.
  it("only ever pushes downwards", () => {
    const fs = [task("a", 0, 20, 200), task("b", 5, 5, 190)];
    const y = yOf(resolveOverlaps(fs, "a", heightOf), "b");
    expect(y).toBeGreaterThan(200);
  });

  it("pushes several overlapping neighbours", () => {
    const fs = [task("a", 0, 30, 100), task("b", 2, 4, 105), task("c", 8, 4, 115)];
    const moves = resolveOverlaps(fs, "a", heightOf);
    expect(moves.map((m) => m.id).sort()).toEqual(["b", "c"]);
    for (const m of moves) expect(m.y).toBeGreaterThanOrEqual(152);
  });
});

describe("cascading", () => {
  // A pushed task lands on the next one down, which must move in turn.
  it("carries the push down a stack", () => {
    const fs = [task("a", 0, 30, 100), task("b", 0, 30, 110), task("c", 0, 30, 160)];
    const moves = resolveOverlaps(fs, "a", heightOf);
    const yb = yOf(moves, "b") as number;
    const yc = yOf(moves, "c") as number;
    expect(yb).toBe(152);
    // c must clear b's NEW position, not its old one.
    expect(yc).toBeGreaterThanOrEqual(yb + H);
  });

  it("leaves no pair overlapping when it is done", () => {
    const fs = [task("a", 0, 30, 100), task("b", 0, 30, 105), task("c", 0, 30, 112), task("d", 0, 30, 120)];
    const moves = resolveOverlaps(fs, "a", heightOf);
    const finalY = new Map(fs.map((f) => [f.id, f.y]));
    for (const m of moves) finalY.set(m.id, m.y);
    const boxes = fs.map((f) => ({ id: f.id, top: finalY.get(f.id) as number }));
    for (const p of boxes) {
      for (const q of boxes) {
        if (p.id >= q.id) continue;
        const clear = p.top + H <= q.top || q.top + H <= p.top;
        expect(clear, `${p.id}@${p.top} overlaps ${q.id}@${q.top}`).toBe(true);
      }
    }
  });

  it("terminates on a large pile-up", () => {
    const fs = Array.from({ length: 40 }, (_, i) => task(`t${i}`, 0, 30, 100 + i));
    const moves = resolveOverlaps(fs, "t0", heightOf);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => Number.isFinite(m.y))).toBe(true);
  });
});

describe("sections", () => {
  // Epics are the canvas's sections. Shoving another epic's rows because
  // something grew in this one would be action at a distance.
  it("does not disturb tasks in another epic", () => {
    const fs = [task("a", 0, 20, 100, "e1"), task("b", 5, 5, 110, "e2")];
    expect(resolveOverlaps(fs, "a", heightOf)).toEqual([]);
  });

  it("treats loose tasks as their own section", () => {
    const fs = [task("a", 0, 20, 100, null), task("b", 5, 5, 110, null), task("c", 5, 5, 110, "e1")];
    const moves = resolveOverlaps(fs, "a", heightOf);
    expect(moves.map((m) => m.id)).toEqual(["b"]);
  });

  it("does not let a loose task displace an epic's tasks", () => {
    const fs = [task("a", 0, 20, 100, null), task("b", 5, 5, 110, "e1")];
    expect(resolveOverlaps(fs, "a", heightOf)).toEqual([]);
  });
});

describe("varying heights", () => {
  // Boxes are not uniform — height comes from effort — so the push has to clear
  // the actual box, not an assumed one.
  it("clears a tall anchor", () => {
    const tall = { a: 120, b: 40 } as Record<string, number>;
    const fs = [task("a", 0, 20, 100), task("b", 5, 5, 130)];
    const moves = resolveOverlaps(fs, "a", (f) => tall[f.id]);
    expect(yOf(moves, "b")).toBe(100 + 120 + OVERLAP_GAP_PX);
  });
});
