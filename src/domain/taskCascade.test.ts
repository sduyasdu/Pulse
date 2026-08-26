import { describe, expect, it } from "vitest";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import {
  CASCADE_STEP_DAYS,
  CASCADE_VISIBLE_FRACTION,
  cascadeOffsetFor,
  cascadeStepPx,
  newTaskHeightPx,
  lowestFreeSlot,
  orderForPainting,
  reconcileClaims,
  type CascadeClaim,
  type CascadeFeature,
} from "./taskCascade";

const graph = DEFAULT_GRAPH_CONFIG; // { stepPx: 16, workPerStep: 1 }

const claim = (over: Partial<CascadeClaim> = {}): CascadeClaim => ({
  id: "f1", slot: 0, x: 100, y: 200, duration: 8, work: 1, seen: true, ...over,
});

const feat = (over: Partial<CascadeFeature> = {}): CascadeFeature => ({
  id: "f1", x: 100, y: 200, duration: 8, work: 1, ...over,
});

describe("where the next new task goes", () => {
  it("puts the first one exactly where it would have gone anyway", () => {
    expect(cascadeOffsetFor(0, graph)).toEqual({ dx: 0, dy: 0 });
  });

  it("steps each subsequent one right and down", () => {
    const step = cascadeStepPx(graph);
    expect(cascadeOffsetFor(1, graph)).toEqual({ dx: CASCADE_STEP_DAYS, dy: step });
    expect(cascadeOffsetFor(3, graph)).toEqual({ dx: 3 * CASCADE_STEP_DAYS, dy: 3 * step });
  });

  // Overlapping on purpose: a full-height step walks off the bottom of the
  // viewport after three or four adds. The next task covers the previous one's
  // bottom fifth and no more.
  it("leaves four fifths of the previous task showing", () => {
    const h = newTaskHeightPx(graph);
    // Stated as the property, not as the formula — asserting
    // round(h * FRACTION) against round(h * FRACTION) would pass for any
    // fraction at all, including the full-clearance one this replaced.
    const overlap = h - cascadeStepPx(graph);
    expect(overlap / h).toBeCloseTo(1 - CASCADE_VISIBLE_FRACTION, 2);
    expect(overlap).toBe(13); // 20% of a 64px box, at the default row height
  });

  // The part that must never be covered. A box's header is its top 30px — the
  // title, the status dot, the attachment and lock icons — so the step has to
  // clear it or a stacked task becomes unidentifiable.
  it("never covers the previous task's header", () => {
    for (const stepPx of [8, 16, 24, 40]) {
      expect(cascadeStepPx({ stepPx, workPerStep: 1 })).toBeGreaterThan(30);
    }
  });

  it("still steps down by less than a full task, so a run stays on screen", () => {
    expect(cascadeStepPx(graph)).toBeLessThan(newTaskHeightPx(graph));
  });

  it("scales the step with the Pulse's own row height", () => {
    expect(cascadeStepPx({ stepPx: 40, workPerStep: 1 })).toBeGreaterThan(cascadeStepPx(graph));
  });
});

describe("which slot is next", () => {
  it("starts at zero", () => {
    expect(lowestFreeSlot([])).toBe(0);
  });

  it("takes the one after the last while tasks are left where they fell", () => {
    expect(lowestFreeSlot([claim({ id: "a", slot: 0 }), claim({ id: "b", slot: 1 })])).toBe(2);
  });

  // The behaviour that stops the cascade running away: a released slot is
  // refilled before the cascade extends any further.
  it("refills a gap rather than extending", () => {
    expect(lowestFreeSlot([claim({ id: "a", slot: 0 }), claim({ id: "c", slot: 2 })])).toBe(1);
  });

  it("goes back to the previous position when the last task is placed", () => {
    const held = [claim({ id: "a", slot: 0 }), claim({ id: "b", slot: 1 }), claim({ id: "c", slot: 2 })];
    expect(lowestFreeSlot(held)).toBe(3);
    // 'c' gets moved, so its claim is gone and the next add takes 2 back.
    expect(lowestFreeSlot(held.filter((h) => h.id !== "c"))).toBe(2);
  });
});

describe("what releases a slot", () => {
  it("keeps an untouched new task's claim", () => {
    expect(reconcileClaims([claim()], [feat()])).toHaveLength(1);
  });

  it("releases one that was moved horizontally — a deliberate date", () => {
    expect(reconcileClaims([claim()], [feat({ x: 140 })])).toEqual([]);
  });

  it("releases one that was moved vertically", () => {
    expect(reconcileClaims([claim()], [feat({ y: 900 })])).toEqual([]);
  });

  it("releases one that was stretched longer", () => {
    expect(reconcileClaims([claim()], [feat({ duration: 20 })])).toEqual([]);
  });

  it("releases one whose effort was raised — the other way a box is 'extended'", () => {
    expect(reconcileClaims([claim()], [feat({ work: 6 })])).toEqual([]);
  });

  it("releases one that was deleted", () => {
    expect(reconcileClaims([claim({ seen: true })], [])).toEqual([]);
  });

  // The race the `seen` flag exists for: the claim is recorded the instant the
  // write resolves, which can be a render before the subscription delivers the
  // task. Treating that gap as a deletion would free the slot the task is about
  // to land in, and the next add would sit on top of it — the original bug.
  it("keeps a claim for a task that has not arrived yet", () => {
    const out = reconcileClaims([claim({ seen: false })], []);
    expect(out).toHaveLength(1);
    expect(out[0].seen).toBe(false);
  });

  it("marks a claim seen once the task shows up", () => {
    expect(reconcileClaims([claim({ seen: false })], [feat()])[0].seen).toBe(true);
  });

  it("returns the identical claim object when nothing changed, so the canvas doesn't re-render", () => {
    const c = claim();
    expect(reconcileClaims([c], [feat()])[0]).toBe(c);
  });

  it("handles a mix, releasing only the ones that moved", () => {
    const claims = [claim({ id: "a", slot: 0 }), claim({ id: "b", slot: 1, y: 300 }), claim({ id: "c", slot: 2, y: 400 })];
    const features = [feat({ id: "a" }), feat({ id: "b", y: 999 }), feat({ id: "c", y: 400 })];
    expect(reconcileClaims(claims, features).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("tolerates a feature with no duration or work rather than treating it as untouched", () => {
    expect(reconcileClaims([claim()], [{ id: "f1", x: 100, y: 200 }])).toEqual([]);
  });
});

describe("paint order", () => {
  const f = (id: string) => ({ id });
  const slots = (pairs: [string, number][]) => new Map(pairs);

  it("leaves the list alone when no cascade is in progress", () => {
    const list = [f("a"), f("b")];
    expect(orderForPainting(list, slots([]))).toBe(list);
  });

  // The reported bug: features arrive in document-id order, so a new task could
  // sort before tasks that predate it and get painted underneath them.
  it("moves cascade tasks to the end, however the store ordered them", () => {
    const list = [f("new1"), f("old-a"), f("new2"), f("old-b")];
    const out = orderForPainting(list, slots([["new1", 0], ["new2", 1]]));
    expect(out.map((x) => x.id)).toEqual(["old-a", "old-b", "new1", "new2"]);
  });

  // Slot order, not arrival order and not reverse: each new task has to cover
  // the one before it, which is the direction the 20% overlap was sized for.
  it("orders the stack by slot so each covers the previous", () => {
    const list = [f("s2"), f("s0"), f("s1")];
    const out = orderForPainting(list, slots([["s0", 0], ["s1", 1], ["s2", 2]]));
    expect(out.map((x) => x.id)).toEqual(["s0", "s1", "s2"]);
  });

  it("keeps the ordinary tasks in the order they arrived", () => {
    const list = [f("a"), f("n"), f("b"), f("c")];
    const out = orderForPainting(list, slots([["n", 0]]));
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c", "n"]);
  });

  it("ignores claims for tasks that aren't on screen — filtered out, or gone", () => {
    const list = [f("a"), f("b")];
    expect(orderForPainting(list, slots([["ghost", 0]]))).toBe(list);
  });

  it("does not mutate the array it was given", () => {
    const list = [f("new1"), f("old")];
    const copy = [...list];
    orderForPainting(list, slots([["new1", 0]]));
    expect(list).toEqual(copy);
  });

  it("puts a task that resumed a freed slot back in that slot's place", () => {
    const list = [f("a"), f("resumed"), f("c")];
    const out = orderForPainting(list, slots([["a", 0], ["resumed", 1], ["c", 2]]));
    expect(out.map((x) => x.id)).toEqual(["a", "resumed", "c"]);
  });
});
