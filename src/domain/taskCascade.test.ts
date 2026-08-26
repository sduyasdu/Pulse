import { describe, expect, it } from "vitest";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import {
  CASCADE_STEP_DAYS,
  cascadeOffsetFor,
  cascadeStepPx,
  lowestFreeSlot,
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

  // A new task is 30 + 18 + one step tall, so the vertical step clears it
  // completely rather than merely offsetting it — the point is that both stay
  // fully visible, not that the second one peeks out.
  it("steps down by more than a new task's full height", () => {
    const newTaskHeight = 30 + 18 + graph.stepPx;
    expect(cascadeStepPx(graph)).toBeGreaterThan(newTaskHeight);
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
