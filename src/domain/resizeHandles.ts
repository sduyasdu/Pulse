/**
 * How big a task box's resize handles need to be.
 *
 * Two things made them hard to hit, and only one of them was the size.
 *
 * **They were measured in canvas pixels, not screen pixels.** The canvas
 * content is drawn inside a `transform: scale(viewZoom)`, so a 7px handle is
 * 7px on screen only at 100%. Zoomed out to 50% it is 3.5px, and at 20% — well
 * within the range the zoom control offers — it is 1.4px, which is not a target
 * at all. Sizes here are therefore divided by the zoom, so the handle stays the
 * same size under the cursor at every zoom level, which is the only size that
 * matters.
 *
 * **The bottom corners belonged to the wrong handle.** The side handles ran the
 * full height of the box and the effort handle ran its full width, so they
 * overlapped in both bottom corners — and the effort handle, being rendered
 * last, won. Reaching for the side of a box anywhere near its bottom got a
 * vertical resize instead. That is why this was worst when working in both
 * directions: the two gestures were fighting over the same pixels. The effort
 * handle is now inset by the width of the side handles, so each has its own
 * area and neither can shadow the other.
 */

/** Edge grab width under a mouse, in SCREEN pixels. Comfortably more than the
 * 7 it was, without eating a small box (see the clamp below). */
export const RESIZE_EDGE_PX = 12;
/** Under a finger. Still short of the ~44px ideal, because a task box can be
 * narrow and an edge that big would leave nothing in the middle to drag the box
 * by — the clamp resolves the rest. */
export const RESIZE_EDGE_COARSE_PX = 24;
/** Height of the bottom (effort) handle, in screen pixels. */
export const RESIZE_EFFORT_PX = 16;
export const RESIZE_EFFORT_COARSE_PX = 28;

/**
 * No handle may take more than this share of the box it is on. A box is 34px
 * wide at its narrowest, and two 24px edges plus a 28px bottom strip would
 * leave nothing to select or drag it by — every gesture would resize it and it
 * could never be moved.
 */
export const MAX_HANDLE_SHARE = 1 / 3;

export interface HandleSizes {
  /** Width of each side handle, in CANVAS pixels (what the style expects). */
  edge: number;
  /** Height of the bottom handle, in canvas pixels. */
  effort: number;
}

/**
 * Handle sizes for one box, in canvas pixels.
 *
 * `viewZoom` converts screen intent to canvas units; `coarse` is whether the
 * pointer is a finger (`useCoarsePointer` — true on iPad too, which is wide but
 * cannot hover, so width is the wrong question).
 */
export function resizeHandleSizes(opts: {
  width: number;
  height: number;
  viewZoom: number;
  coarse: boolean;
}): HandleSizes {
  const { width, height, coarse } = opts;
  // A zero or negative zoom would divide into Infinity and blanket the canvas
  // in invisible handles.
  const zoom = Number.isFinite(opts.viewZoom) && opts.viewZoom > 0 ? opts.viewZoom : 1;

  const wantEdge = (coarse ? RESIZE_EDGE_COARSE_PX : RESIZE_EDGE_PX) / zoom;
  const wantEffort = (coarse ? RESIZE_EFFORT_COARSE_PX : RESIZE_EFFORT_PX) / zoom;

  return {
    edge: Math.max(1, Math.min(wantEdge, Math.max(0, width) * MAX_HANDLE_SHARE)),
    effort: Math.max(1, Math.min(wantEffort, Math.max(0, height) * MAX_HANDLE_SHARE)),
  };
}
