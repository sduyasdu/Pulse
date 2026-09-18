import { describe, expect, it } from "vitest";
import { stickyLabelShift, stickyLabelWidth } from "./stickyLabel";

/**
 * The property that matters is **continuity**: the label's position is a
 * function of the pan offset, and panning is continuous, so the label may never
 * jump. A threshold ("start sticking once 20px is hidden") would read as the
 * name snapping into place, which is exactly the jitter this is meant to avoid.
 */
const RESERVE = 120;

describe("a box whose start is on screen", () => {
  it("does not move its label", () => {
    // The overwhelming majority of boxes. This case has to cost nothing and
    // look like it always has.
    expect(stickyLabelShift(300, 400, 0, RESERVE)).toBe(0);
  });

  it("does not move it at the exact moment the edge touches the view", () => {
    // The boundary the whole effect hinges on. Off by one here and every box
    // twitches as it crosses the left edge.
    expect(stickyLabelShift(0, 400, 0, RESERVE)).toBe(0);
  });
});

describe("a box that starts off the left", () => {
  it("slides the label by exactly what is hidden", () => {
    // 150px of the box is off screen, so the label sits 150px along it — which
    // puts it at the left edge of the view.
    expect(stickyLabelShift(-150, 400, 0, RESERVE)).toBe(150);
  });

  it("moves one-to-one with the pan", () => {
    // Continuity. Panning 1px must move the label 1px: the label tracks the
    // viewport edge rather than easing towards it, or it lags behind the pan
    // and reads as lag rather than as a label.
    const a = stickyLabelShift(-100, 900, 0, RESERVE);
    const b = stickyLabelShift(-101, 900, 0, RESERVE);
    expect(b - a).toBe(1);
  });

  it("stops before the label would overrun the box", () => {
    // 380 of a 400px box is hidden, but the label needs 120 — so it stops at
    // 280 and leaves with the box rather than being pushed out of its right
    // edge.
    expect(stickyLabelShift(-380, 400, 0, RESERVE)).toBe(280);
  });

  it("holds at the ceiling rather than drifting once it is reached", () => {
    expect(stickyLabelShift(-500, 400, 0, RESERVE)).toBe(280);
    expect(stickyLabelShift(-5000, 400, 0, RESERVE)).toBe(280);
  });

  it("does not move the label at all on a box too narrow to hold one", () => {
    // A 34px box is the canvas minimum. `boxWidth - reserve` is negative there,
    // and sliding by a negative amount would push the name off the box's LEFT
    // edge — the opposite of the point.
    expect(stickyLabelShift(-200, 34, 0, RESERVE)).toBe(0);
  });
});

describe("the view's left edge", () => {
  it("is where the label lands, not the canvas origin", () => {
    // Taken as a parameter so a future left gutter is a caller change rather
    // than a hunt for a hardcoded 0.
    expect(stickyLabelShift(-100, 900, 60, RESERVE)).toBe(160);
  });

  it("leaves a box to the right of it alone", () => {
    expect(stickyLabelShift(100, 900, 60, RESERVE)).toBe(0);
  });
});

describe("how wide the travelling label may be", () => {
  const ICONS = 56;

  it("does not narrow a box that has only just crossed the edge", () => {
    // The cap must not announce itself. A wide box sliding its label a little
    // should look exactly as it did, or names appear to truncate for no reason
    // the moment the box touches the left edge.
    expect(stickyLabelWidth(900, 20, ICONS)).toBe(824);
  });

  it("shrinks as the box runs out", () => {
    expect(stickyLabelWidth(400, 280, ICONS)).toBe(64);
  });

  it("never returns a negative width", () => {
    // A box narrower than the icons it carries. A negative maxWidth is ignored
    // by the browser, which would silently restore the collision this prevents.
    expect(stickyLabelWidth(34, 0, ICONS)).toBe(0);
    expect(stickyLabelWidth(400, 400, ICONS)).toBe(0);
  });

  it("leaves room for the icons at every shift", () => {
    // The property, stated directly: label right edge + icons <= box width.
    for (const shift of [0, 50, 137, 280]) {
      expect(shift + stickyLabelWidth(400, shift, ICONS) + ICONS).toBeLessThanOrEqual(400);
    }
  });
});
