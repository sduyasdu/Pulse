import { describe, expect, it } from "vitest";
import {
  MAX_HANDLE_SHARE,
  RESIZE_EDGE_COARSE_PX,
  RESIZE_EDGE_PX,
  RESIZE_EFFORT_COARSE_PX,
  RESIZE_EFFORT_PX,
  resizeHandleSizes,
} from "./resizeHandles";

/** Large enough that the share clamp cannot bite even at the lowest zoom, so
 * these cases test the screen-size conversion alone. */
const BIG = { width: 1200, height: 600 };
const sizes = (over: Partial<Parameters<typeof resizeHandleSizes>[0]> = {}) =>
  resizeHandleSizes({ ...BIG, viewZoom: 1, coarse: false, ...over });

/** What the handle actually measures on screen at a given zoom. */
const onScreen = (canvasPx: number, viewZoom: number) => canvasPx * viewZoom;

describe("handles are sized in screen pixels", () => {
  it("is the stated size at 100%", () => {
    expect(sizes().edge).toBe(RESIZE_EDGE_PX);
    expect(sizes().effort).toBe(RESIZE_EFFORT_PX);
  });

  // The bug: a fixed canvas size shrinks with the zoom, so a 7px handle became
  // 1.4px at 20% — well inside the range the zoom control offers.
  it.each([0.2, 0.5, 1, 1.5, 2])("measures the same on screen at zoom %s", (viewZoom) => {
    const { edge, effort } = sizes({ viewZoom });
    expect(onScreen(edge, viewZoom)).toBeCloseTo(RESIZE_EDGE_PX, 6);
    expect(onScreen(effort, viewZoom)).toBeCloseTo(RESIZE_EFFORT_PX, 6);
  });

  it("grows in canvas units as the view zooms out", () => {
    expect(sizes({ viewZoom: 0.5 }).edge).toBeGreaterThan(sizes({ viewZoom: 1 }).edge);
  });

  it("is bigger than the 7px it replaced, at every zoom", () => {
    for (const viewZoom of [0.2, 0.5, 1, 2]) {
      expect(onScreen(sizes({ viewZoom }).edge, viewZoom)).toBeGreaterThan(7);
    }
  });
});

describe("touch gets a bigger target", () => {
  it("uses the coarse sizes for a finger", () => {
    expect(sizes({ coarse: true }).edge).toBe(RESIZE_EDGE_COARSE_PX);
    expect(sizes({ coarse: true }).effort).toBe(RESIZE_EFFORT_COARSE_PX);
  });

  it("is larger than the mouse target", () => {
    expect(sizes({ coarse: true }).edge).toBeGreaterThan(sizes({ coarse: false }).edge);
    expect(sizes({ coarse: true }).effort).toBeGreaterThan(sizes({ coarse: false }).effort);
  });
});

describe("a handle never swallows its own box", () => {
  // 34px is the narrowest a task box gets. Two 24px edges would leave nothing
  // in the middle: every gesture would resize it and it could never be moved.
  it("leaves room to grab a minimum-width box", () => {
    const { edge } = resizeHandleSizes({ width: 34, height: 40, viewZoom: 1, coarse: true });
    expect(edge * 2).toBeLessThan(34);
  });

  it("caps each handle at its share of the box", () => {
    const { edge } = resizeHandleSizes({ width: 30, height: 200, viewZoom: 1, coarse: true });
    expect(edge).toBeCloseTo(30 * MAX_HANDLE_SHARE, 6);
  });

  it("caps the effort handle against a short box", () => {
    const { effort } = resizeHandleSizes({ width: 400, height: 24, viewZoom: 1, coarse: true });
    expect(effort).toBeCloseTo(24 * MAX_HANDLE_SHARE, 6);
  });

  it("does not clamp a box with room to spare", () => {
    expect(resizeHandleSizes({ width: 400, height: 300, viewZoom: 1, coarse: false }).edge).toBe(RESIZE_EDGE_PX);
  });

  // The two rules interact, and the clamp wins — deliberately. Zoomed far out,
  // a constant on-screen handle would need more canvas pixels than a normal box
  // has to give, and keeping the target at full size there would leave nothing
  // of the box to drag. A smaller handle on a box that is only a few pixels
  // wide on screen is the right trade.
  it("lets the share clamp override the screen size when a box is small", () => {
    const { effort } = resizeHandleSizes({ width: 400, height: 120, viewZoom: 0.2, coarse: false });
    expect(effort).toBeCloseTo(120 * MAX_HANDLE_SHARE, 6);
    expect(onScreen(effort, 0.2)).toBeLessThan(RESIZE_EFFORT_PX);
  });
});

describe("degenerate input cannot produce an unusable canvas", () => {
  // A zero zoom divides into Infinity, which would blanket the canvas in
  // invisible handles and make every click a resize.
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("survives a zoom of %s", (viewZoom) => {
    const { edge, effort } = sizes({ viewZoom: viewZoom as number });
    expect(Number.isFinite(edge)).toBe(true);
    expect(Number.isFinite(effort)).toBe(true);
    expect(edge).toBeGreaterThan(0);
    expect(effort).toBeGreaterThan(0);
  });

  it("still returns something grabbable for a zero-sized box", () => {
    const { edge, effort } = resizeHandleSizes({ width: 0, height: 0, viewZoom: 1, coarse: false });
    expect(edge).toBeGreaterThan(0);
    expect(effort).toBeGreaterThan(0);
  });
});
