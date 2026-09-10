import { describe, expect, it } from "vitest";
import { loadColor, loadPctInWindow, loadWindows, overLimitCount } from "./assignments";
import type { Feature, Resource } from "@/types";

/**
 * These were declared inline in BOTH the Team and Capacity tabs, character for
 * character — which is how two tabs claiming to answer different questions came
 * to show the identical thing, and why they could be merged.
 */

const person = (id: string, capacity = 100): Resource => ({ id, name: id, initials: id.toUpperCase(), capacity }) as Resource;

/** One task spanning `[x, x+duration)` with `pct` of one person's day. */
const task = (id: string, resourceId: string, x: number, duration: number, pct = 100): Feature =>
  ({ id, title: id, x, duration, y: 0, work: 1, status: "planned", resources: [resourceId], alloc: { [resourceId]: pct } }) as unknown as Feature;

describe("the three forward windows", () => {
  it("starts today and runs twelve weeks", () => {
    const w = loadWindows(1000);
    expect(w).toHaveLength(3);
    expect(w[0].lo).toBe(1000);
    expect(w[2].hi).toBe(1084);
  });

  it("leaves no gap and no overlap between them", () => {
    const w = loadWindows(1000);
    expect(w[0].hi).toBe(w[1].lo);
    expect(w[1].hi).toBe(w[2].lo);
  });

  it("moves with today rather than being fixed", () => {
    expect(loadWindows(2000)[0].lo - loadWindows(1000)[0].lo).toBe(1000);
  });
});

describe("load as a share of a person's own limit", () => {
  it("is zero for someone with no work", () => {
    expect(loadPctInWindow([], person("a"), 0, 28)).toBe(0);
  });

  // The limit is the denominator: the same work is heavier for someone who is
  // only meant to be half-time on this Pulse.
  it("reads against the person's limit, not against 100%", () => {
    const work = [task("t", "a", 0, 28, 50)];
    expect(loadPctInWindow(work, person("a", 100), 0, 28)).toBe(50);
    expect(loadPctInWindow(work, person("a", 50), 0, 28)).toBe(100);
  });

  it("treats a zero limit as 100 rather than dividing by zero", () => {
    const v = loadPctInWindow([task("t", "a", 0, 28, 50)], person("a", 0), 0, 28);
    expect(Number.isFinite(v)).toBe(true);
  });

  // A wild over-assignment must not stretch the bar's layout.
  it("caps at 999", () => {
    const many = Array.from({ length: 40 }, (_, i) => task(`t${i}`, "a", 0, 28, 100));
    expect(loadPctInWindow(many, person("a"), 0, 28)).toBe(999);
  });
});

describe("what the colour means", () => {
  it("is red past the limit", () => {
    expect(loadColor(101)).toBe("#E5484D");
    expect(loadColor(999)).toBe("#E5484D");
  });

  it("is green in the healthy band, including exactly at the limit", () => {
    expect(loadColor(50)).toBe("#12A594");
    expect(loadColor(100)).toBe("#12A594");
  });

  // Amber for UNDER-use is easy to misread as a warning about being busy. It is
  // the opposite: capacity nobody has planned for.
  it("is amber below half, including for nothing at all", () => {
    expect(loadColor(49)).toBe("#F5A524");
    expect(loadColor(0)).toBe("#F5A524");
  });
});

describe("the number the bell raises", () => {
  it("is zero when everyone is within their limit", () => {
    expect(overLimitCount([task("t", "a", 0, 10, 80)], [person("a")])).toBe(0);
  });

  it("counts only people past their own limit", () => {
    const work = [task("t1", "a", 0, 10, 150), task("t2", "b", 0, 10, 80)];
    expect(overLimitCount(work, [person("a"), person("b")])).toBe(1);
  });

  it("counts each person once however many tasks overload them", () => {
    const work = [task("t1", "a", 0, 10, 150), task("t2", "a", 20, 10, 150)];
    expect(overLimitCount(work, [person("a")])).toBe(1);
  });

  it("is zero for a Pulse with no people", () => {
    expect(overLimitCount([], [])).toBe(0);
  });

  // Exactly at the limit is not over it — the bell should not nag someone who
  // has planned perfectly.
  it("does not count someone exactly at their limit", () => {
    expect(overLimitCount([task("t", "a", 0, 10, 100)], [person("a", 100)])).toBe(0);
  });
});
