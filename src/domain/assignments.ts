// Resource-centric aggregation — spec §6's Team tab utilization bars and
// the bottom Assignment-by-resource panel. Pure functions over the current
// feature list, no React/Firestore.
import type { Feature, Resource } from "@/types";
import { allocOf, clamp } from "./graphEffort";

export interface AssignmentRow {
  title: string;
  parent?: string;
  start: number;
  duration: number;
  status: Feature["status"];
  pct: number;
}

/** Every TASK-level assignment of a resource. Subtask assignments are just
 * "who's responsible" markers and don't count toward a resource's load, so
 * they're excluded here (see allocSum). */
export function assignmentsFor(features: Feature[], resourceId: string): AssignmentRow[] {
  const rows: AssignmentRow[] = [];
  features.forEach((f) => {
    if ((f.resources || []).includes(resourceId)) {
      rows.push({ title: f.title, start: f.x, duration: f.duration, status: f.status, pct: allocOf(f.alloc, resourceId) });
    }
  });
  return rows;
}

/** Peak daily allocation % across all of a resource's assignments (their
 * busiest day) — can exceed 100% when tasks overlap. */
export function resourcePeakPct(features: Feature[], resourceId: string): number {
  const rows = assignmentsFor(features, resourceId);
  if (!rows.length) return 0;
  const lo = Math.min(...rows.map((r) => r.start));
  const hi = Math.max(...rows.map((r) => r.start + r.duration));
  let peak = 0;
  for (let day = lo; day < hi; day++) {
    let d = 0;
    rows.forEach((row) => {
      if (day >= row.start && day < row.start + row.duration) d += row.pct;
    });
    if (d > peak) peak = d;
  }
  return peak;
}

/** Utilization = peak load vs the resource's occupation limit (capacity %). */
export function utilizationPct(features: Feature[], resource: Pick<Resource, "id" | "capacity">): number {
  return clamp(Math.round((resourcePeakPct(features, resource.id) / (resource.capacity || 100)) * 100), 0, 999);
}

/** Average daily allocation % for a resource across the days in
 * [dStart, dEnd) — a day the person isn't working counts as 0%. */
export function allocInRange(features: Feature[], resourceId: string, dStart: number, dEnd: number): number {
  const rows = assignmentsFor(features, resourceId);
  let sum = 0;
  const days = Math.max(1, dEnd - dStart);
  for (let day = dStart; day < dEnd; day++) {
    rows.forEach((row) => {
      if (day >= row.start && day < row.start + row.duration) sum += row.pct;
    });
  }
  return Math.round(sum / days);
}

/**
 * The three forward windows the per-person load bars cover, in day indices.
 *
 * Four weeks each, starting today: near enough to act on, far enough to see a
 * crunch coming. They were declared inline in both the Team and Capacity tabs,
 * character for character, which is how the two came to show the same thing
 * while claiming to answer different questions.
 */
export function loadWindows(today: number): { label: string; lo: number; hi: number }[] {
  return [
    { label: "1–4w", lo: today, hi: today + 28 },
    { label: "5–8w", lo: today + 28, hi: today + 56 },
    { label: "9–12w", lo: today + 56, hi: today + 84 },
  ];
}

/** A person's average load over a window, as a percentage of their own limit.
 * Capped at 999 so a wild over-assignment cannot stretch the layout. */
export function loadPctInWindow(
  features: Feature[],
  resource: Pick<Resource, "id" | "capacity">,
  lo: number,
  hi: number,
): number {
  return clamp(Math.round((allocInRange(features, resource.id, lo, hi) / (resource.capacity || 100)) * 100), 0, 999);
}

/**
 * How a load reads at a glance: red over the limit, green in a healthy band,
 * amber when someone is barely booked.
 *
 * Amber for UNDER-use is deliberate and easy to misread as a warning about
 * being busy — it is the opposite. Under 50% of your own limit is capacity
 * nobody has planned for, which is a planning problem too.
 */
export function loadColor(pct: number): string {
  if (pct > 100) return "#E5484D";
  if (pct >= 50) return "#12A594";
  return "#F5A524";
}

/** How many people are assigned past their own limit — the number the bell
 * raises. Derived, never stored: it changes with every drag. */
export function overLimitCount(features: Feature[], resources: Resource[]): number {
  return resources.filter((r) => utilizationPct(features, r) > 100).length;
}
