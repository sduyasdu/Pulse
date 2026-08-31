/**
 * Where the canvas should sit when a filter narrows what is on screen.
 *
 * The rule the filter jump used to follow was "go to the earliest match", which
 * is right for a search term (the matches are scattered, the first one is as
 * good a place to start as any) and wrong for an epic. Filtering to an epic that
 * has been running for a year and has months still to go landed you on its
 * *start* — historical work, nothing current — when the part of it you almost
 * certainly wanted is where the team is now.
 *
 * So the choice is made on whether today falls inside the filtered span:
 *
 * - **Today is inside it** — go to today, at the usual reading position. The
 *   epic surrounds you; there is no better anchor than now.
 * - **Today is outside it** — the whole span is past or future, so today is not
 *   a useful anchor. Put the span's start against the left edge, which is where
 *   you would begin reading it and which leaves the maximum amount of it in
 *   view.
 */

/** An inclusive day range, in the same day-index units the canvas uses. */
export interface DaySpan {
  start: number;
  end: number;
}

export interface FilterFocus {
  day: number;
  /** `today` places the day at the usual quarter-in reading position;
   * `left` puts it against the left edge of the canvas. */
  align: "today" | "left";
}

/**
 * Gutter for a `left`-aligned focus, in screen pixels. Not zero: flush against
 * the edge clips the box border and reads as cut off rather than as the start.
 * Matches the margin `fitRoadmap` already leaves for the same reason.
 */
export const FILTER_LEFT_MARGIN_PX = 32;

/**
 * The day range a filtered view covers.
 *
 * Takes the epic *bands* as well as the matching tasks, because an epic's
 * timespan is not always its tasks' timespan — it can be widened by hand
 * (`manualMinX`/`manualMaxX`), and what "the epic's timespan" means to someone
 * looking at the screen is the bar they can see, not the boxes inside it.
 *
 * Returns null when there is nothing to focus on, which the caller reads as
 * "leave the view alone" — a filter that matches nothing should not move you.
 */
export function spanOfFilter(
  features: readonly { x: number; duration: number }[],
  bands: readonly { minX?: number; maxX?: number }[] = [],
): DaySpan | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const f of features) {
    start = Math.min(start, f.x);
    end = Math.max(end, f.x + f.duration);
  }
  for (const b of bands) {
    if (b.minX != null) start = Math.min(start, b.minX);
    if (b.maxX != null) end = Math.max(end, b.maxX);
  }
  // A band can carry one bound without the other (an empty epic widened on one
  // side only). One bound still locates it, so degenerate to a point rather
  // than discarding it.
  if (!Number.isFinite(start) && !Number.isFinite(end)) return null;
  if (!Number.isFinite(start)) start = end;
  if (!Number.isFinite(end)) end = start;
  return { start, end };
}

/** Apply the rule in this module's header. Null span → null focus. */
export function focusForSpan(span: DaySpan | null, today: number): FilterFocus | null {
  if (!span) return null;
  if (today >= span.start && today <= span.end) return { day: today, align: "today" };
  return { day: span.start, align: "left" };
}

export interface ScrollAlignment {
  /** Where to put the scroller, or null to leave it where it is. */
  scrollTop: number | null;
  /** What to remember for when the filter lifts; null = remember nothing. */
  remembered: number | null;
}

/**
 * The vertical counterpart of the rule above, for "hide + compact" filtering.
 *
 * Compaction repacks every match from the top of the canvas
 * (`compactLayout`'s `TOP`), but it does not touch the scroller — so whatever
 * vertical position the reader was at survives into a layout that no longer has
 * anything there. A small scroll offset cuts the first row in half; a larger one
 * hides it, or lands past the results entirely and shows blank canvas. The
 * content is a fixed 1300px minimum tall, so the browser's own clamping does not
 * rescue it.
 *
 * So compaction pins the viewport to the top of what it just packed, and the
 * position from before is restored when the filter lifts — the vertical
 * equivalent of coming back to today. Restoring is why this is a state machine
 * rather than a `scrollTop = 0`: the value has to be captured on the way in, and
 * exactly once, or a second filter change overwrites it with the zero we set
 * ourselves.
 */
export function alignForCompaction(compacting: boolean, remembered: number | null, current: number): ScrollAlignment {
  // `remembered ?? current` and not a plain assignment: while compaction stays
  // on, the filter changing re-runs this, and `current` is then our own 0.
  if (compacting) return { scrollTop: 0, remembered: remembered ?? current };
  // Nothing remembered means compaction was never on — do not move a reader who
  // has simply opened a Pulse, which would overwrite the restored saved view.
  if (remembered === null) return { scrollTop: null, remembered: null };
  return { scrollTop: remembered, remembered: null };
}
