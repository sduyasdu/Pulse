import type { Cycle, Epic, Feature } from "@/types";
import { buildBoard, type StatusColumn } from "./kanban";
import { DONE_STATUS_ID } from "./constants";

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
  /** Columns in the widest section, terminal included.
   *
   * The terminal column is pinned to the right edge of every section and the
   * rest share what is left, so Done lines up down the page and no section
   * trails off into blank space. The renderer achieves that with flex — a
   * fixed-width terminal column last, the others `flex: 1` — so this number is
   * not needed to align anything. It is here because a section with one
   * non-terminal column would otherwise stretch it across the whole board, and
   * a sensible maximum needs to know what "whole board" means. */
  slots: number;
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
  /**
   * Where a task with no `cycleId` belongs (CY11).
   *
   * This must be the Beat's `defaultCycleId`, not `cycles[0]`: `cycleOfTask`
   * resolves an unstamped task through `defaultCycleId`, so a Beat whose
   * default is not the first cycle in the list would group its legacy tasks in
   * one section while rendering their statuses from another. Every task created
   * before cycles shipped is unstamped, so that is not a corner case — it is
   * every existing Beat, the moment someone makes a second cycle the default.
   *
   * Defaulted rather than required so the many call sites that have exactly one
   * cycle need not thread it; with one cycle the two agree by definition.
   */
  defaultCycleId?: string,
): CycleBoard {
  const known = new Map(cycles.map((c) => [c.id, c]));
  const fallback = (defaultCycleId ? cycles.find((c) => c.id === defaultCycleId) : undefined) ?? cycles[0];
  if (!fallback) return { grouped: false, sections: [], slots: 0 };

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

  const slots = sections.reduce((m, sec) => Math.max(m, sec.columns.length), 0);

  if (orphans.length) {
    sections.push({
      cycleId: ORPHAN_SECTION,
      name: "Unknown cycle",
      count: orphans.length,
      columns: buildBoard(orphans, epics, fallback.statuses, false),
    });
  }
  return { grouped, sections, slots: Math.max(slots, sections.reduce((m, sec) => Math.max(m, sec.columns.length), 0)) };
}

/**
 * Does this task pass a cycle filter? (Cycles-Spec CY13.)
 *
 * Mirrors the canvas's other filters exactly — `size === 0` means "no filter",
 * not "match nothing" (`CanvasView.tsx:308-309`). A task with no `cycleId`
 * counts as the Beat's default, because that is what it resolves to everywhere
 * else; filtering it out would hide every task created before cycles shipped.
 */
export function matchesCycleFilter(
  task: { cycleId?: string },
  filter: Set<string>,
  defaultCycleId: string,
): boolean {
  if (filter.size === 0) return true;
  return filter.has(task.cycleId ?? defaultCycleId);
}

/**
 * Which section a task is currently drawn in, or null if the board has none.
 *
 * Exists so the board can refuse a drop that crosses sections. Dragging a card
 * from one cycle's row into another's would change the task's workflow, and
 * CY2a says a cycle never changes on its own — a drag is a scheduling gesture,
 * and changing a cycle is a deliberate act on the task itself (CY2b).
 */
export function sectionOfTask(board: CycleBoard, taskId: string): CycleSection | null {
  for (const section of board.sections) {
    for (const col of section.columns) {
      for (const group of col.groups) {
        if (group.tasks.some((t) => t.id === taskId)) return section;
      }
    }
  }
  return null;
}

/**
 * May this task be dropped into this section?
 *
 * A task the board cannot place — filtered out, or arrived mid-drag — is
 * allowed: refusing a drop on the strength of not finding the card is worse
 * than permitting one.
 *
 * There is deliberately no `if (!board.grouped) return true` short-circuit. It
 * reads like a sensible guard and is unreachable: an ungrouped board has one
 * section, the caller passes that section's own id, so the comparison below
 * already answers true. A mutation removing it changed no test result, which is
 * the tell for a branch that cannot be exercised rather than one that is
 * under-tested.
 */
export function canDropInSection(board: CycleBoard, taskId: string, targetCycleId: string): boolean {
  const home = sectionOfTask(board, taskId);
  return home === null || home.cycleId === targetCycleId;
}
/**
 * Where each visible column sits in the section's grid (Cycles-Spec CY14).
 *
 * Every column is the same width and packed to the left; the terminal column is
 * pinned to the widest cycle's last slot. So Done lines up down the page across
 * sections, and a cycle with fewer stages shows the gap it has rather than
 * stretching to fill it — the gap is information: that cycle is shorter.
 *
 * `slots` comes from the board, not from this section, which is the whole point:
 * a section placing Done by its own length would put it wherever that section
 * happened to end, and nothing would align.
 *
 * Takes the columns *after* the status filter has run, so hiding a stage closes
 * the gap on the left while Done stays where it was.
 */
export function placeColumns(
  columns: StatusColumn[],
  slots: number,
): { col: StatusColumn; slot: number }[] {
  // A running counter rather than the array index. With Done always last the
  // two agree — a mutation swapping them fails nothing — so this is a claim
  // about robustness, not a behaviour: it stays correct if a terminal column
  // ever appears anywhere but the end.
  let next = 1;
  return columns.map((col) => ({
    col,
    // Clamped because CSS grid has no column 0, and a board with no sections
    // reports slots 0. Two columns would then collide in slot 1; that board has
    // no columns to collide.
    slot: col.status === DONE_STATUS_ID ? Math.max(slots, 1) : next++,
  }));
}
