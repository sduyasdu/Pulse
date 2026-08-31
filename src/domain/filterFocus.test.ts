import { describe, expect, it } from "vitest";
import { FILTER_LEFT_MARGIN_PX, alignForCompaction, focusForSpan, spanOfFilter } from "./filterFocus";

const task = (x: number, duration: number) => ({ x, duration });

describe("the span a filter covers", () => {
  it("is the extent of the matching tasks", () => {
    expect(spanOfFilter([task(10, 5), task(30, 2), task(20, 40)])).toEqual({ start: 10, end: 60 });
  });

  it("ends at a task's end, not its start", () => {
    expect(spanOfFilter([task(100, 200)])).toEqual({ start: 100, end: 300 });
  });

  it("is null when nothing matched", () => {
    expect(spanOfFilter([])).toBeNull();
  });

  // An epic can be dragged wider than the tasks inside it. What someone means
  // by "the epic's timespan" is the bar they can see, so the band counts.
  it("widens to an epic band that reaches past its tasks", () => {
    expect(spanOfFilter([task(50, 10)], [{ minX: 20, maxX: 200 }])).toEqual({ start: 20, end: 200 });
  });

  it("keeps the tasks' extent when the band is narrower", () => {
    expect(spanOfFilter([task(10, 100)], [{ minX: 40, maxX: 60 }])).toEqual({ start: 10, end: 110 });
  });

  it("spans several selected epics", () => {
    expect(spanOfFilter([], [{ minX: 300, maxX: 400 }, { minX: 10, maxX: 20 }])).toEqual({ start: 10, end: 400 });
  });

  // An empty epic widened on one side only carries one bound. It still locates
  // the epic, so it degenerates to a point rather than being discarded.
  it("tolerates a band with only one bound", () => {
    expect(spanOfFilter([], [{ minX: 90 }])).toEqual({ start: 90, end: 90 });
    expect(spanOfFilter([], [{ maxX: 90 }])).toEqual({ start: 90, end: 90 });
  });

  it("is null for a band carrying no bounds at all", () => {
    expect(spanOfFilter([], [{}])).toBeNull();
  });
});

describe("where to sit once the span is known", () => {
  const TODAY = 1000;

  // The reported bug: a long-running epic sent the canvas to its beginning —
  // work finished months ago — when the part in flight is around today.
  it("goes to today when today is inside the span", () => {
    expect(focusForSpan({ start: 700, end: 1400 }, TODAY)).toEqual({ day: TODAY, align: "today" });
  });

  it("goes to today on either boundary of the span", () => {
    expect(focusForSpan({ start: TODAY, end: 1400 }, TODAY)).toEqual({ day: TODAY, align: "today" });
    expect(focusForSpan({ start: 700, end: TODAY }, TODAY)).toEqual({ day: TODAY, align: "today" });
  });

  // Today anchors nothing when the whole span is elsewhere, so start at the
  // beginning — flush left, which leaves the most of it in view.
  it("left-aligns the start of a span entirely in the past", () => {
    expect(focusForSpan({ start: 100, end: 200 }, TODAY)).toEqual({ day: 100, align: "left" });
  });

  it("left-aligns the start of a span entirely in the future", () => {
    expect(focusForSpan({ start: 2000, end: 2500 }, TODAY)).toEqual({ day: 2000, align: "left" });
  });

  it("handles a single-day span", () => {
    expect(focusForSpan({ start: TODAY, end: TODAY }, TODAY)).toEqual({ day: TODAY, align: "today" });
    expect(focusForSpan({ start: 5, end: 5 }, TODAY)).toEqual({ day: 5, align: "left" });
  });

  it("leaves the view alone when there is no span", () => {
    expect(focusForSpan(null, TODAY)).toBeNull();
  });
});

describe("the two together", () => {
  const TODAY = 1000;

  // The exact reported case: an epic that started long ago and runs well past
  // today. Its earliest task is what the old rule picked.
  it("puts a long-running epic at today, not at its first task", () => {
    const focus = focusForSpan(spanOfFilter([task(200, 30), task(900, 40), task(1500, 20)]), TODAY);
    expect(focus).toEqual({ day: TODAY, align: "today" });
  });

  // ...and the case the old rule got right, which must keep working.
  it("still starts a finished epic at its beginning", () => {
    const focus = focusForSpan(spanOfFilter([task(200, 30), task(400, 40)]), TODAY);
    expect(focus).toEqual({ day: 200, align: "left" });
  });

  // Manual widening alone can bring today inside a span whose tasks are all in
  // the past — the bar on screen covers today, so today is the anchor.
  it("follows the band when hand-widening brings today into range", () => {
    const focus = focusForSpan(spanOfFilter([task(200, 30)], [{ minX: 200, maxX: 1200 }]), TODAY);
    expect(focus).toEqual({ day: TODAY, align: "today" });
  });
});

/**
 * The reported bug: compaction repacks the matches from the top of the canvas
 * but leaves the scroller where it was, so a reader who had scrolled even a
 * little saw the first row cut in half.
 */
describe("aligning the scroller with a compacted layout", () => {
  it("pins to the top when compaction engages", () => {
    expect(alignForCompaction(true, null, 120)).toEqual({ scrollTop: 0, remembered: 120 });
  });

  it("pins to the top even from an already-aligned view", () => {
    expect(alignForCompaction(true, null, 0)).toEqual({ scrollTop: 0, remembered: 0 });
  });

  // The half-cut row itself: any offset at all leaves the packed top above the
  // fold, because compaction always starts from the same place.
  it.each([1, 40, 120, 700])("pins to the top from scrollTop %i", (from) => {
    expect(alignForCompaction(true, null, from).scrollTop).toBe(0);
  });

  it("puts the reader back when the filter lifts", () => {
    expect(alignForCompaction(false, 120, 0)).toEqual({ scrollTop: 120, remembered: null });
  });

  // The trap this state machine exists for. While compaction stays on, changing
  // the filter re-runs it — and `current` is then the 0 we set ourselves, so a
  // plain capture would overwrite the real position with zero and "restore" the
  // reader to the top of an unfiltered canvas.
  it("keeps the original position across a filter change", () => {
    const first = alignForCompaction(true, null, 340);
    expect(first.remembered).toBe(340);
    const second = alignForCompaction(true, first.remembered, 0);
    expect(second).toEqual({ scrollTop: 0, remembered: 340 });
    expect(alignForCompaction(false, second.remembered, 0).scrollTop).toBe(340);
  });

  it("survives several filter changes before lifting", () => {
    let remembered: number | null = null;
    let current = 275;
    for (let i = 0; i < 5; i++) {
      const step = alignForCompaction(true, remembered, current);
      remembered = step.remembered;
      current = step.scrollTop ?? current;
    }
    expect(alignForCompaction(false, remembered, current)).toEqual({ scrollTop: 275, remembered: null });
  });

  // Opening a Pulse runs this with compaction off and nothing remembered. It
  // must not move anything: PulsePage has just restored the saved scroll
  // position for this Pulse, and a 0 here would throw it away.
  it("leaves an untouched view alone", () => {
    expect(alignForCompaction(false, null, 480)).toEqual({ scrollTop: null, remembered: null });
  });

  it("stays quiet on every run while no filter has been applied", () => {
    expect(alignForCompaction(false, null, 0).scrollTop).toBeNull();
    expect(alignForCompaction(false, null, 900).scrollTop).toBeNull();
  });

  it("forgets the remembered position once it has been used", () => {
    const lifted = alignForCompaction(false, 200, 0);
    expect(lifted.remembered).toBeNull();
    expect(alignForCompaction(false, lifted.remembered, 0).scrollTop).toBeNull();
  });
});

describe("the left gutter", () => {
  // Zero would clip the box border against the edge and read as cut off rather
  // than as the start of the epic.
  it("leaves room for the border", () => {
    expect(FILTER_LEFT_MARGIN_PX).toBeGreaterThan(0);
  });
});
