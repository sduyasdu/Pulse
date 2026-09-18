import { DONE_STATUS_ID } from "./constants";
import type { Cycle } from "@/types";

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
