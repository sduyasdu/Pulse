/**
 * How big a task box's resize handles need to be.
 *
 * Three things made them hard to hit, and the size was only the first.
 *
 * **They were measured in canvas pixels, not screen pixels.** The canvas
 * content is drawn inside a `transform: scale(viewZoom)`, so a 7px handle is
 * 7px on screen only at 100%. Zoomed out to 50% it is 3.5px, and at 20% — well
 * within the range the zoom control offers — 1.4px, which is not a target at
 * all. Sizes here are divided by the zoom, so a handle stays the same size
 * under the cursor at every zoom level, which is the only size that matters.
 *
 * **The bottom corners belonged to the wrong handle.** The side handles ran the
 * full height of the box and the effort handle its full width, so they
 * overlapped in both bottom corners — and the effort handle, rendered last, won
 * them. Reaching for the side of a box near its bottom got a vertical resize.
 * The effort handle is now inset by the side handles' width.
 *
 * **And the handle was centred on the border**, so half of a 12px target hung
 * outside the box over the canvas — or over a neighbouring box, which sits at
 * the same z-index and can take the event. Only 6px was actually on the box.
 * The overhang is now a small fixed lip and the rest sits inside, where it can
 * be relied on.
 */

/** Edge grab width under a mouse, in SCREEN pixels. */
export const RESIZE_EDGE_PX = 20;
/** Under a finger. `useCoarsePointer`, not width — an iPad is wide and still
 * cannot hover. */
export const RESIZE_EDGE_COARSE_PX = 32;
/** Height of the bottom (effort) handle, in screen pixels. */
export const RESIZE_EFFORT_PX = 24;
export const RESIZE_EFFORT_COARSE_PX = 38;

/** How far a side handle spills past the border, in screen pixels. Enough that
 * aiming slightly wide still lands, small enough not to reach into the
 * neighbour that may be sitting right there. */
export const RESIZE_OUTSIDE_PX = 5;

/**
 * The middle of the box that must never be covered by a handle, in screen
 * pixels — horizontally between the two edges, vertically above the effort
 * strip. This is what the box is grabbed by to MOVE it, so a box whose handles
 * met in the middle could be resized but never moved.
 *
 * A share of the box (this was `1/3` each) is the wrong shape for the same
 * reason a fixed handle size was: it makes the target depend on the box rather
 * than on the hand. Reserving a constant leaves every box that can afford the
 * full handle with the full handle.
 */
export const MIN_CORE_PX = 20;

/** A handle never disappears entirely, however cramped the box. */
export const MIN_HANDLE_PX = 4;

export interface HandleSizes {
  /** Width of each side handle, in CANVAS pixels (what the style expects). */
  edge: number;
  /** How much of `edge` sits outside the box; the remainder is inside. */
  outside: number;
  /** Height of the bottom handle, in canvas pixels. */
  effort: number;
}

/** Fit a wanted size into what is left after reserving the core. */
function fit(want: number, available: number, core: number, halves: 1 | 2): number {
  const room = (available - core) / halves;
  return Math.max(MIN_HANDLE_PX, Math.min(want, room));
}

/**
 * Handle sizes for one box, in canvas pixels.
 *
 * `viewZoom` converts screen intent into canvas units; `coarse` is whether the
 * pointer is a finger.
 */
export function resizeHandleSizes(opts: {
  width: number;
  height: number;
  viewZoom: number;
  coarse: boolean;
}): HandleSizes {
  const { coarse } = opts;
  // A zero or negative zoom would divide into Infinity and blanket the canvas
  // in invisible handles, making every click a resize.
  const zoom = Number.isFinite(opts.viewZoom) && opts.viewZoom > 0 ? opts.viewZoom : 1;
  const width = Math.max(0, opts.width);
  const height = Math.max(0, opts.height);
  const core = MIN_CORE_PX / zoom;

  const edge = fit((coarse ? RESIZE_EDGE_COARSE_PX : RESIZE_EDGE_PX) / zoom, width, core, 2);
  const effort = fit((coarse ? RESIZE_EFFORT_COARSE_PX : RESIZE_EFFORT_PX) / zoom, height, core, 1);

  return {
    edge,
    // Never more than half the handle, so a tiny handle on a cramped box still
    // has something inside the box to hit.
    outside: Math.min(RESIZE_OUTSIDE_PX / zoom, edge / 2),
    effort,
  };
}
