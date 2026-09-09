import { describe, expect, it } from "vitest";
import { REVEAL_MARGIN_PX, revealScrollDelta } from "./layout";

/** A 600px-tall scroller, in viewport coordinates. */
const VIEW = { top: 100, bottom: 700 };
const box = (top: number, height = 80) => ({ top, bottom: top + height });

/** The caller does `scrollTop += delta`, so a positive delta scrolls DOWN. */
const delta = (b: { top: number; bottom: number }) => revealScrollDelta(b, VIEW);

describe("a task already on screen is left alone", () => {
  it("does not move a box in the middle", () => {
    expect(delta(box(300))).toBe(0);
  });

  it("does not move a box flush with the top", () => {
    expect(delta(box(100))).toBe(0);
  });

  it("does not move a box flush with the bottom", () => {
    expect(delta(box(620))).toBe(0);
  });
});

describe("a task below the fold is scrolled down to", () => {
  // The reported case: under "hide + compact" a new task belongs to no epic,
  // so it is packed after every epic band — far below where the reader is.
  it("scrolls down far enough to clear the bottom edge", () => {
    const d = delta(box(2000));
    expect(d).toBeGreaterThan(0);
    expect(d).toBe(2080 - VIEW.bottom + REVEAL_MARGIN_PX);
  });

  it("leaves a margin rather than sitting flush", () => {
    const b = box(2000);
    const after = { top: b.top - delta(b), bottom: b.bottom - delta(b) };
    expect(VIEW.bottom - after.bottom).toBe(REVEAL_MARGIN_PX);
  });

  it("scrolls only just enough for a box a hair past the edge", () => {
    expect(delta(box(621))).toBe(1 + REVEAL_MARGIN_PX);
  });
});

describe("a task above the fold is scrolled up to", () => {
  // The sign matters more than the amount: scrolling the wrong way puts the
  // task further off screen, which looks exactly like the bug being fixed.
  it("scrolls up, not down", () => {
    expect(delta(box(-500))).toBeLessThan(0);
  });

  it("leaves the same margin at the top", () => {
    const b = box(-500);
    const after = { top: b.top - delta(b), bottom: b.bottom - delta(b) };
    expect(after.top - VIEW.top).toBe(REVEAL_MARGIN_PX);
  });
});

describe("a task taller than the viewport", () => {
  // It cannot be fully visible, so the choice is which edge to honour. The top
  // is where the title and the assignee badges are.
  it("aligns its top rather than its bottom", () => {
    const tall = box(2000, 2000);
    const after = { top: tall.top - delta(tall), bottom: tall.bottom - delta(tall) };
    expect(after.top - VIEW.top).toBe(REVEAL_MARGIN_PX);
  });

  it("does the same for a tall box that starts above the fold", () => {
    const tall = box(-100, 2000);
    const after = { top: tall.top - delta(tall) };
    expect(after.top - VIEW.top).toBe(REVEAL_MARGIN_PX);
  });
});
