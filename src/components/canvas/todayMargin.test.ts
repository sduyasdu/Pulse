import { describe, expect, it } from "vitest";
import { TODAY_LEFT_MARGIN_PX, todayMarginFor } from "./CanvasView";

describe("where today sits on the canvas", () => {
  it("is a third of the width available to the canvas", () => {
    expect(todayMarginFor(960)).toBe(320);
    expect(todayMarginFor(1600)).toBe(533);
  });

  // The panel is 320px open and 30px collapsed, and the scroller's clientWidth
  // already excludes it — so this tracks the panel without being told about it.
  it("moves today right when the left panel is collapsed", () => {
    const open = todayMarginFor(1920 - 320);
    const collapsed = todayMarginFor(1920 - 30);
    expect(collapsed).toBeGreaterThan(open);
  });

  // The fallback is not cosmetic. It is what got used for every centring call
  // while the canvas was unmeasured, which is exactly how today kept landing at
  // 80px after this was supposedly changed — the page's effect fired against a
  // ref that was still null, so the only value ever applied was the fallback.
  it("falls back to the fixed margin when the canvas hasn't been measured", () => {
    expect(todayMarginFor(0)).toBe(TODAY_LEFT_MARGIN_PX);
    expect(todayMarginFor(-1)).toBe(TODAY_LEFT_MARGIN_PX);
  });

  it("never returns a fractional pixel", () => {
    for (const w of [100, 331, 999, 1237]) {
      expect(Number.isInteger(todayMarginFor(w))).toBe(true);
    }
  });

  // A third leaves two thirds of the canvas for what comes next, which is the
  // direction a roadmap is read in, while still showing what led up to now.
  it("leaves twice as much room ahead of today as behind it", () => {
    const w = 1200;
    const margin = todayMarginFor(w);
    expect(w - margin).toBeCloseTo(2 * margin, 0);
  });
});
