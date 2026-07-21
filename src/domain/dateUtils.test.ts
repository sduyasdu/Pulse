import { describe, expect, it } from "vitest";
import {
  businessInSpan,
  businessToSpan,
  dateForDay,
  dayIndex,
  dayIndexFromDateInputValue,
  dayOfWeek,
  isWeekend,
  toDateInputValue,
} from "./dateUtils";

// EPOCH_MS anchors day 0 to 2020-01-01 UTC, a Wednesday.
describe("dateUtils", () => {
  it("day 0 is a Wednesday", () => {
    expect(dayOfWeek(0)).toBe(3);
  });

  it("flags Saturday and Sunday as weekends", () => {
    expect(isWeekend(0)).toBe(false); // Wed
    expect(isWeekend(1)).toBe(false); // Thu
    expect(isWeekend(2)).toBe(false); // Fri
    expect(isWeekend(3)).toBe(true); // Sat
    expect(isWeekend(4)).toBe(true); // Sun
    expect(isWeekend(5)).toBe(false); // Mon
    expect(isWeekend(6)).toBe(false); // Tue
  });

  it("businessInSpan counts working days in a 7-day span with one weekend", () => {
    expect(businessInSpan(0, 7)).toBe(5);
  });

  it("businessInSpan counts every day when the span has no weekend", () => {
    expect(businessInSpan(0, 3)).toBe(3); // Wed, Thu, Fri
  });

  it("businessToSpan is the inverse of businessInSpan across a weekend", () => {
    expect(businessToSpan(0, 5, false)).toBe(7);
  });

  it("businessToSpan returns the raw day count when useWeekends is true", () => {
    expect(businessToSpan(0, 5, true)).toBe(5);
  });

  it("businessToSpan floors to at least 1 day", () => {
    expect(businessToSpan(0, 0, false)).toBe(1);
  });

  it("dayIndex/dateForDay round-trip to the same calendar day", () => {
    const d = new Date(2020, 5, 15); // local calendar day: 2020-06-15
    const back = dateForDay(dayIndex(d));
    expect([back.getUTCFullYear(), back.getUTCMonth(), back.getUTCDate()]).toEqual([2020, 5, 15]);
  });

  it("toDateInputValue formats day 0 as the epoch date", () => {
    expect(toDateInputValue(0)).toBe("2020-01-01");
  });

  it("dayIndexFromDateInputValue/toDateInputValue round-trip regardless of local timezone", () => {
    expect(dayIndexFromDateInputValue("2020-01-01")).toBe(0);
    expect(dayIndexFromDateInputValue(toDateInputValue(2386))).toBe(2386);
  });
});
