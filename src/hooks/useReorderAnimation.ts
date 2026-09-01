import { useCallback, useLayoutEffect, useRef } from "react";

/** Long enough to follow a row across the panel, short enough not to delay the
 * next thing you want to do with it. */
export const REORDER_MS = 260;

/**
 * How far each row must be translated to appear, for one frame, where it just
 * was — the "Invert" of a FLIP animation.
 *
 * Split out from the hook because it is the only part with a right answer, and
 * the only part testable without a layout engine: jsdom reports every rectangle
 * as zero, so a test driving the hook would assert nothing.
 *
 * Rows absent from `before` are skipped rather than animated from zero. They
 * were just added, and a row flying in from the top of the viewport is a
 * different (and unasked-for) effect from a row moving to a new place in a list
 * it was already in.
 */
export function flipDeltas(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, now] of after) {
    const was = before.get(id);
    if (was === undefined) continue;
    const delta = was - now;
    if (delta !== 0) out.set(id, delta);
  }
  return out;
}

/**
 * Animate a list's rows to their new places when the order changes.
 *
 * The Epics tab stages untouched epics at the top and drops each one to its
 * `y0` position the moment it is named. Without this the row simply is
 * somewhere else on the next frame, and after typing a name into a field at the
 * top of the panel, the eye has no way to follow where that epic went.
 *
 * FLIP, because no CSS transition can animate a reorder: the browser does not
 * move an element between two positions in the flow, it lays the list out
 * again. So this measures where each row was, lets React reorder, measures
 * again, puts each row back where it started with a transform, and releases
 * them a frame later.
 *
 * `transform` only — the rows keep their layout positions throughout, so
 * nothing below reflows and the animation costs no layout passes.
 *
 * Returns a ref registrar to spread over each row.
 */
export function useReorderAnimation(orderKey: string): (id: string, el: HTMLElement | null) => void {
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const after = new Map<string, number>();
    for (const [id, el] of nodes.current) after.set(id, el.getBoundingClientRect().top);
    const deltas = flipDeltas(tops.current, after);
    tops.current = after;

    if (deltas.size === 0) return;
    // Decorative: it explains a reorder that is correct either way.
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const cleanups: (() => void)[] = [];
    for (const [id, delta] of deltas) {
      const el = nodes.current.get(id);
      if (!el) continue;

      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;

      // Next frame, or the browser coalesces both writes and nothing moves.
      const frame = requestAnimationFrame(() => {
        el.style.transition = `transform ${REORDER_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        el.style.transform = "";
      });

      // Clear the inline styles afterwards. The row carries `.hoverable`, whose
      // own transition an inline `transition` would otherwise suppress
      // permanently — the animation would end and the row would quietly stop
      // responding to hover for the rest of the session.
      const done = () => {
        el.style.transition = "";
        el.style.transform = "";
      };
      el.addEventListener("transitionend", done, { once: true });

      cleanups.push(() => {
        cancelAnimationFrame(frame);
        el.removeEventListener("transitionend", done);
        done();
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [orderKey]);

  return register;
}
