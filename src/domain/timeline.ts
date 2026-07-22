// Timeline tick generation for the canvas ruler and the assignment panel's
// mini-ruler — both render against the same (density, startDay, endDay)
// window, so this lives here once rather than being duplicated per view.
import type { Density } from "./constants";
import { dateForDay, dayIndex } from "./dateUtils";

export interface TimelinePrimary {
  left: number;
  right: number;
  label: string;
}
export interface TimelineSecondary {
  day: number;
  label: string;
}
export interface Period {
  start: number;
  end: number;
  label: string;
}

export function buildTimeline(density: Density, startDay: number, endDay: number): { primary: TimelinePrimary[]; secondary: TimelineSecondary[] } {
  const primary: TimelinePrimary[] = [];
  const secondary: TimelineSecondary[] = [];
  let guard = 0;

  if (density === "day") {
    let d = dateForDay(startDay);
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    while (dayIndex(d) < endDay && guard < 80) {
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      primary.push({ left: dayIndex(d), right: dayIndex(next), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) });
      d = next;
      guard++;
    }
    for (let day = startDay; day <= endDay; day++) {
      secondary.push({ day, label: dateForDay(day).toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" }) });
    }
  } else if (density === "week") {
    let d = dateForDay(startDay);
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    while (dayIndex(d) < endDay && guard < 80) {
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      primary.push({
        left: dayIndex(d),
        right: dayIndex(next),
        label: d.toLocaleDateString("en-US", { month: "long", year: d.getUTCMonth() === 0 ? "numeric" : undefined, timeZone: "UTC" }),
      });
      d = next;
      guard++;
    }
    let mon = dateForDay(startDay);
    const shift = (mon.getUTCDay() + 6) % 7;
    mon = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() - shift));
    let g2 = 0;
    while (dayIndex(mon) <= endDay && g2 < 90) {
      // Day only — the month is shown in the primary (month) row above.
      secondary.push({ day: dayIndex(mon), label: String(mon.getUTCDate()) });
      mon = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 7));
      g2++;
    }
  } else {
    let d = dateForDay(startDay);
    d = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    while (dayIndex(d) < endDay && guard < 40) {
      const next = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
      primary.push({ left: dayIndex(d), right: dayIndex(next), label: String(d.getUTCFullYear()) });
      d = next;
      guard++;
    }
    let m = dateForDay(startDay);
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1));
    let g2 = 0;
    while (dayIndex(m) < endDay && g2 < 80) {
      secondary.push({ day: dayIndex(m), label: m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      g2++;
    }
  }
  return { primary, secondary };
}

export function buildPeriods(density: Density, startDay: number, endDay: number): Period[] {
  const out: Period[] = [];
  if (density === "day") {
    for (let day = startDay; day <= endDay; day++) {
      out.push({ start: day, end: day + 1, label: dateForDay(day).toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" }) });
    }
  } else if (density === "week") {
    let mon = dateForDay(startDay);
    const shift = (mon.getUTCDay() + 6) % 7;
    mon = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() - shift));
    let g = 0;
    while (dayIndex(mon) <= endDay && g < 90) {
      const s = dayIndex(mon);
      out.push({ start: s, end: s + 7, label: `${mon.getUTCDate()}/${mon.getUTCMonth() + 1}` });
      mon = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 7));
      g++;
    }
  } else {
    let m = dateForDay(startDay);
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1));
    let g = 0;
    while (dayIndex(m) < endDay && g < 80) {
      const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      out.push({ start: dayIndex(m), end: dayIndex(next), label: m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
      m = next;
      g++;
    }
  }
  return out;
}
