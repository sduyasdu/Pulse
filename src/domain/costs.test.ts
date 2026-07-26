import { describe, expect, it } from "vitest";
import {
  MICROS,
  amountOf,
  bucketEntries,
  buildCostTree,
  dollarsToMicros,
  fmtMoney,
  fmtQuantity,
  prorateToDays,
  spanOf,
  unitCostOf,
} from "./costs";
import { AI_COST_TYPE } from "./costTypes";
import { dayIndex, isWeekend } from "./dateUtils";
import type { CostEntry, Feature } from "@/types";

// A Monday, so the weekend arithmetic below is easy to reason about.
const MON = dayIndex(new Date(2024, 0, 1));

const feature = (over: Partial<Feature> = {}): Feature => ({
  id: "f1",
  title: "Task",
  x: MON,
  y: 0,
  duration: 5,
  status: "planned",
  resources: [],
  ...over,
});

const entry = (over: Partial<CostEntry> = {}): CostEntry => ({
  id: "c1",
  typeId: "ai",
  featureId: "f1",
  quantities: { tokens: 1_240_000 },
  basis: "amount",
  amountMicros: dollarsToMicros(412),
  currency: "USD",
  attrs: { brand: "anthropic", model: "claude-opus-5", resourceId: "r1" },
  createdBy: "u1",
  createdAt: 0,
  ...over,
});

const byId = (f: Feature) => ({ [f.id]: f });
const typeById = () => AI_COST_TYPE;

describe("derivation (spec §3)", () => {
  it("amount basis stores the money and derives the unit cost per 1M tokens", () => {
    const e = entry();
    expect(amountOf(e, AI_COST_TYPE)).toBe(412 * MICROS);
    // $412 over 1.24M tokens
    expect(unitCostOf(e, AI_COST_TYPE, "tokens")).toBeCloseTo(332.258, 3);
  });

  it("returns a null unit cost at zero quantity, not zero or Infinity", () => {
    const e = entry({ quantities: { tokens: 0 } });
    expect(unitCostOf(e, AI_COST_TYPE, "tokens")).toBeNull();
    // ...while the amount still counts.
    expect(amountOf(e, AI_COST_TYPE)).toBe(412 * MICROS);
  });

  it("rate basis derives the amount from quantity × unit cost", () => {
    const e = entry({ basis: "rate", quantities: { tokens: 2_000_000 }, unitCosts: { tokens: 15 }, amountMicros: 0 });
    expect(amountOf(e, AI_COST_TYPE)).toBe(30 * MICROS); // 2M tokens at $15/Mtok
  });
});

describe("span resolution (spec §5.1)", () => {
  it("prefers an explicit range, then a point date, then the task's span", () => {
    expect(spanOf(entry({ spanStart: 10, spanEnd: 14, at: 99 }), feature())).toEqual({ start: 10, end: 14 });
    expect(spanOf(entry({ at: 99 }), feature())).toEqual({ start: 99, end: 100 });
    expect(spanOf(entry(), feature({ x: 40, duration: 3 }))).toEqual({ start: 40, end: 43 });
  });

  it("is null when the parent task is missing and the entry has no dates", () => {
    expect(spanOf(entry(), undefined)).toBeNull();
  });
});

describe("proration (spec §5.2)", () => {
  it("spreads a task total across working days only", () => {
    const f = feature({ x: MON, duration: 7 }); // Mon–Sun
    const days = prorateToDays(entry({ amountMicros: 5 * MICROS }), f, AI_COST_TYPE);
    expect(days.size).toBe(5); // weekend excluded
    Array.from(days.keys()).forEach((d) => expect(isWeekend(d)).toBe(false));
  });

  it("includes weekends when the task says so", () => {
    const f = feature({ x: MON, duration: 7, useWeekends: true });
    expect(prorateToDays(entry(), f, AI_COST_TYPE).size).toBe(7);
  });

  it("falls back to calendar days rather than dropping money on a weekend-only span", () => {
    const sat = MON + 5;
    const days = prorateToDays(entry({ spanStart: sat, spanEnd: sat + 2 }), feature(), AI_COST_TYPE);
    expect(days.size).toBe(2);
    expect(Array.from(days.values()).reduce((a, b) => a + b, 0)).toBe(412 * MICROS);
  });

  it("puts a point cost entirely in one day", () => {
    const days = prorateToDays(entry({ at: MON + 1 }), feature(), AI_COST_TYPE);
    expect(days.size).toBe(1);
    expect(days.get(MON + 1)).toBe(412 * MICROS);
  });

  it("conserves the total exactly when it does not divide evenly", () => {
    // $100 over 23 working days — the case floats would drift on.
    const f = feature({ x: MON, duration: 31, useWeekends: true });
    const e = entry({ amountMicros: 100 * MICROS });
    const days = prorateToDays(e, f, AI_COST_TYPE);
    const summed = Array.from(days.values()).reduce((a, b) => a + b, 0);
    expect(summed).toBe(100 * MICROS);
    expect(Number.isInteger(summed)).toBe(true);
  });
});

describe("bucketing into periods (spec §6.2)", () => {
  const periods = [
    { start: MON, end: MON + 7 },
    { start: MON + 7, end: MON + 14 },
  ];

  it("splits money across the periods it spans", () => {
    const f = feature({ x: MON, duration: 14, useWeekends: true });
    const b = bucketEntries([entry({ amountMicros: 14 * MICROS })], byId(f), typeById, periods);
    expect(b.cells).toEqual([7 * MICROS, 7 * MICROS]);
    expect(b.total).toBe(14 * MICROS);
  });

  it("counts money outside the window separately, and keeps the total all-time", () => {
    const f = feature({ x: MON - 10, duration: 2, useWeekends: true });
    const b = bucketEntries([entry({ amountMicros: 50 * MICROS })], byId(f), typeById, periods);
    expect(b.cells).toEqual([0, 0]);
    expect(b.before).toBe(50 * MICROS);
    expect(b.after).toBe(0);
    // CO11: the total ignores the visible window entirely.
    expect(b.total).toBe(50 * MICROS);
  });

  it("splits a span straddling the window edge", () => {
    const f = feature({ x: MON - 2, duration: 4, useWeekends: true }); // 2 days before, 2 inside
    const b = bucketEntries([entry({ amountMicros: 4 * MICROS })], byId(f), typeById, periods);
    expect(b.before).toBe(2 * MICROS);
    expect(b.cells[0]).toBe(2 * MICROS);
    expect(b.before + b.cells[0] + b.cells[1] + b.after).toBe(b.total);
  });
});

describe("row tree (spec §6)", () => {
  const periods = [{ start: MON, end: MON + 7 }];
  const f = feature({ useWeekends: true });
  const labelFor = (attrId: string, value: string | null) =>
    value == null ? "unattributed" : attrId === "resourceId" ? `res:${value}` : value;

  it("nests type › model › person and sorts each level by spend", () => {
    const entries = [
      entry({ id: "a", amountMicros: 100 * MICROS, attrs: { model: "opus", resourceId: "r1" } }),
      entry({ id: "b", amountMicros: 300 * MICROS, attrs: { model: "gpt", resourceId: "r2" } }),
      entry({ id: "c", amountMicros: 50 * MICROS, attrs: { model: "opus", resourceId: "r2" } }),
    ];
    const { roots, grand } = buildCostTree({
      entries,
      featureById: byId(f),
      types: [AI_COST_TYPE],
      periods,
      labelFor,
      typeLabel: () => "AI",
    });

    expect(roots).toHaveLength(1);
    expect(roots[0].bucket.total).toBe(450 * MICROS);
    expect(grand.total).toBe(450 * MICROS);
    // gpt ($300) outranks opus ($150)
    expect(roots[0].children.map((c) => c.label)).toEqual(["gpt", "opus"]);
    expect(roots[0].children[1].children.map((c) => c.label)).toEqual(["res:r1", "res:r2"]);
    expect(roots[0].children[1].children[0].resourceId).toBe("r1");
  });

  it("groups unattributed spend under its own child instead of dropping it", () => {
    const entries = [entry({ attrs: { model: "opus", resourceId: null } })];
    const { roots } = buildCostTree({
      entries,
      featureById: byId(f),
      types: [AI_COST_TYPE],
      periods,
      labelFor,
      typeLabel: () => "AI",
    });
    expect(roots[0].children[0].children[0].label).toBe("unattributed");
    expect(roots[0].bucket.total).toBe(412 * MICROS);
  });

  it("omits a type with no spend", () => {
    const { roots } = buildCostTree({
      entries: [],
      featureById: {},
      types: [AI_COST_TYPE],
      periods,
      labelFor,
      typeLabel: () => "AI",
    });
    expect(roots).toEqual([]);
  });
});

describe("formatting", () => {
  it("abbreviates only in compact mode", () => {
    expect(fmtMoney(4812 * MICROS)).toBe("$4,812");
    expect(fmtMoney(48_120 * MICROS, { compact: true })).toBe("$48k");
    expect(fmtMoney(4_812_000 * MICROS, { compact: true })).toBe("$4.8M");
  });

  it("shows cents only for sub-dollar amounts", () => {
    expect(fmtMoney(dollarsToMicros(0.42))).toBe("$0.42");
  });

  it("abbreviates token counts", () => {
    expect(fmtQuantity(1_240_000)).toBe("1.24M");
    expect(fmtQuantity(12_400)).toBe("12.4k");
    expect(fmtQuantity(940)).toBe("940");
  });
});
