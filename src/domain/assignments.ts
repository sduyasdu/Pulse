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
