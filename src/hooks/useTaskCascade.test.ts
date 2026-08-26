import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import { cascadeStepPx, type CascadeFeature } from "@/domain/taskCascade";
import { useTaskCascade } from "./useTaskCascade";

const graph = DEFAULT_GRAPH_CONFIG;
const STEP = cascadeStepPx(graph);

/** Add a task the way CanvasView does: ask for a placement, create it, claim it. */
function add(result: { current: ReturnType<typeof useTaskCascade> }, id: string, baseY: number) {
  const { slot, dx, y } = result.current.nextPlacement(baseY);
  act(() => result.current.claim(id, slot, { x: 100 + dx, y, duration: 8, work: 1 }));
  return { slot, dx, y };
}

describe("stacking successive new tasks", () => {
  it("puts the first one where the viewport says", () => {
    const { result } = renderHook(() => useTaskCascade([] as CascadeFeature[], graph));
    expect(add(result, "a", 500)).toMatchObject({ slot: 0, dx: 0, y: 500 });
  });

  it("steps the next ones down and right", () => {
    const { result } = renderHook(() => useTaskCascade([] as CascadeFeature[], graph));
    add(result, "a", 500);
    expect(add(result, "b", 500)).toMatchObject({ slot: 1, dx: 1, y: 500 + STEP });
    expect(add(result, "c", 500)).toMatchObject({ slot: 2, dx: 2, y: 500 + 2 * STEP });
  });

  // The reason the origin is held rather than recomputed. Adding a task deep in
  // the cascade scrolls the canvas to reveal it, which moves the viewport
  // middle — so a recomputed origin would walk the stack down the canvas and
  // could drop a later task straight onto an earlier one.
  it("holds its origin when the viewport moves between adds", () => {
    const { result } = renderHook(() => useTaskCascade([] as CascadeFeature[], graph));
    add(result, "a", 500);
    expect(add(result, "b", 820).y).toBe(500 + STEP);
    expect(add(result, "c", 60).y).toBe(500 + 2 * STEP);
  });

  it("re-anchors at the current viewport once the run is fully dispersed", () => {
    const live: CascadeFeature[] = [];
    const { result, rerender } = renderHook(({ f }) => useTaskCascade(f, graph), { initialProps: { f: live } });
    const first = add(result, "a", 500);

    // The task shows up, then the user drags it somewhere deliberate.
    rerender({ f: [{ id: "a", x: 100, y: first.y, duration: 8, work: 1 }] });
    rerender({ f: [{ id: "a", x: 300, y: 2000, duration: 8, work: 1 }] });

    expect(add(result, "b", 900)).toMatchObject({ slot: 0, y: 900 });
  });

  it("gives the vacated slot to the next task, at the same place", () => {
    const live: CascadeFeature[] = [];
    const { result, rerender } = renderHook(({ f }) => useTaskCascade(f, graph), { initialProps: { f: live } });
    const a = add(result, "a", 500);
    const b = add(result, "b", 500);

    // Both arrive; then 'b' — the last one — gets stretched.
    const seen = [
      { id: "a", x: 100, y: a.y, duration: 8, work: 1 },
      { id: "b", x: 101, y: b.y, duration: 8, work: 1 },
    ];
    rerender({ f: seen });
    rerender({ f: [seen[0], { ...seen[1], duration: 30 }] });

    // Slot 1 is free again, and it is the same spot 'b' was created in.
    expect(add(result, "c", 500)).toMatchObject({ slot: 1, y: b.y });
  });

  it("does not free a slot for a task that has not arrived yet", () => {
    const { result, rerender } = renderHook(({ f }) => useTaskCascade(f, graph), {
      initialProps: { f: [] as CascadeFeature[] },
    });
    add(result, "a", 500);
    rerender({ f: [] }); // subscription hasn't delivered it
    expect(add(result, "b", 500).slot).toBe(1);
  });
});
