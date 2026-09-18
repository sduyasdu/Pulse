import type { Cycle, FeatureStatus, StatusDef, StatusQualification } from "@/types";

// Canvas layout constants — ported 1:1 from the prototype.
export const BASE_DAY_WIDTH = 26; // px per day at 100% in DAY view
export const RULER_HEIGHT = 46;
export const CONTENT_MIN_HEIGHT = 1300;
export const RES_LABEL_W = 320; // width of the resource-label column in the assignment panel

export type Density = "day" | "week" | "month";
export const DENSITY_DAY_PX: Record<Density, number> = { day: 1, week: 0.42, month: 0.14 };
export const DENSITY_HINT: Record<Density, string> = {
  day: "days shown; months banded above",
  week: "ISO weeks shown; months banded above",
  month: "months shown; years banded above",
};

export interface StatusMeta {
  border: string;
  bg: string;
  text: string;
  label: string;
}

// Hand-tuned palette for the four built-in statuses. Custom statuses derive
// their meta from a single colour via statusMetaOf().
export const STATUS_META: Record<string, StatusMeta> = {
  planned: { border: "#64748B", bg: "#EEF2F7", text: "#475569", label: "Planned" },
  "in-progress": { border: "#F5A524", bg: "#FFF6E2", text: "#92400E", label: "In progress" },
  blocked: { border: "#E5484D", bg: "#FDEBEC", text: "#9F1D23", label: "Blocked" },
  done: { border: "#12A594", bg: "#E6F7F4", text: "#0F6B5C", label: "Done" },
};

export const DONE_STATUS_ID = "done";

// The columns a Pulse gets until it customises its statuses (Pulse.statuses).
export const DEFAULT_STATUSES: StatusDef[] = [
  { id: "planned", label: "Planned", color: "#64748B", qualifies: "planned" },
  { id: "in-progress", label: "In progress", color: "#F5A524", qualifies: "ongoing" },
  { id: "blocked", label: "Blocked", color: "#E5484D", qualifies: "stalled" },
  { id: DONE_STATUS_ID, label: "Done", color: "#12A594" },
];

/**
 * The cycle templates a new workspace starts with (Cycles-Spec CY12).
 *
 * **Standard is first, and that is load-bearing.** CY4 takes "the
 * organisation's first cycle" as the pre-selection at Beat creation, and CY12
 * says Standard is what should be pre-selected — those agree only if Standard
 * leads. Order carries that meaning because the org editor has no default flag
 * (CY1: a flag governing nothing is a control that lies), so this is the only
 * place the intent can live.
 *
 * Standard is exactly `DEFAULT_STATUSES`. That is what makes CY11 an identity
 * for every existing Beat: a Beat that never customised its statuses resolves
 * to this cycle with nothing written.
 */
export const DEFAULT_ORG_CYCLES: Cycle[] = [
  { id: "cy-standard", name: "Standard", statuses: DEFAULT_STATUSES },
  {
    id: "cy-simple",
    name: "Simple",
    statuses: [
      { id: "planned", label: "Planned", color: "#64748B", qualifies: "planned" },
      { id: "in-progress", label: "In progress", color: "#F5A524", qualifies: "ongoing" },
      { id: DONE_STATUS_ID, label: "Done", color: "#12A594" },
    ],
  },
  {
    id: "cy-review",
    name: "Review",
    statuses: [
      { id: "planned", label: "Planned", color: "#64748B", qualifies: "planned" },
      { id: "in-progress", label: "In progress", color: "#F5A524", qualifies: "ongoing" },
      { id: "in-review", label: "In review", color: "#6366F1", qualifies: "ongoing" },
      { id: DONE_STATUS_ID, label: "Done", color: "#12A594" },
    ],
  },
];

/**
 * The qualifications a cycle stage may carry, in reporting order. `done` is
 * fourth and implicit — it is the terminal status, not a qualification
 * (Cycles-Spec CY5/CY16).
 */
export const STATUS_QUALIFICATIONS = [
  { id: "planned", order: 1, label: "Planned" },
  { id: "stalled", order: 2, label: "Stalled" },
  { id: "ongoing", order: 3, label: "Ongoing" },
] as const;

/** What the statuses that shipped before cycles have always meant. Keyed by the
 * ids in `DEFAULT_STATUSES`, so a Beat that never customised anything resolves
 * correctly with no data written (Cycles-Spec CY11). */
const BUILT_IN_QUALIFICATION: Record<string, StatusQualification> = {
  planned: "planned",
  "in-progress": "ongoing",
  blocked: "stalled",
};

/** Sort key for a resolved qualification, `done` included. */
export const QUALIFICATION_ORDER: Record<string, number> = { planned: 1, stalled: 2, ongoing: 3, done: 4 };

/**
 * What a status counts as, for anything summarising across cycles.
 *
 * Resolved in three steps, because a cycle author should not have to qualify
 * every stage for the common cases to work:
 *
 *  1. The terminal status is always `done`. Not overridable.
 *  2. An explicit `qualifies` wins.
 *  3. A built-in id keeps the meaning it has always had. This is what makes
 *     CY11's migration correct: every Beat that predates cycles has statuses
 *     with no `qualifies`, and without this step its `blocked` tasks would
 *     resolve to `ongoing` — silently reporting stalled work as underway.
 *     Found by looking at the prototype, where "Blocked" rendered as ONGOING.
 *  4. Otherwise infer from position: the first stage is work not yet started,
 *     so `planned`; anything else is work underway, so `ongoing`. A *custom*
 *     stage meaning "stalled" cannot be inferred and must say so — which is why
 *     the editor asks.
 */
export function qualificationOf(statusId: FeatureStatus, statuses: StatusDef[]): string {
  if (statusId === DONE_STATUS_ID) return "done";
  const i = statuses.findIndex((s) => s.id === statusId);
  if (i < 0) return "ongoing"; // orphaned status (CY7): it is not done, and it is not nothing
  const def = statuses[i];
  if (def.qualifies) return def.qualifies;
  const builtIn = BUILT_IN_QUALIFICATION[statusId];
  if (builtIn) return builtIn;
  return i === 0 ? "planned" : "ongoing";
}

// Colour palette offered when creating a custom status.
export const STATUS_COLORS = ["#64748B", "#F5A524", "#E5484D", "#12A594", "#6366F1", "#EC4899", "#0EA5E9", "#8B5CF6", "#22C55E", "#0F766E"];

/** The id of the single cycle computed for a Beat that has none. Written out
 * only when someone first edits cycles there (Cycles-Spec CY11). */
export const IMPLICIT_CYCLE_ID = "default";

/**
 * The Beat's workflows, resolved (Cycles-Spec CY11).
 *
 * A Beat that predates cycles has none, and is **not migrated in the database**
 * — its single cycle is computed from whatever `statusesOf` already resolves, so
 * a Beat that never customised statuses gets the built-in four and one that did
 * gets what it customised. The feature can therefore ship, and be reverted,
 * without having written to a customer's data.
 *
 * Mirrors what `statusesOf` does for statuses, deliberately: the same instinct,
 * one level up.
 */
export function cyclesOf(pulse: { cycles?: Cycle[]; statuses?: StatusDef[] } | null | undefined): Cycle[] {
  if (pulse?.cycles && pulse.cycles.length) return pulse.cycles;
  return [{ id: IMPLICIT_CYCLE_ID, name: "Standard", statuses: statusesOf(pulse) }];
}

/**
 * The cycle a task follows.
 *
 * Resolution is deliberately narrow: the task's own stamp, then the Beat's
 * default, then the first cycle. It never consults the task's epic — CY2
 * stamps at creation precisely so that moving a task between epics cannot
 * change its workflow.
 */
export function cycleOfTask(
  task: { cycleId?: string } | null | undefined,
  pulse: { cycles?: Cycle[]; statuses?: StatusDef[]; defaultCycleId?: string } | null | undefined,
): Cycle {
  const cycles = cyclesOf(pulse);
  const byId = task?.cycleId ? cycles.find((c) => c.id === task.cycleId) : undefined;
  if (byId) return byId;
  const fallback = pulse?.defaultCycleId ? cycles.find((c) => c.id === pulse.defaultCycleId) : undefined;
  return fallback ?? cycles[0];
}

/** The statuses a task may hold — its cycle's, not the Beat's whole vocabulary. */
export function statusesForTask(
  task: { cycleId?: string } | null | undefined,
  pulse: { cycles?: Cycle[]; statuses?: StatusDef[]; defaultCycleId?: string } | null | undefined,
): StatusDef[] {
  return cycleOfTask(task, pulse).statuses;
}

/** The status a newly created task starts in: the first stage of its cycle.
 * Replaces the hardcoded `"planned"`, which is only correct for the built-in
 * cycle (Cycles-Spec §6). */
export function initialStatusOf(cycle: Cycle): FeatureStatus {
  return cycle.statuses[0]?.id ?? "planned";
}

/** The effective, ordered status list for a Pulse (defaults when unset). */
export function statusesOf(pulse: { statuses?: StatusDef[] } | null | undefined): StatusDef[] {
  return pulse?.statuses && pulse.statuses.length ? pulse.statuses : DEFAULT_STATUSES;
}

/** Render meta for a status id. The four built-ins keep their hand-tuned
 * palette; a custom status derives bg/text from its colour; an unknown id
 * falls back to neutral grey — never undefined, so no call site can crash. */
export function statusMetaOf(id: FeatureStatus, statuses?: StatusDef[]): StatusMeta {
  const def = statuses?.find((s) => s.id === id);
  const base = STATUS_META[id];
  if (base) {
    // Built-in statuses keep their hand-tuned palette, but must honour a
    // renamed label and a recoloured swatch from the Pulse's status list —
    // otherwise the board columns ignore edits made in the status editor.
    if (!def) return base;
    const recoloured = def.color && def.color !== base.border;
    return {
      ...base,
      label: def.label || base.label,
      ...(recoloured ? { border: def.color, bg: hexA(def.color, 0.14) } : {}),
    };
  }
  const color = def?.color || "#64748B";
  return { border: color, bg: hexA(color, 0.14), text: "#334155", label: def?.label || id };
}

/**
 * A status id resolved in the vocabulary of the cycle that owns it
 * (Cycles-Spec CY11).
 *
 * Replaces `statusMetaOf(x.status, statusesOf(pulse))`, which resolved every
 * task against the *Beat's* status list. That is right only while a Beat has
 * one cycle: with two, a task in Review rendered its stage against Standard's
 * list, found nothing, and fell through to the grey "unknown status" branch —
 * a correct-looking grey chip labelled with a raw id.
 *
 * `owner` is the task whose cycle governs, which is not always the thing being
 * rendered: a subtask has a `status` but no `cycleId` of its own, and follows
 * its parent's cycle. Passing the subtask as its own owner would resolve it
 * against the Beat default and reintroduce exactly the bug this removes.
 */
/**
 * Every stage any cycle in the Beat defines, in cycle order, deduped by id
 * (Cycles-Spec CY11).
 *
 * For the Beat-wide *filter* dropdowns only, which are a different question
 * from "what may this task be set to": a filter offering only the default
 * cycle's stages cannot express "show me everything in review", so the work in
 * every other cycle becomes unreachable through it. Never use this to populate
 * a status picker — that is `statusesForTask`, and offering a task a stage from
 * another cycle's list is how a task ends up in a status its workflow does not
 * contain.
 *
 * Deduped by id because cycles share `done`, and every cycle that was cloned
 * from another shares more than that.
 */
export function allStatusesOf(
  pulse: { cycles?: Cycle[]; statuses?: StatusDef[] } | null | undefined,
): StatusDef[] {
  const seen = new Map<string, StatusDef>();
  for (const cycle of cyclesOf(pulse)) {
    for (const s of cycle.statuses) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  return [...seen.values()];
}

export function statusMetaInCycle(
  status: FeatureStatus,
  owner: { cycleId?: string } | null | undefined,
  pulse: { cycles?: Cycle[]; statuses?: StatusDef[]; defaultCycleId?: string } | null | undefined,
): StatusMeta {
  return statusMetaOf(status, statusesForTask(owner, pulse));
}

export const AVATAR_COLORS = ["#6366F1", "#EC4899", "#14B8A6", "#F59E0B", "#8B5CF6", "#0EA5E9"];

export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export interface LabelColorOption {
  id: string;
  color: string | null;
  name: string;
}

export const LABEL_COLORS: LabelColorOption[] = [
  { id: "none", color: null, name: "None" },
  { id: "violet", color: "#8B5CF6", name: "Violet" },
  { id: "blue", color: "#3B82F6", name: "Blue" },
  { id: "teal", color: "#14B8A6", name: "Teal" },
  { id: "green", color: "#22C55E", name: "Green" },
  { id: "amber", color: "#F59E0B", name: "Amber" },
  { id: "rose", color: "#F43F5E", name: "Rose" },
  { id: "slate", color: "#64748B", name: "Slate" },
];

export const EPIC_PALETTE = ["#8B5CF6", "#3B82F6", "#14B8A6", "#22C55E", "#F59E0B", "#F43F5E", "#0EA5E9"];

/** hex (#rrggbb) + alpha -> rgba() string */
export function hexA(hex: string | null | undefined, a: number): string {
  if (!hex) return `rgba(100,116,139,${a})`;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
