// Cost math — Costs-Spec §3 (derivation), §5.2 (proration) and §6 (the view's
// row tree). Pure: no React, no Firestore, so the view does no arithmetic.
// Money is integer micro-dollars everywhere; round only at render.
import type { CostEntry, CostTypeDef, Feature } from "@/types";
import { isWeekend } from "./dateUtils";

export const MICROS = 1_000_000; // micro-dollars per dollar

export const dollarsToMicros = (d: number): number => Math.round(d * MICROS);
export const microsToDollars = (m: number): number => m / MICROS;

type SpanFeature = Pick<Feature, "x" | "duration" | "useWeekends">;

/** Total money for an entry, in micros. Under `rate` it's derived from
 * quantity × unit cost; under `amount` (every AI entry) it's what was
 * entered. */
export function amountOf(entry: CostEntry, type: CostTypeDef | null): number {
  if (entry.basis === "rate" && entry.unitCosts) {
    const total = (type?.measures ?? []).reduce((sum, m) => {
      const qty = entry.quantities?.[m.id] ?? 0;
      const price = entry.unitCosts?.[m.id] ?? 0;
      return sum + (qty / m.priceScale) * price;
    }, 0);
    return Math.round(total * MICROS);
  }
  return entry.amountMicros ?? 0;
}

/**
 * Unit cost for a measure, quoted per `priceScale` units ($/Mtok for tokens).
 * Null when the quantity is 0 — a division by zero is meaningless, not zero
 * (same convention as `theoreticalElapsed`). The amount still counts in every
 * total; only the per-unit figure is unavailable.
 */
export function unitCostOf(entry: CostEntry, type: CostTypeDef | null, measureId: string): number | null {
  const measure = (type?.measures ?? []).find((m) => m.id === measureId);
  if (!measure) return null;
  if (entry.basis === "rate") return entry.unitCosts?.[measureId] ?? null;
  const qty = entry.quantities?.[measureId] ?? 0;
  if (qty <= 0) return null;
  return microsToDollars(amountOf(entry, type)) / (qty / measure.priceScale);
}

/**
 * The day span an entry occupies — Costs-Spec §5.1, first match wins:
 * explicit range, then a point cost (`at`), then the parent task's span.
 * Null only when the parent feature is missing (a dangling entry).
 */
export function spanOf(entry: CostEntry, feature: SpanFeature | null | undefined): { start: number; end: number } | null {
  if (entry.spanStart != null && entry.spanEnd != null && entry.spanEnd > entry.spanStart) {
    return { start: entry.spanStart, end: entry.spanEnd };
  }
  if (entry.at != null) return { start: entry.at, end: entry.at + 1 };
  if (feature) return { start: feature.x, end: feature.x + Math.max(1, feature.duration) };
  return null;
}

/** Total quantity on an entry, summed across the type's measures. For AI that's
 * simply its token count — the view's $/tokens toggle reads this. */
export function quantityOf(entry: CostEntry, type: CostTypeDef | null): number {
  return (type?.measures ?? []).reduce((sum, m) => sum + (entry.quantities?.[m.id] ?? 0), 0);
}

/**
 * Spread an entry's money across the days it covers — Costs-Spec §5.2.
 *
 * Weekends are excluded unless the parent task says otherwise, so money
 * follows the same calendar as Elapsed Time; a span with no working days falls
 * back to calendar days rather than silently dropping the amount.
 *
 * The split is exact: integer micros with the remainder handed out one per day
 * to the earliest days, so re-summing a prorated total always returns it
 * unchanged.
 */
export function prorateToDays(
  entry: CostEntry,
  feature: SpanFeature | null | undefined,
  type: CostTypeDef | null,
  /** What to spread. Defaults to the entry's money; the view passes
   * `quantityOf` when showing tokens instead of dollars. */
  readValue: (entry: CostEntry, type: CostTypeDef | null) => number = amountOf,
): Map<number, number> {
  const out = new Map<number, number>();
  const span = spanOf(entry, feature);
  if (!span) return out;

  const useWeekends = !!feature?.useWeekends;
  let days: number[] = [];
  for (let d = span.start; d < span.end; d++) if (useWeekends || !isWeekend(d)) days.push(d);
  if (days.length === 0) {
    days = [];
    for (let d = span.start; d < span.end; d++) days.push(d);
  }
  if (days.length === 0) return out;

  const amount = readValue(entry, type);
  const base = Math.trunc(amount / days.length);
  let remainder = amount - base * days.length;
  days.forEach((d) => {
    const extra = remainder > 0 ? 1 : remainder < 0 ? -1 : 0;
    if (extra !== 0) remainder -= extra;
    out.set(d, (out.get(d) ?? 0) + base + extra);
  });
  return out;
}

export interface Period {
  start: number;
  end: number;
}

/** Money bucketed against the visible periods, plus what falls outside them.
 * `total` is all-time (CO11): it is the sum of the entries' amounts, never a
 * sum of the visible cells. */
export interface CostBucket {
  cells: number[];
  before: number;
  after: number;
  total: number;
}

export function emptyBucket(periodCount: number): CostBucket {
  return { cells: new Array(periodCount).fill(0), before: 0, after: 0, total: 0 };
}

export function bucketEntries(
  entries: CostEntry[],
  featureById: Record<string, SpanFeature | undefined>,
  typeById: (id: string) => CostTypeDef | null,
  periods: Period[],
  /** Money by default; `quantityOf` when the view is showing tokens. */
  readValue: (entry: CostEntry, type: CostTypeDef | null) => number = amountOf,
): CostBucket {
  const bucket = emptyBucket(periods.length);
  if (periods.length === 0) {
    bucket.total = entries.reduce((s, e) => s + readValue(e, typeById(e.typeId)), 0);
    return bucket;
  }
  const windowStart = periods[0].start;
  const windowEnd = periods[periods.length - 1].end;

  entries.forEach((entry) => {
    const type = typeById(entry.typeId);
    bucket.total += readValue(entry, type);
    prorateToDays(entry, featureById[entry.featureId], type, readValue).forEach((micros, day) => {
      if (day < windowStart) {
        bucket.before += micros;
        return;
      }
      if (day >= windowEnd) {
        bucket.after += micros;
        return;
      }
      const i = periods.findIndex((p) => day >= p.start && day < p.end);
      if (i >= 0) bucket.cells[i] += micros;
    });
  });
  return bucket;
}

/** One row of the Cost view: type at level 0, then the type's `groupBy`
 * attributes nested beneath it (AI → model → person). */
export interface CostNode {
  key: string;
  level: number;
  label: string;
  /** Set on a level whose grouping attribute is a resource reference, so the
   * row can render a ResourceBadge. */
  resourceId?: string | null;
  color: string;
  bucket: CostBucket;
  children: CostNode[];
}

export interface BuildTreeOptions {
  entries: CostEntry[];
  featureById: Record<string, SpanFeature | undefined>;
  types: CostTypeDef[];
  periods: Period[];
  /** Display label for a grouping value — resolves resource ids to names and
   * supplies the "unattributed" wording. */
  labelFor: (attrId: string, value: string | null) => string;
  /** Display label for a cost type (i18n). */
  typeLabel: (type: CostTypeDef) => string;
  /** Overrides the type's declared nesting order, so the view can swap which
   * dimension is level 2 (model-first vs. person-first). Defaults to
   * `type.groupBy`. */
  groupByFor?: (type: CostTypeDef) => string[];
  /** What every bucket measures — money (default) or, for the view's toggle,
   * quantity. Rows sort by whichever is showing. */
  readValue?: (entry: CostEntry, type: CostTypeDef | null) => number;
}

export function buildCostTree(opts: BuildTreeOptions): { roots: CostNode[]; grand: CostBucket } {
  const { entries, featureById, types, periods, labelFor, typeLabel, groupByFor, readValue } = opts;
  const typeById = (id: string) => types.find((t) => t.id === id) ?? null;

  const build = (rows: CostEntry[], type: CostTypeDef, groupBy: string[], level: number, keyPrefix: string): CostNode[] => {
    if (groupBy.length === 0) return [];
    const [attrId, ...rest] = groupBy;
    const groups = new Map<string, CostEntry[]>();
    rows.forEach((e) => {
      // `featureId` is a first-class field on the entry, not a type attribute,
      // but it is a legitimate dimension to group by — the view offers it
      // alongside the type's own attributes.
      const raw = attrId === "featureId" ? e.featureId : e.attrs?.[attrId] ?? null;
      const key = raw ?? "";
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    });
    return Array.from(groups.entries())
      .map(([value, groupRows]) => {
        const attr = type.attributes.find((a) => a.id === attrId);
        const node: CostNode = {
          key: `${keyPrefix}/${attrId}:${value}`,
          level,
          label: labelFor(attrId, value || null),
          resourceId: attr?.kind === "resourceRef" ? value || null : undefined,
          color: type.color,
          bucket: bucketEntries(groupRows, featureById, typeById, periods, readValue),
          children: build(groupRows, type, rest, level + 1, `${keyPrefix}/${attrId}:${value}`),
        };
        return node;
      })
      .sort((a, b) => b.bucket.total - a.bucket.total);
  };

  const roots = types
    .map((type) => {
      const rows = entries.filter((e) => e.typeId === type.id);
      return {
        key: `type:${type.id}`,
        level: 0,
        label: typeLabel(type),
        color: type.color,
        bucket: bucketEntries(rows, featureById, typeById, periods, readValue),
        children: build(rows, type, groupByFor?.(type) ?? type.groupBy ?? [], 1, `type:${type.id}`),
      } satisfies CostNode;
    })
    .filter((n) => n.bucket.total !== 0);

  return { roots, grand: bucketEntries(entries, featureById, typeById, periods, readValue) };
}

/** Every key that can be expanded — drives "expand all". Leaves are omitted,
 * so expanding all and then collapsing all round-trips exactly. */
export function expandableKeys(roots: CostNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: CostNode[]) => {
    nodes.forEach((n) => {
      if (n.children.length > 0) {
        out.push(n.key);
        walk(n.children);
      }
    });
  };
  walk(roots);
  return out;
}

/** Flatten a tree for rendering, honouring which nodes are expanded. */
export function flattenTree(roots: CostNode[], expanded: Set<string>): CostNode[] {
  const out: CostNode[] = [];
  const walk = (nodes: CostNode[]) => {
    nodes.forEach((n) => {
      out.push(n);
      if (expanded.has(n.key)) walk(n.children);
    });
  };
  walk(roots);
  return out;
}

/** Money for display. Whole dollars under $10k, thousands above, so a period
 * cell stays legible; the full figure belongs in the tooltip. */
export function fmtMoney(micros: number, opts: { compact?: boolean } = {}): string {
  const dollars = microsToDollars(micros);
  const abs = Math.abs(dollars);
  if (opts.compact && abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (opts.compact && abs >= 10_000) return `$${Math.round(dollars / 1000)}k`;
  const digits = abs > 0 && abs < 1 ? 2 : 0;
  return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Quantities read better abbreviated — 1.24M tokens, not 1,240,000. */
export function fmtQuantity(qty: number): string {
  if (Math.abs(qty) >= 1_000_000) return `${(qty / 1_000_000).toFixed(2)}M`;
  if (Math.abs(qty) >= 1_000) return `${(qty / 1000).toFixed(1)}k`;
  return String(qty);
}
