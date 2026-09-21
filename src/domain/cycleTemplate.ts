import { DONE_STATUS_ID } from "./constants";
import type { Cycle, Feature } from "@/types";

/**
 * Copy an organisation cycle template into a Beat (Cycles-Spec CY1).
 *
 * CY1 chose **copy, not reference**, for three reasons — permissions, blast
 * radius, and reads — and this function is where that choice is actually made.
 * Two places need it (the Beat's cycle manager, and Beat creation under CY4),
 * and two copies of it is how they end up disagreeing about something as easy
 * to get subtly wrong as which ids survive.
 *
 * **Ids are regenerated.** Keeping the template's would make two Beats' cycles
 * compare equal by id while being independently editable, and adding the same
 * template twice would collide outright.
 *
 * **`i18nKey` travels with the copy** (SCT3). A Beat's copy of a seeded
 * template is still a seeded template, so it is still translated. The spread
 * below carries it; the test pins it, because a later rewrite that listed
 * fields explicitly would drop it and every copied Beat would quietly revert
 * to English.
 *
 * **Except Done.** CY5 makes it a reserved, hard-coded status: ~30 call sites
 * compare against `DONE_STATUS_ID` to stamp `finishedAt`, lock the task, strike
 * the title and count it complete. A copy that renamed it to `st-…-3` would
 * produce a cycle whose last stage never locks and never counts as finished,
 * and nothing would report an error.
 */
export function copyCycleTemplate(tpl: Cycle, stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`): Cycle {
  return {
    ...tpl,
    id: `cy-${stamp}`,
    statuses: tpl.statuses.map((s, i) => ({
      ...s,
      id: s.id === DONE_STATUS_ID ? DONE_STATUS_ID : `st-${stamp}-${i}`,
    })),
  };
}

/**
 * What applying an epic's new cycle to its existing tasks would do
 * (Cycles-Spec CY3).
 *
 * CY3's offer "defaults to not", and the checkbox has to say *how many* tasks
 * it would move and *how many* statuses would be remapped — so this returns
 * both, not a count of "affected".
 *
 * **Done tasks are excluded.** CY2b forbids changing a completed task's cycle
 * at all: its workflow is part of the record of how it was completed. They are
 * returned separately rather than dropped, because the count shown says so —
 * "12 tasks (3 done, unchanged)" is honest where "12 tasks" is not.
 */
export interface EpicCycleApply {
  /** Tasks whose cycle would change. */
  moving: Feature[];
  /** Tasks in the epic that are done, and therefore will not move. */
  done: Feature[];
  /** Of `moving`, those whose current status the target cycle does not define
   * — they keep the id and show as unmapped (CY7) until someone resolves it. */
  orphaning: Feature[];
}

export function epicCycleApply(
  epicId: string,
  target: Cycle,
  features: Feature[],
  defaultCycleId: string,
  doneStatusId: string,
): EpicCycleApply {
  const known = new Set(target.statuses.map((s) => s.id));
  const inEpic = features.filter((f) => f.epicId === epicId);
  const done = inEpic.filter((f) => f.status === doneStatusId);
  // Already on the target cycle: moving them is a no-op, and counting them
  // would inflate the number the checkbox shows.
  const moving = inEpic.filter(
    (f) => f.status !== doneStatusId && (f.cycleId ?? defaultCycleId) !== target.id,
  );
  return { moving, done, orphaning: moving.filter((f) => !known.has(f.status)) };
}
