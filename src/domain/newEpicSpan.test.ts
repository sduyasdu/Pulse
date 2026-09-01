import { describe, expect, it } from "vitest";
import { NEW_EPIC_LEFT_INSET_PX, NEW_EPIC_SPAN_DAYS, newEpicSpan } from "./layout";

const TODAY = 20000;

describe("where a new epic lands", () => {
  it("starts before the marker line, so the line is inside the band", () => {
    const { minX, maxX } = newEpicSpan(TODAY, 8);
    expect(minX).toBeLessThan(TODAY);
    expect(maxX).toBeGreaterThan(TODAY);
  });

  it("is the default width", () => {
    const { minX, maxX } = newEpicSpan(TODAY, 8);
    expect(maxX - minX).toBe(NEW_EPIC_SPAN_DAYS);
  });

  // The inset is specified in pixels and converted, so "a little to the left"
  // means the same thing to a reader at every zoom. A fixed day count would be
  // an invisible sliver at month density and run off the screen at day density.
  it("keeps the on-screen inset roughly constant across day widths", () => {
    for (const dayWidth of [2, 8, 24, 60]) {
      const { minX } = newEpicSpan(TODAY, dayWidth);
      const insetPx = (TODAY - minX) * dayWidth;
      // Rounding to whole days is the only source of error, so allow one day.
      expect(Math.abs(insetPx - NEW_EPIC_LEFT_INSET_PX)).toBeLessThanOrEqual(dayWidth);
    }
  });

  it("is wide enough to be usable at a narrow day width", () => {
    // 30 days at the narrowest realistic density still has to render a header.
    const { minX, maxX } = newEpicSpan(TODAY, 2);
    expect((maxX - minX) * 2).toBeGreaterThan(40);
  });

  it("follows the marker rather than assuming today", () => {
    const a = newEpicSpan(TODAY, 8);
    const b = newEpicSpan(TODAY + 500, 8);
    expect(b.minX - a.minX).toBe(500);
  });

  // A zero or NaN day width would otherwise divide into a NaN span, which
  // writes a corrupt epic to Firestore rather than failing visibly.
  it.each([0, -4, Number.NaN, Number.POSITIVE_INFINITY])("survives a day width of %s", (dayWidth) => {
    const { minX, maxX } = newEpicSpan(TODAY, dayWidth as number);
    expect(Number.isFinite(minX)).toBe(true);
    expect(Number.isFinite(maxX)).toBe(true);
    expect(maxX).toBeGreaterThan(minX);
  });
});
