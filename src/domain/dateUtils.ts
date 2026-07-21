// Day-index <-> calendar-date conversion for the canvas's x-axis.
//
// The prototype anchored day 0 to "today" recomputed on every page load —
// harmless for an in-memory demo, but it means a box's stored `x` (an
// integer day offset) would point at a different real calendar date every
// time the app was reopened on a different day. Once box positions are
// persisted in Firestore, `x` must be stable, so we anchor to a fixed epoch
// instead. All interaction math (drag deltas, timeline ticks, etc.) is
// unaffected — only what "day 0" means changes.
export const DAY_MS = 86_400_000;
export const EPOCH_MS = Date.UTC(2020, 0, 1);

/** The calendar date (UTC midnight) for a given day-index. */
export function dateForDay(day: number): Date {
  return new Date(EPOCH_MS + day * DAY_MS);
}

/** The day-index for a given Date, using its local Y/M/D as the calendar day
 * (so "today" reflects the viewer's own calendar) but computed via UTC epoch
 * arithmetic (so no DST-related off-by-one). */
export function dayIndex(date: Date): number {
  const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utcMidnight - EPOCH_MS) / DAY_MS);
}

export function todayIndex(): number {
  return dayIndex(new Date());
}

/** 0=Sun..6=Sat */
export function dayOfWeek(day: number): number {
  return dateForDay(day).getUTCDay();
}

export function isWeekend(day: number): boolean {
  const w = dayOfWeek(day);
  return w === 0 || w === 6;
}

/** Working days within a calendar span [startDay, startDay+span). */
export function businessInSpan(startDay: number, span: number): number {
  let c = 0;
  for (let d = 0; d < span; d++) if (!isWeekend(startDay + d)) c++;
  return c;
}

/** Calendar span needed to fit `businessDays` working days from startDay.
 * If useWeekends is true, weekends count as working days (span === businessDays). */
export function businessToSpan(startDay: number, businessDays: number, useWeekends: boolean): number {
  const need = Math.max(1, Math.ceil(businessDays));
  if (useWeekends) return need;
  let counted = 0;
  let span = 0;
  while (counted < need && span < 4000) {
    if (!isWeekend(startDay + span)) counted++;
    span++;
  }
  return Math.max(1, span);
}

export function fmtDate(day: number): string {
  return dateForDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** `YYYY-MM-DD` for an `<input type="date">` value, read via UTC getters
 * (dateForDay anchors at UTC midnight — local getters would shift the
 * calendar day by one in timezones behind UTC, the same class of bug
 * dayIndex() works around for the opposite direction). */
export function toDateInputValue(day: number): string {
  const d = dateForDay(day);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Inverse of toDateInputValue — parses the "YYYY-MM-DD" string's
 * components directly rather than going through `new Date(value)` +
 * dayIndex(), which would reintroduce the same local-timezone hazard. */
export function dayIndexFromDateInputValue(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_MS) / DAY_MS);
}
