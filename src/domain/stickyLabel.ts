/**
 * Keeping a task's name readable when its box starts off the left of the view.
 *
 * A long task, or one that began before the visible window, is drawn with its
 * left edge at a negative x. Everything in its header — the name included —
 * goes with it, so the box fills the screen while saying nothing about which
 * task it is. The fix is to slide the name along the box as it leaves, so it
 * sits at whatever part of the box is still on screen.
 *
 * This has to be arithmetic rather than `position: sticky`: the canvas does not
 * scroll natively. It pans by `offsetX` and draws every box at
 * `offsetX + day * dayWidth` inside a `scale(viewZoom)` wrapper, so there is no
 * scrolling ancestor for `sticky` to attach to and the browser has nothing to
 * anchor against.
 */

/**
 * How far to slide a box's label right, in the canvas's own (unscaled)
 * coordinates.
 *
 * `viewLeft` is the left edge of the visible window in those same coordinates —
 * 0 today, taken as a parameter because that is the fact that would change if
 * the canvas ever grew a fixed left gutter, and a hardcoded 0 is invisible when
 * it does.
 *
 * `reserve` is the room the label needs. As a box leaves to the left, the strip
 * of it still on screen gets narrower, and below some width there is nowhere to
 * put a name — so the slide stops and the label leaves with the box rather than
 * being crushed against its right edge or pushed out past it.
 *
 * Returns 0 for a box whose start is visible, which is the overwhelming
 * majority of boxes and the case that must cost nothing.
 */
export function stickyLabelShift(
  boxLeft: number,
  boxWidth: number,
  viewLeft: number,
  reserve: number,
): number {
  const hidden = viewLeft - boxLeft;
  if (hidden <= 0) return 0;
  // Never past the point where the label would overrun the box. `Math.max(…, 0)`
  // because a box narrower than the reserve has no room at all, and a negative
  // ceiling would otherwise drag the label off the box's left edge — worse than
  // not sliding it.
  const ceiling = Math.max(boxWidth - reserve, 0);
  return Math.min(hidden, ceiling);
}

/**
 * How wide the travelling label may be, so it never collides with the icons
 * pinned to the box's right edge.
 *
 * `translateX` moves what is painted, not what is laid out: the label's flex
 * box still believes it starts at the box's left and may be as wide as the
 * space there. Slide it right without narrowing it and a long name runs under
 * the pin, attachment and done icons on a box that is mostly off screen — the
 * one case where those icons are crowded into the same few pixels as the name.
 *
 * The cap only bites as the box runs out. While the shift is small the result
 * is wider than the label could ever be, so a box that has just crossed the
 * edge does not suddenly truncate its name.
 */
export function stickyLabelWidth(boxWidth: number, shift: number, iconRoom: number): number {
  return Math.max(boxWidth - shift - iconRoom, 0);
}
