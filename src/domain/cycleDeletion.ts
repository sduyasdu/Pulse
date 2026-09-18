import { DONE_STATUS_ID } from "./constants";
import type { Epic, Feature } from "@/types";

/**
 * What stops a cycle being deleted (Cycles-Spec CY17).
 *
 * A cycle in use is not deletable, and the answer is not to ask "are you sure?"
 * — it is to say precisely what is holding it and let the person clear those.
 * The same shape as the account-deletion audit (SF15) and the status-delete rule
 * (CY7): enumerate the obstacles before doing anything, so the decision is made
 * on the whole picture rather than half-way through.
 *
 * Three things can hold a cycle, and they need different resolutions:
 */
export interface CycleDeletionBlockers {
  /** Tasks whose cycle can be reassigned — the ordinary case. */
  reassignable: { id: string; title: string }[];
  /**
   * Tasks that are done.
   *
   * CY2b forbids changing a completed task's cycle: its workflow is part of the
   * record of how it was completed. So these cannot be reassigned, and the only
   * ways past them are to reopen the task or delete it. Listed separately
   * because telling someone to "reassign these" when the app will refuse is
   * worse than not listing them.
   */
  doneTasks: { id: string; title: string }[];
  /** Epics that would stamp new tasks with a cycle that no longer exists. */
  epics: { id: string; name: string }[];
  /** The Beat's default. Another must be chosen first — there is always one. */
  isBeatDefault: boolean;
  deletable: boolean;
}

/**
 * `defaultCycleId` matters because a task with no `cycleId` resolves to it
 * everywhere else (CY11). Deleting the default without counting those tasks
 * would orphan every task that predates cycles.
 */
export function cycleDeletionBlockers(
  cycleId: string,
  features: Feature[],
  epics: Epic[],
  defaultCycleId: string,
): CycleDeletionBlockers {
  const isBeatDefault = cycleId === defaultCycleId;

  const using = features.filter((f) => (f.cycleId ?? defaultCycleId) === cycleId);
  const reassignable: { id: string; title: string }[] = [];
  const doneTasks: { id: string; title: string }[] = [];
  for (const f of using) {
    const row = { id: f.id, title: f.title || "Untitled task" };
    if (f.status === DONE_STATUS_ID) doneTasks.push(row);
    else reassignable.push(row);
  }

  const boundEpics = epics
    .filter((e) => (e as Epic & { cycleId?: string }).cycleId === cycleId)
    .map((e) => ({ id: e.id, name: e.name || "Untitled epic" }));

  return {
    reassignable,
    doneTasks,
    epics: boundEpics,
    isBeatDefault,
    deletable: !isBeatDefault && using.length === 0 && boundEpics.length === 0,
  };
}

/**
 * Which tasks a stage deletion would strand (Cycles-Spec CY7).
 *
 * CY7 forbids deleting a status tasks still hold "without first asking what to
 * remap them to" — so this returns the tasks, not a boolean. The caller has to
 * name them to ask the question.
 *
 * Scoped to the cycle: the same status id can exist in two cycles (every cycle
 * has `done`, and a cloned cycle shares more), and deleting Standard's
 * "Blocked" must not count the tasks sitting in Review's.
 *
 * A task with no `cycleId` counts as the Beat's default, as everywhere else —
 * otherwise deleting a stage from the default cycle would report zero tasks
 * while stranding every task that predates cycles.
 */
export function tasksHoldingStage(
  cycleId: string,
  statusId: string,
  features: Feature[],
  defaultCycleId: string,
): Feature[] {
  return features.filter(
    (f) => (f.cycleId ?? defaultCycleId) === cycleId && f.status === statusId,
  );
}
