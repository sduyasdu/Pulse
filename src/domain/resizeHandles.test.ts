import { describe, expect, it } from "vitest";
import {
  MIN_CORE_PX,
  MIN_HANDLE_PX,
  RESIZE_EDGE_COARSE_PX,
  RESIZE_EDGE_PX,
  RESIZE_EFFORT_COARSE_PX,
  RESIZE_EFFORT_PX,
  RESIZE_OUTSIDE_PX,
  resizeHandleSizes,
} from "./resizeHandles";

/** Large enough that the core reservation cannot bite even at the lowest zoom,
 * so these cases test the screen-size conversion alone. */
const BIG = { width: 1200, height: 600 };
const sizes = (over: Partial<Parameters<typeof resizeHandleSizes>[0]> = {}) =>
  resizeHandleSizes({ ...BIG, viewZoom: 1, coarse: false, ...over });

/** What a handle actually measures on screen at a given zoom. */
const onScreen = (canvasPx: number, viewZoom: number) => canvasPx * viewZoom;

/**
 * A task at the default week density: 26px/day × 0.42 ≈ 10.9, so a five-day
 * task is about 55px wide. This is the everyday case, and the one that was
 * still too thin after the first attempt.
 */
const TYPICAL = { width: 55, height: 64 };

describe("handles are sized in screen pixels", () => {
  it("is the stated size at 100%", () => {
    expect(sizes().edge).toBe(RESIZE_EDGE_PX);
    expect(sizes().effort).toBe(RESIZE_EFFORT_PX);
  });

  // A fixed canvas size shrinks with the zoom: 7px became 1.4px at 20%.
  it.each([0.2, 0.5, 1, 1.5, 2])("measures the same on screen at zoom %s", (viewZoom) => {
    const { edge, effort } = sizes({ viewZoom });
    expect(onScreen(edge, viewZoom)).toBeCloseTo(RESIZE_EDGE_PX, 6);
    expect(onScreen(effort, viewZoom)).toBeCloseTo(RESIZE_EFFORT_PX, 6);
  });

  it("grows in canvas units as the view zooms out", () => {
    expect(sizes({ viewZoom: 0.5 }).edge).toBeGreaterThan(sizes({ viewZoom: 1 }).edge);
  });
});

describe("an everyday task box gets a usable target", () => {
  // The reported problem: correct in principle, still too thin to use.
  // Not necessarily the FULL edge — a 55px box cannot give 20px to each side
  // and still keep a 20px core to drag it by, so it gets 17.5. That is the
  // trade working as intended, and still comfortably usable; what matters is
  // that it is nowhere near the 12px (6px of it inside) that prompted this.
  it("gives a five-day task a usable edge", () => {
    const { edge, outside } = resizeHandleSizes({ ...TYPICAL, viewZoom: 1, coarse: false });
    expect(edge).toBeGreaterThanOrEqual(16);
    expect(edge - outside).toBeGreaterThanOrEqual(12);
  });

  it("gives it the full effort strip", () => {
    const { effort } = resizeHandleSizes({ ...TYPICAL, viewZoom: 1, coarse: false });
    expect(effort).toBe(RESIZE_EFFORT_PX);
  });

  // Most of the handle has to be ON the box. Centred on the border, half of it
  // sat over the canvas or over the neighbouring box, which shares its
  // z-index and can take the event.
  it("keeps most of the handle inside the box", () => {
    const { edge, outside } = resizeHandleSizes({ ...TYPICAL, viewZoom: 1, coarse: false });
    expect(edge - outside).toBeGreaterThan(outside);
    expect(outside).toBe(RESIZE_OUTSIDE_PX);
  });

  it("is comfortably bigger than the 12px it replaced", () => {
    expect(RESIZE_EDGE_PX).toBeGreaterThanOrEqual(18);
    expect(RESIZE_EFFORT_PX).toBeGreaterThanOrEqual(20);
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

describe("the box stays movable", () => {
  // Handles that met in the middle would leave a box that can be resized but
  // never moved.
  it("always leaves a core between the two edges", () => {
    for (const width of [34, 40, 55, 80, 200]) {
      const { edge } = resizeHandleSizes({ width, height: 64, viewZoom: 1, coarse: true });
      expect(width - 2 * edge, `width ${width}`).toBeGreaterThanOrEqual(MIN_CORE_PX - 0.001);
    }
  });

  it("always leaves a core above the effort strip", () => {
    for (const height of [34, 48, 64, 120]) {
      const { effort } = resizeHandleSizes({ width: 200, height, viewZoom: 1, coarse: true });
      expect(height - effort, `height ${height}`).toBeGreaterThanOrEqual(MIN_CORE_PX - 0.001);
    }
  });

  // A constant core, not a share of the box: a share makes the target depend on
  // the box rather than on the hand, which is the same mistake as sizing in
  // canvas pixels.
  it("does not shrink the handle on a box that can afford it", () => {
    expect(resizeHandleSizes({ width: 80, height: 64, viewZoom: 1, coarse: false }).edge).toBe(RESIZE_EDGE_PX);
    expect(resizeHandleSizes({ width: 400, height: 300, viewZoom: 1, coarse: false }).edge).toBe(RESIZE_EDGE_PX);
  });

  it("shrinks the handle rather than the core on a cramped box", () => {
    const { edge } = resizeHandleSizes({ width: 34, height: 64, viewZoom: 1, coarse: true });
    expect(edge).toBeLessThan(RESIZE_EDGE_COARSE_PX);
    expect(edge).toBeCloseTo((34 - MIN_CORE_PX) / 2, 6);
  });
});

describe("degenerate input cannot produce an unusable canvas", () => {
  // A zero zoom divides into Infinity, which would blanket the canvas in
  // invisible handles and make every click a resize.
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("survives a zoom of %s", (viewZoom) => {
    const { edge, effort, outside } = sizes({ viewZoom: viewZoom as number });
    for (const v of [edge, effort, outside]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("never vanishes, however cramped the box", () => {
    const { edge, effort } = resizeHandleSizes({ width: 1, height: 1, viewZoom: 1, coarse: true });
    expect(edge).toBe(MIN_HANDLE_PX);
    expect(effort).toBe(MIN_HANDLE_PX);
  });

  it("keeps some of even a minimum handle inside the box", () => {
    const { edge, outside } = resizeHandleSizes({ width: 1, height: 1, viewZoom: 1, coarse: true });
    expect(outside).toBeLessThanOrEqual(edge / 2);
    expect(edge - outside).toBeGreaterThan(0);
  });
});
