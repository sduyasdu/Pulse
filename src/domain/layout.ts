// Pure layout algorithms shared by the canvas (epic swimlanes) and the
// bottom assignment panel (overlapping-bar stacking). No React, no Firestore.
import type { Epic, Feature, GraphConfig } from "@/types";
import { boxHeight } from "./graphEffort";

export const EPIC_MIN_H = 90;

export interface EpicBand extends Epic {
  minX?: number;
  maxX?: number;
  count: number;
}

type BandFeature = Pick<Feature, "id" | "x" | "y" | "duration" | "epicId" | "work" | "effort" | "children" | "collapsed">;

/**
 * For each epic, fit its extent (both axes) to the features it contains:
 * a populated epic hugs its features' bounding box on every side, so it
 * tracks them as they move — including shrinking its top back down when the
 * topmost feature moves away from it. The stored ep.y0 is only the fallback
 * top for an *empty* epic; it does not floor a populated one. Manual
 * overrides (manualY0/Y1/MinX/MaxX) extend but never clip the auto-fit extent.
 */
export function epicBandsFor(
  epics: Epic[],
  features: BandFeature[],
  graph: GraphConfig,
  opts: { shrunk?: boolean } = {},
): EpicBand[] {
  const shrunk = !!opts.shrunk;
  const bh = (f: BandFeature) => (shrunk ? 26 : boxHeight(f, graph));
  return epics.map((ep) => {
    const feats = features.filter((f) => f.epicId === ep.id);
    let minX: number | undefined;
    let maxX: number | undefined;
    let y0 = ep.y0;
    let y1 = ep.y0 + (shrunk ? 54 : EPIC_MIN_H);
    if (feats.length) {
      minX = Math.min(...feats.map((f) => f.x));
      maxX = Math.max(...feats.map((f) => f.x + f.duration));
      y0 = Math.min(...feats.map((f) => f.y - 30));
      y1 = Math.max(y0 + (shrunk ? 54 : EPIC_MIN_H), ...feats.map((f) => f.y + bh(f) + 12));
    }
    if (!shrunk) {
      if (ep.manualY0 != null) y0 = Math.min(y0, ep.manualY0);
      if (ep.manualY1 != null) y1 = Math.max(y1, ep.manualY1);
    }
    if (ep.manualMinX != null) minX = minX != null ? Math.min(minX, ep.manualMinX) : ep.manualMinX;
    if (ep.manualMaxX != null) maxX = maxX != null ? Math.max(maxX, ep.manualMaxX) : ep.manualMaxX;
    return { ...ep, minX, maxX, y0, y1, count: feats.length };
  });
}

/**
 * Which epic a box dropped at (centerX in days, centerY in px) lands in —
 * i.e. which epic's on-screen rectangle actually contains the box's centre.
 * Returns null when it's inside none of them ("no epic").
 *
 * Two things this deliberately gets right, both of which were real bugs:
 *
 *  - It tests BOTH axes. An epic band is a rectangle: it spans a day-range
 *    (minX..maxX) as well as a y-range. Testing only y made a box dragged
 *    clear of an epic horizontally still count as inside it, so a feature
 *    could be reassigned to (or stuck in) an epic it visually sat well to
 *    the right of.
 *
 *  - Among containing bands the *most specific* (shortest) one wins, rather
 *    than the one with the greatest overlap area. Auto-fit extents grow into
 *    and past each other — an epic whose features are scattered vertically
 *    ends up tall enough to enclose its neighbours whole — and under a
 *    max-overlap rule that bloated band then wins essentially everywhere, so
 *    a box dropped squarely inside a small epic was still captured by the
 *    big one enclosing it, and could never be moved out.
 *
 * A featureless epic has no day-range at all (its band is drawn at a fixed
 * screen offset rather than anchored to the timeline), so it imposes no
 * horizontal constraint — only its y-range is tested.
 */
export function epicAtBox(bands: EpicBand[], centerX: number, centerY: number): string | null {
  let best: EpicBand | undefined;
  for (const ep of bands) {
    if (centerY < ep.y0 || centerY > ep.y1) continue;
    if (ep.minX != null && ep.maxX != null && (centerX < ep.minX || centerX > ep.maxX)) continue;
    if (!best || ep.y1 - ep.y0 < best.y1 - best.y0) best = ep;
  }
  return best ? best.id : null;
}

export interface TimeRow {
  start: number;
  duration: number;
}

/** Assign overlapping time-ranged rows to stacked vertical lanes (used for
 * both epic vertical packing and the assignment panel's per-resource bars):
 * two rows share a lane only if their time spans don't overlap. */
export function stackRows<T extends TimeRow>(rows: T[]): (T & { lane: number })[] {
  const sorted = [...rows].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  return sorted.map((row) => {
    let lane = laneEnds.findIndex((end) => row.start >= end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = row.start + row.duration;
    return { ...row, lane };
  });
}

interface PackedLanes {
  laneOf: Record<string, number>;
  laneTop: number[];
  totalH: number;
}

const LANE_GAP = 12;

function packLanes<F extends { id: string; x: number; duration: number }>(
  feats: F[],
  heightOf: (f: F) => number,
): PackedLanes {
  const sorted = [...feats].sort((a, b) => a.x - b.x || b.duration - a.duration);
  const laneEnds: number[] = [];
  const laneOf: Record<string, number> = {};
  sorted.forEach((f) => {
    let lane = laneEnds.findIndex((end) => f.x >= end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = f.x + f.duration;
    laneOf[f.id] = lane;
  });
  const laneH = laneEnds.map((_, i) =>
    Math.max(...sorted.filter((f) => laneOf[f.id] === i).map(heightOf), 30),
  );
  const laneTop: number[] = [];
  let acc = 0;
  laneH.forEach((h, i) => {
    laneTop[i] = acc;
    acc += h + LANE_GAP;
  });
  return { laneOf, laneTop, totalH: acc > 0 ? acc - LANE_GAP : 0 };
}

export interface CompactResult {
  epics: Epic[];
  featureYById: Record<string, number>;
}

/**
 * Repack every epic's features into the minimum vertical space (features
 * that don't overlap in time share a row), stack epic bands one after
 * another, then place any loose (no-epic) features below. Horizontal
 * positions (dates) are untouched — only y changes.
 */
export function compactLayout(
  epics: Epic[],
  features: BandFeature[],
  graph: GraphConfig,
  opts: { shrunk?: boolean } = {},
): CompactResult {
  const shrunk = !!opts.shrunk;
  const heightOf = (f: BandFeature) => (shrunk ? 26 : boxHeight(f, graph));
  const LABEL_H = 30;
  const EPIC_GAP = 24;
  const TOP = 16;
  const minH = shrunk ? 54 : EPIC_MIN_H;
  let cursor = TOP;
  const featureYById: Record<string, number> = {};

  const ordered = [...epics].sort((a, b) => a.y0 - b.y0);
  const newEpics = ordered.map((ep) => {
    const feats = features.filter((f) => f.epicId === ep.id);
    const y0 = cursor;
    const inner = y0 + LABEL_H;
    let totalH = 0;
    if (feats.length) {
      const packed = packLanes(feats, heightOf);
      feats.forEach((f) => {
        featureYById[f.id] = inner + packed.laneTop[packed.laneOf[f.id]];
      });
      totalH = packed.totalH;
    }
    const y1 = Math.max(y0 + minH, inner + totalH + 10);
    cursor = y1 + EPIC_GAP;
    return { ...ep, y0, y1, manualY0: null, manualY1: null };
  });

  const loose = features.filter((f) => !f.epicId);
  if (loose.length) {
    const packed = packLanes(loose, heightOf);
    loose.forEach((f) => {
      featureYById[f.id] = cursor + packed.laneTop[packed.laneOf[f.id]];
    });
  }

  return { epics: newEpics, featureYById };
}
