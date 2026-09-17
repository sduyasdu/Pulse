import type { Cycle, Epic, Feature } from "@/types";
import { buildBoard, type StatusColumn } from "./kanban";

/**
 * The board, grouped by cycle (Cycles-Spec §8, open question 3 — prototype).
 *
 * With one status list, the board is one row of columns. With several cycles in
 * a Beat, three arrangements were on the table:
 *
 *   - a **union** of every cycle's columns, which invents columns that are
 *     meaningless for most cards and puts "In review" next to "Blocked" as if a
 *     task could be in either;
 *   - a **filter** to one cycle at a time, which hides work and makes "what is
 *     the state of this Beat" unanswerable at a glance;
 *   - **grouping**: one band per cycle, each with its own columns.
 *
 * Grouping is what this builds. It is the only one where every column means
 * exactly one thing and no task is hidden.
 */
export interface CycleSection {
  cycleId: string;
  name: string;
  /** This cycle's own columns, in its own status order. */
  columns: StatusColumn[];
  /** Tasks in this cycle, across every column. Drives the section header. */
  count: number;
}

export interface CycleBoard {
  /** False when one cycle covers everything — render exactly as today, no
   * section headers, no visual change for the overwhelming majority of Beats. */
  grouped: boolean;
  sections: CycleSection[];
}

/**
 * A task whose `cycleId` names a cycle the Beat no longer defines.
 *
 * Kept visible rather than dropped, for the reason §4 (CY7) gives about orphaned
 * statuses: silently hiding work is worse than showing it awkwardly. It lands in
 * a trailing section built from the Beat's default cycle, so its status still
 * renders somewhere.
 */
const ORPHAN_SECTION = "__orphan__";

export function buildCycleBoard(
  features: Feature[],
  epics: Epic[],
  cycles: Cycle[],
  includeEmptyEpics = true,
): CycleBoard {
  const known = new Map(cycles.map((c) => [c.id, c]));
  const fallback = cycles[0];
  if (!fallback) return { grouped: false, sections: [] };

  // Which cycles actually have tasks. A Beat may define five and use two; five
  // section headers for two used workflows is noise.
  const byCycle = new Map<string, Feature[]>();
  for (const f of features) {
    const id = f.cycleId && known.has(f.cycleId) ? f.cycleId : f.cycleId ? ORPHAN_SECTION : fallback.id;
    const list = byCycle.get(id);
    if (list) list.push(f);
    else byCycle.set(id, [f]);
  }

  const used = cycles.filter((c) => (byCycle.get(c.id)?.length ?? 0) > 0);
  const orphans = byCycle.get(ORPHAN_SECTION) ?? [];

  // One cycle in play (and nothing orphaned) is today's board. Say so, so the
  // renderer can skip the section chrome entirely rather than drawing a single
  // header around everything.
  const grouped = used.length + (orphans.length ? 1 : 0) > 1;

  // When not grouped, the single section must still contain every task —
  // including ones whose cycleId is unset — so fall back to the whole list
  // rather than to `byCycle`, which splits them.
  const sections: CycleSection[] = (used.length ? used : [fallback]).map((c) => {
    const inCycle = grouped ? (byCycle.get(c.id) ?? []) : features;
    return {
      cycleId: c.id,
      name: c.name,
      count: inCycle.length,
      columns: buildBoard(inCycle, epics, c.statuses, includeEmptyEpics),
    };
  });

  if (orphans.length) {
    sections.push({
      cycleId: ORPHAN_SECTION,
      name: "Unknown cycle",
      count: orphans.length,
      columns: buildBoard(orphans, epics, fallback.statuses, false),
    });
  }
  return { grouped, sections };
}
