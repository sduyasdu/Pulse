// Pure port of the Graph Effort model — spec §4. Box height is a first-class,
// editable unit of work, not styling: these functions are the single source
// of truth for every number the canvas and side panels display, so nothing
// here should depend on React or Firestore.
import type { Feature, GraphConfig } from "@/types";
import { businessInSpan, businessToSpan } from "./dateUtils";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

type EffortFeature = Pick<Feature, "work" | "effort">;
type ScheduleFeature = Pick<Feature, "x" | "duration" | "useWeekends">;
type ShapeFeature = Pick<Feature, "work" | "effort" | "children" | "collapsed">;
type AllocFeature = Pick<Feature, "resources" | "alloc" | "children">;

/** Work units implied by a box's height, snapped to whole steps. */
export function workOf(feature: EffortFeature, graph: GraphConfig): number {
  const w = feature.work != null ? feature.work : feature.effort != null ? feature.effort : 1;
  return Math.max(graph.workPerStep, Math.round(w / graph.workPerStep) * graph.workPerStep);
}

/** boxHeight(box) = 18 + steps*stepPx (plus subtask rows if expanded). */
export function boxHeight(feature: ShapeFeature, graph: GraphConfig): number {
  const children = feature.children ?? [];
  const expanded = children.length > 0 && !feature.collapsed;
  const steps = clamp(workOf(feature, graph) / graph.workPerStep, 1, 24);
  const bodyHeight = 18 + steps * graph.stepPx;
  return expanded ? 30 + children.length * 27 + 10 : 30 + bodyHeight;
}

/** Elapsed Time = the box's length in working days (weekends excluded
 * unless useWeekends). */
export function elapsedOf(feature: ScheduleFeature): number {
  return feature.useWeekends ? feature.duration : businessInSpan(feature.x, feature.duration);
}

export function allocOf(alloc: Record<string, number> | undefined, rid: string): number {
  return alloc?.[rid] ?? 100;
}

/** Sum of allocation % across the task's assigned resources (fraction —
 * 1.5 = 150%). Subtask assignments are "who's responsible" markers only and
 * deliberately contribute NO allocation — all effort/load comes from the
 * task-level assignment. */
export function allocSum(feature: AllocFeature): number {
  return (feature.resources || []).reduce((a, rid) => a + allocOf(feature.alloc, rid) / 100, 0);
}

/** Graph Effort = Elapsed Time × work-per-day. Man-days. */
export function graphEffort(feature: ScheduleFeature & EffortFeature, graph: GraphConfig): number {
  return round1(elapsedOf(feature) * workOf(feature, graph));
}

/** Estimate Effort = manual value if the user has locked it, else always
 * equals Graph Effort. "Locked" is represented by `estEffort` being set. */
export function estimateEffort(
  feature: ScheduleFeature & EffortFeature & Pick<Feature, "estEffort">,
  graph: GraphConfig,
): number {
  return round1(feature.estEffort != null ? feature.estEffort : graphEffort(feature, graph));
}

export function isEstimateLocked(feature: Pick<Feature, "estEffort">): boolean {
  return feature.estEffort != null;
}

/** Assigned Effort = Elapsed Time × Σ(assigned resources' % allocation). */
export function assignedEffort(feature: ScheduleFeature & AllocFeature): number {
  return round1(elapsedOf(feature) * allocSum(feature));
}

/** Theoretical Elapsed = Estimate Effort ÷ Σ(assigned %). Null if nobody's
 * assigned (division by zero would be meaningless, not zero). */
export function theoreticalElapsed(
  feature: ScheduleFeature & EffortFeature & AllocFeature & Pick<Feature, "estEffort">,
  graph: GraphConfig,
): number | null {
  const a = allocSum(feature);
  return a > 0 ? round1(estimateEffort(feature, graph) / a) : null;
}

export type StaffingLevel = "under" | "right" | "over";

export const STAFFING_COLOR: Record<StaffingLevel, string> = {
  under: "#E5484D",
  right: "#12A594",
  over: "#EAB308",
};

/** Staffing health: compares Assigned vs Estimate Effort with a 5%
 * tolerance (floor of 0.5 man-day so tiny estimates don't get impossibly
 * tight tolerances). under = red, right = green, over = yellow. */
export function staffingLevel(
  feature: ScheduleFeature & EffortFeature & AllocFeature & Pick<Feature, "estEffort">,
  graph: GraphConfig,
): StaffingLevel {
  const planned = estimateEffort(feature, graph);
  const assigned = assignedEffort(feature);
  const gap = assigned - planned;
  const tol = Math.max(0.5, planned * 0.05);
  if (gap < -tol) return "under";
  if (gap > tol) return "over";
  return "right";
}

export function staffingColor(
  feature: ScheduleFeature & EffortFeature & AllocFeature & Pick<Feature, "estEffort">,
  graph: GraphConfig,
): string {
  return STAFFING_COLOR[staffingLevel(feature, graph)];
}

/** Calendar duration (weekday-aware) such that the currently assigned team
 * would deliver the Estimate Effort exactly — spec's "adjust length to
 * resources" button. Null if nobody's assigned. */
export function durationForAssignedResources(
  feature: ScheduleFeature & EffortFeature & AllocFeature & Pick<Feature, "estEffort">,
  graph: GraphConfig,
): number | null {
  const a = allocSum(feature);
  if (a <= 0) return null;
  const wd = Math.max(1, Math.round(estimateEffort(feature, graph) / a));
  return businessToSpan(feature.x, wd, !!feature.useWeekends);
}
