import { DONE_STATUS_ID, cyclesOf } from "./constants";
import type { Cycle, StatusDef } from "@/types";

/** A filter entry. `group` renders as a heading above its members. */
export interface FilterOption {
  id: string;
  name: string;
  color?: string;
  group?: string;
}

/**
 * The toolbar's status filter, grouped by cycle.
 *
 * The flat list this replaces was built by `allStatusesOf`, which dedupes by
 * **id** — and `copyCycleTemplate` deliberately gives every cycle its own stage
 * ids. So a Beat running Standard and Review listed "Planned" twice and "In
 * progress" twice, identical and unselectable apart. Grouping is what makes
 * each entry name exactly one stage.
 *
 * *Rejected: deduping the flat list by label.* It requires deciding that
 * "Planned" in Standard and "Planned" in Review are the same status, which is a
 * guess about meaning rather than a fact about the data, and it breaks the
 * moment someone renames one of them. The cross-cycle question — "what is
 * stalled anywhere?" — is what CY16's qualifications are for, and they mean
 * something where a shared label does not.
 */
export function statusFilterOptions(
  pulse: { cycles?: Cycle[]; statuses?: StatusDef[] } | null | undefined,
): FilterOption[] {
  const cycles = cyclesOf(pulse);

  // One cycle is the overwhelming majority of Beats, and a heading over the
  // only group is noise that says nothing. Flat, exactly as before.
  if (cycles.length <= 1) {
    return (cycles[0]?.statuses ?? []).map((s) => ({ id: s.id, name: s.label, color: s.color }));
  }

  const out: FilterOption[] = [];
  for (const cycle of cycles) {
    for (const s of cycle.statuses) {
      // Done is the one stage every cycle genuinely shares — one reserved id
      // across all of them (CY5). Listing it under each heading would offer the
      // same checkbox several times over, so it is held back and emitted once,
      // ungrouped, at the end.
      if (s.id === DONE_STATUS_ID) continue;
      out.push({ id: s.id, name: s.label, color: s.color, group: cycle.name });
    }
  }

  const done = cycles.flatMap((c) => c.statuses).find((s) => s.id === DONE_STATUS_ID);
  if (done) out.push({ id: done.id, name: done.label, color: done.color });
  return out;
}

/** The options in render order, bucketed by heading. Ungrouped entries keep
 * their position rather than being hoisted, so Done stays last. */
export function groupOptions(options: FilterOption[]): { group?: string; options: FilterOption[] }[] {
  const out: { group?: string; options: FilterOption[] }[] = [];
  for (const o of options) {
    const tail = out[out.length - 1];
    if (tail && tail.group === o.group) tail.options.push(o);
    else out.push({ group: o.group, options: [o] });
  }
  return out;
}

/**
 * Selecting a heading selects everything under it; selecting it again clears
 * them — but only the members, leaving any other group's selection alone.
 */
export function toggleGroup(selected: Set<string>, groupIds: string[]): Set<string> {
  const next = new Set(selected);
  const allOn = groupIds.every((id) => next.has(id));
  for (const id of groupIds) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}
