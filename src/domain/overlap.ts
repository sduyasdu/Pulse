/**
 * Making room for a task that was just moved or resized.
 *
 * The canvas already had a rearranger — `compactLayout` — but it only runs in
 * "hide + compact" filter mode, which is a *view* transform over a filtered
 * subset. Outside that mode nothing reacted to a drag at all: stretch a task
 * over its neighbour and the two simply sat on top of each other, with the one
 * underneath unreadable and no indication anything was wrong.
 *
 * This is deliberately NOT compaction. Compaction repacks everything from the
 * top and would throw away a hand-built layout the moment anyone nudged a date.
 * This moves the fewest boxes it can: only those the dragged task actually
 * lands on, and only downwards, so rows that were not in the way stay exactly
 * where the person who arranged them put them.
 */

/** The minimum a task needs to know about itself to be pushed out of the way. */
export interface Placeable {
  id: string;
  /** Start day. */
  x: number;
  /** Length in days. */
  duration: number;
  y: number;
  /** Which epic it belongs to; null/undefined is the "no epic" group. */
  epicId?: string | null;
}

/** Vertical gap left between two boxes that had to be separated. Matches the
 * breathing room `packLanes` leaves between its lanes, so a pushed row does not
 * look tighter than a packed one. */
export const OVERLAP_GAP_PX = 12;

/** Day ranges only — takes bare spans so it works for both stored features and
 * the settled boxes below, which have no id. */
const overlapsInTime = (a: { x: number; duration: number }, b: { x: number; duration: number }): boolean =>
  a.x < b.x + b.duration && b.x < a.x + a.duration;

const overlapsVertically = (aTop: number, aH: number, bTop: number, bH: number): boolean =>
  aTop < bTop + bH && bTop < aTop + aH;

/**
 * Push whatever the moved task now sits on top of far enough down to clear it.
 *
 * Returns only the tasks whose `y` changed, as `{ id, y }` — an empty array when
 * nothing was in the way, which is the common case and must stay free.
 *
 * Rules, and why each one:
 *
 * - **Same section only.** A task only displaces others in its own epic (and a
 *   task with no epic only displaces other loose tasks). Epics are the canvas's
 *   sections; shoving a neighbouring epic's rows around because something grew
 *   in this one would be action at a distance.
 * - **Downwards only.** Pushing up is equally valid geometrically and much worse
 *   to watch: it moves rows the person is not looking at, and can walk content
 *   off the top of the canvas.
 * - **Cascading.** A pushed task can land on the next one down, so this repeats
 *   until nothing overlaps. Bounded by the number of tasks, since every pass
 *   moves at least one task strictly downwards and never moves the same one up.
 * - **The moved task never moves.** It is where the person just put it. Any
 *   other choice fights the gesture that started this.
 */
export function resolveOverlaps<T extends Placeable>(
  features: readonly T[],
  movedId: string,
  heightOf: (f: T) => number,
): { id: string; y: number }[] {
  const moved = features.find((f) => f.id === movedId);
  if (!moved) return [];

  const section = (f: T) => f.epicId ?? null;
  const peers = features.filter((f) => f.id !== movedId && section(f) === section(moved));
  if (peers.length === 0) return [];

  /**
   * A single top-to-bottom sweep. Every box already settled becomes an obstacle
   * for the ones below it, so the cascade falls out of the ordering rather than
   * needing repeated passes over the whole set.
   *
   * `dirty` is what keeps the blast radius honest. A box is only pushed if it
   * collides with something the drag actually disturbed — the moved task, or
   * something already displaced by it. Two boxes that were overlapping each
   * other before anyone touched anything are left alone: tidying those would
   * move rows the person never went near, on a gesture aimed somewhere else.
   *
   * But a box that IS being pushed has to clear every obstacle it would land
   * on, dirty or not. Otherwise resolving one overlap quietly creates another.
   */
  interface Box {
    top: number;
    h: number;
    x: number;
    duration: number;
    dirty: boolean;
  }
  const settled: Box[] = [{ top: moved.y, h: heightOf(moved), x: moved.x, duration: moved.duration, dirty: true }];
  const out: { id: string; y: number }[] = [];

  for (const f of [...peers].sort((a, b) => a.y - b.y)) {
    const h = heightOf(f);
    let top = f.y;
    const hits = (b: Box) => overlapsInTime(f, b) && overlapsVertically(top, h, b.top, b.h);

    // Only a collision with a disturbed box justifies moving this one.
    if (settled.some((b) => b.dirty && hits(b))) {
      // Then clear everything, so the fix cannot introduce a new overlap. Each
      // iteration strictly increases `top` past one obstacle, and there are
      // finitely many, so this terminates.
      for (let guard = 0; guard <= settled.length; guard++) {
        const blocker = settled.find(hits);
        if (!blocker) break;
        top = blocker.top + blocker.h + OVERLAP_GAP_PX;
      }
    }

    const displaced = top !== f.y;
    settled.push({ top, h, x: f.x, duration: f.duration, dirty: displaced });
    if (displaced) out.push({ id: f.id, y: Math.round(top) });
  }

  return out;
}
