import type { GraphConfig } from "@/types";

/**
 * Where successive new tasks go so they don't land on top of each other.
 *
 * Every new task is created at today's column and the vertical middle of the
 * viewport, so adding two in a row put the second exactly on the first and the
 * first was simply gone. This offsets each one right and down from the last.
 *
 * The slot is not a counter. It is the lowest index no live task is sitting on,
 * which is what makes the cascade give ground: place a task deliberately — move
 * it, stretch it, delete it — and the slot it vacated is the one the next add
 * takes. So the cascade only ever grows while you are leaving new tasks where
 * they fell, and it collapses back as soon as you start arranging them.
 */
export interface CascadeClaim {
  id: string;
  slot: number;
  /** The geometry the task was created with. Any drift from this is the user
   * having positioned or sized it, which releases the slot. */
  x: number;
  y: number;
  duration: number;
  work: number;
  /** Whether this task has been observed in the live feature list yet. A claim
   * made microseconds ago has not, and must not be mistaken for a deletion. */
  seen: boolean;
}

/** Just enough of a Feature to reconcile against. */
export interface CascadeFeature {
  id: string;
  x: number;
  y: number;
  duration?: number;
  work?: number;
}

/** A new task is always one work-step tall (`work: 1`, and the step count is
 * clamped to a floor of 1), so its height is knowable without measuring: 30 for
 * the header + 18 padding + one step. The gap is what stops consecutive boxes
 * sharing an edge. */
export function cascadeStepPx(graph: GraphConfig): number {
  return 30 + 18 + graph.stepPx + 8;
}

/** Days each successive task shifts right. Deliberately one: on this canvas x
 * is a date, not decoration, so the cascade should cost the least schedule
 * meaning it can while still reading as a cascade. */
export const CASCADE_STEP_DAYS = 1;

export function cascadeOffsetFor(slot: number, graph: GraphConfig): { dx: number; dy: number } {
  return { dx: slot * CASCADE_STEP_DAYS, dy: slot * cascadeStepPx(graph) };
}

/** The lowest slot nobody is holding — so a freed slot is refilled before the
 * cascade extends any further. */
export function lowestFreeSlot(claims: CascadeClaim[]): number {
  const taken = new Set(claims.map((c) => c.slot));
  let slot = 0;
  while (taken.has(slot)) slot++;
  return slot;
}

/**
 * Drop the claims that no longer describe an untouched new task.
 *
 * Three outcomes per claim:
 * - **Moved or resized** → released. This is the user placing it deliberately,
 *   which is precisely the signal that its slot is free again.
 * - **Missing, having been seen** → released; it was deleted.
 * - **Missing, never seen** → kept. The claim is made the instant the write
 *   resolves, which can be a render before the subscription delivers the task,
 *   and treating that gap as a deletion would free the slot the task is about
 *   to occupy.
 */
export function reconcileClaims(claims: CascadeClaim[], features: CascadeFeature[]): CascadeClaim[] {
  const byId = new Map(features.map((f) => [f.id, f]));
  const out: CascadeClaim[] = [];
  for (const c of claims) {
    const f = byId.get(c.id);
    if (!f) {
      if (!c.seen) out.push(c);
      continue;
    }
    const placed = f.x === c.x && f.y === c.y && (f.duration ?? 0) === c.duration && (f.work ?? 0) === c.work;
    if (!placed) continue;
    out.push(c.seen ? c : { ...c, seen: true });
  }
  return out;
}
