// The Cost view — Costs-Spec §6. An alternate to the Assignment-by-resource
// panel in the same bottom slot, so it takes the same geometry props and shares
// the canvas ruler: rows nest cost type › model › person, columns are the
// canvas's day/week/month periods, and a task's money is prorated across its
// span so spend shows where the work is.
import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { usePulseStore } from "@/stores/pulseStore";
import { buildPeriods, buildTimeline } from "@/domain/timeline";
import { RES_LABEL_W, type Density } from "@/domain/constants";
import { COST_TYPES, modelsUsed } from "@/domain/costTypes";
import { amountOf, buildCostTree, expandableKeys, flattenTree, fmtMoney, fmtQuantity, quantityOf, type CostNode } from "@/domain/costs";
import type { Feature } from "@/types";
import { useT } from "@/i18n";

interface CostPanelProps {
  offsetX: number;
  dayWidth: number;
  viewZoom: number;
  density: Density;
  startDay: number;
  endDay: number;
  weekends: number[];
  selectedFeature: Feature | null;
  onCollapse?: () => void;
  labelWidth?: number;
  /** Rendered by the host so the two bottom-panel views share one switch. */
  viewSwitch?: React.ReactNode;
}

/** The dimensions a cost can be broken down by, in canonical order. The toggle
 * chooses which one sits directly under the cost type; the rest keep this
 * order beneath it, so every pivot is predictable. `featureId` is a field on
 * the entry rather than a type attribute (see buildCostTree). */
type Dimension = "model" | "resourceId" | "featureId";
const DIMENSIONS: Dimension[] = ["model", "resourceId", "featureId"];

/** Width of the all-time total, carved out of the label column so `labelWidth`
 * stays the panel's single shared origin with the canvas (spec §6.1 / CO10). */
const TOTAL_W = 92;
/** Below this the label column can't hold a total at all — the collapsed
 * sidebar passes 30px. Totals move into the row tooltip there (BQ1). */
const TOTAL_MIN_LABEL_W = 180;

export function CostPanel({
  offsetX, dayWidth, viewZoom, density, startDay, endDay, weekends,
  selectedFeature, onCollapse, labelWidth = RES_LABEL_W, viewSwitch,
}: CostPanelProps) {
  const t = useT();
  const costs = usePulseStore((s) => s.costs);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);

  // Nothing is expanded to begin with: the panel opens on the top grouping
  // (one row per cost type) and you drill down from there.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [modelFilter, setModelFilter] = useState<Set<string>>(new Set());
  const [peopleFilter, setPeopleFilter] = useState<Set<string>>(new Set());
  /** Which dimension sits at level 2; the others follow beneath it in the
   * canonical order below. */
  const [dimension, setDimension] = useState<Dimension>("model");
  /** Read the same buckets as money or as raw quantity (tokens). */
  const [unit, setUnit] = useState<"usd" | "tokens">("usd");

  const xForDay = (day: number) => offsetX + day * dayWidth;
  const periods = useMemo(() => buildPeriods(density, startDay, endDay), [density, startDay, endDay]);
  const secondaryTicks = useMemo(() => buildTimeline(density, startDay, endDay).secondary, [density, startDay, endDay]);
  const showTotals = labelWidth >= TOTAL_MIN_LABEL_W;

  const featureById = useMemo(() => Object.fromEntries(features.map((f) => [f.id, f])), [features]);
  const models = useMemo(() => modelsUsed(costs), [costs]);

  // Filters narrow the totals too — a total should reflect what you asked to
  // see. Only the time window is ignored (CO11).
  const visible = useMemo(
    () =>
      costs.filter((c) => {
        if (selectedFeature && c.featureId !== selectedFeature.id) return false;
        if (modelFilter.size > 0 && !modelFilter.has(c.attrs?.model ?? "")) return false;
        if (peopleFilter.size > 0 && !peopleFilter.has(c.attrs?.resourceId ?? "")) return false;
        return true;
      }),
    [costs, selectedFeature, modelFilter, peopleFilter],
  );

  const { roots, grand } = useMemo(
    () =>
      buildCostTree({
        entries: visible,
        featureById,
        types: COST_TYPES,
        periods,
        labelFor: (attrId, value) => {
          if (value == null) return t("cost.unattributed");
          if (attrId === "resourceId") return resources.find((r) => r.id === value)?.name ?? value;
          if (attrId === "featureId") return featureById[value]?.title?.trim() || t("common.untitledTask");
          return value;
        },
        typeLabel: (type) => t(type.label as Parameters<typeof t>[0]),
        // The chosen dimension leads; the others follow in canonical order.
        // Anything the type declares outside DIMENSIONS keeps its position.
        groupByFor: (type) => {
          const declared = type.groupBy ?? [];
          const extra = declared.filter((a) => !DIMENSIONS.includes(a as Dimension));
          return [dimension, ...DIMENSIONS.filter((d) => d !== dimension), ...extra];
        },
        readValue: unit === "usd" ? amountOf : quantityOf,
      }),
    [visible, featureById, periods, resources, t, dimension, unit],
  );

  /** Every figure in the panel goes through this, so the toggle can't leave a
   * dollar sign on a token count anywhere. */
  const fmtVal = (v: number, opts: { compact?: boolean } = {}) =>
    unit === "usd" ? fmtMoney(v, opts) : fmtQuantity(v);

  const rows = useMemo(() => flattenTree(roots, expanded), [roots, expanded]);
  const inView = grand.cells.reduce((a, b) => a + b, 0);
  const allKeys = useMemo(() => expandableKeys(roots), [roots]);
  const allOpen = allKeys.length > 0 && allKeys.every((k) => expanded.has(k));

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const outsideTip = (node: CostNode) =>
    t("cost.outside", {
      before: fmtVal(node.bucket.before),
      inView: fmtVal(node.bucket.cells.reduce((a, b) => a + b, 0)),
      after: fmtVal(node.bucket.after),
    });

  return (
    <div className="no-select" style={{ height: "100%", background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0 flex-wrap gap-2" style={{ borderColor: "#EEF1F4" }}>
        <div className="flex items-center gap-2">
          {onCollapse && (
            <button onClick={onCollapse} title={t("cost.view")} className="no-press" style={{ color: "#64748B", flexShrink: 0, display: "flex", alignItems: "center" }}>
              <Icon name="keyboard_arrow_down" size={18} />
            </button>
          )}
          {viewSwitch}
          <span className="mono" style={{ fontSize: 10, color: "#78859A" }}>
            {t("cost.headerTotal", { total: fmtVal(grand.total), inView: fmtVal(inView) })}
          </span>
          {selectedFeature && (
            <span className="mono rounded px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 600, background: "#F7E8DA", color: "#D85A28" }}>
              {selectedFeature.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Read the same tree as money or as tokens. Same buckets, same
              proration — only what each bucket measures changes. */}
          <div className="flex rounded overflow-hidden flex-shrink-0" style={{ border: "1px solid #E2DFD9" }} title={t("cost.unitTitle")}>
            {([
              { id: "usd" as const, label: t("cost.inUsd") },
              { id: "tokens" as const, label: t("cost.inTokens") },
            ]).map((o) => (
              <button
                key={o.id}
                onClick={() => setUnit(o.id)}
                className="mono text-xs px-2 py-1"
                style={{ background: unit === o.id ? "#123359" : "#FFFFFF", color: unit === o.id ? "#FFFFFF" : "#64748B", fontWeight: 600 }}
              >
                {o.label}
              </button>
            ))}
          </div>
          {/* Which dimension nests first — model › person, or person › model. */}
          <div className="flex rounded overflow-hidden flex-shrink-0" style={{ border: "1px solid #E2DFD9" }} title={t("cost.groupByTitle")}>
            {([
              { id: "model" as const, label: t("cost.byModel") },
              { id: "resourceId" as const, label: t("cost.byPerson") },
              { id: "featureId" as const, label: t("cost.byTask") },
            ]).map((o) => (
              <button
                key={o.id}
                onClick={() => setDimension(o.id)}
                className="mono text-xs px-2 py-1"
                style={{ background: dimension === o.id ? "#123359" : "#FFFFFF", color: dimension === o.id ? "#FFFFFF" : "#64748B", fontWeight: 600 }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setExpanded(allOpen ? new Set() : new Set(allKeys))}
            disabled={allKeys.length === 0}
            className="mono text-xs px-2 py-1 rounded border flex items-center gap-1"
            style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#64748B", opacity: allKeys.length === 0 ? 0.45 : 1 }}
            title={allOpen ? t("cost.collapseAll") : t("cost.expandAll")}
          >
            <Icon name={allOpen ? "collapse_all" : "expand_all"} size={12} />
            {allOpen ? t("cost.collapseAll") : t("cost.expandAll")}
          </button>
          <span className="mono text-xs" style={{ color: "#78859A" }}>filter:</span>
          <MultiSelectFilter
            label={t("cost.filterModels")}
            searchable
            openUp
            options={models.map((m) => ({ id: m, name: m }))}
            selected={modelFilter}
            onChange={setModelFilter}
          />
          <MultiSelectFilter
            label={t("cost.filterPeople")}
            searchable
            openUp
            options={resources.map((r) => ({ id: r.id, name: r.name }))}
            selected={peopleFilter}
            onChange={setPeopleFilter}
          />
          {(modelFilter.size > 0 || peopleFilter.size > 0) && (
            <button
              onClick={() => { setModelFilter(new Set()); setPeopleFilter(new Set()); }}
              className="mono text-xs px-2 py-1 rounded"
              style={{ background: "#F1F5F9", color: "#64748B" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>clear <Icon name="close" size={11} /></span>
            </button>
          )}
        </div>
      </div>

      {/* mini ruler — same geometry as the assignment panel, so both stay
          aligned with the canvas above */}
      <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid #F1F5F9" }}>
        <div className="flex items-center justify-end" style={{ width: labelWidth, flexShrink: 0, borderRight: "1px solid #F1F5F9", paddingRight: 8 }}>
          {showTotals && (
            <span className="mono" style={{ fontSize: 8, color: "#94A3B8", letterSpacing: "0.04em", width: TOTAL_W, textAlign: "right" }}>{t("cost.total")}</span>
          )}
        </div>
        <div style={{ position: "relative", height: 22, flex: 1, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
            {weekends.map((d) => (
              <div key={`wm${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, bottom: 0, width: dayWidth, background: "rgba(100,116,139,0.10)" }} />
            ))}
            {secondaryTicks.map((tick, i) => {
              const nextDay = secondaryTicks[i + 1]?.day ?? tick.day + (density === "day" ? 1 : density === "week" ? 7 : 30);
              return (
                <div key={tick.day} style={{ position: "absolute", left: xForDay(tick.day), width: (nextDay - tick.day) * dayWidth, top: 0, bottom: 0, borderLeft: "1px solid #DDE2EA", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  <span className="mono" style={{ fontSize: 9, color: "#78859A", transform: `scaleX(${1 / viewZoom})` }}>{tick.label}</span>
                </div>
              );
            })}
            <div style={{ position: "absolute", left: xForDay(0), top: 0, bottom: 0, width: 2, background: "#EE7240", opacity: 0.6 }} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {rows.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <span className="mono text-xs" style={{ color: "#94A3B8" }}>
              {costs.length === 0 ? t("cost.empty") : t("cost.emptyFiltered")}
            </span>
          </div>
        )}
        {rows.map((node) => {
          const hasKids = node.children.length > 0;
          const open = expanded.has(node.key);
          const cellsTotal = node.bucket.cells.reduce((a, b) => a + b, 0);
          const hasBefore = node.bucket.before > 0;
          const hasAfter = node.bucket.after > 0;
          return (
            <div key={node.key} className="flex items-stretch border-b" style={{ borderColor: "#F5F6F8" }}>
              <div
                onClick={hasKids ? () => toggle(node.key) : undefined}
                className="flex items-center gap-1.5 py-1.5"
                title={hasBefore || hasAfter ? outsideTip(node) : undefined}
                style={{ width: labelWidth, flexShrink: 0, borderRight: "1px solid #F1F5F9", overflow: "hidden", paddingLeft: 8 + node.level * 14, paddingRight: 8, cursor: hasKids ? "pointer" : undefined }}
              >
                {hasKids ? (
                  // NB: "expand_more" is not in icons.ts and Icon renders null
                  // for an unknown name — using it here left an empty, unclickable
                  // button, so an expanded row could never be closed.
                  <button
                    // The whole label row toggles too, so stop the bubble —
                    // otherwise a chevron click would fire twice and no-op.
                    onClick={(e) => { e.stopPropagation(); toggle(node.key); }}
                    className="no-press"
                    style={{ color: "#94A3B8", display: "flex", flexShrink: 0 }}
                    aria-label={node.label}
                    aria-expanded={open}
                  >
                    <Icon name={open ? "keyboard_arrow_down" : "chevron_right"} size={14} />
                  </button>
                ) : (
                  <span style={{ width: node.level === 0 ? 14 : 8, flexShrink: 0 }} />
                )}
                {node.level === 0 && <span style={{ width: 7, height: 7, borderRadius: "50%", background: node.color, flexShrink: 0 }} />}
                {node.resourceId && <ResourceBadge resourceId={node.resourceId} size={16} />}
                <span className={node.level === 0 ? "text-xs font-semibold truncate" : "text-xs truncate"} style={{ color: node.level === 0 ? "#1F2330" : "#334155", flex: 1 }}>
                  {node.label}
                </span>
                {showTotals && (
                  <span className="mono flex items-center justify-end gap-0.5" style={{ width: TOTAL_W, textAlign: "right", fontSize: 11, fontWeight: node.level === 0 ? 700 : 500, color: "#1F2330", flexShrink: 0 }}>
                    {hasBefore && <span style={{ color: "#94A3B8" }}>‹</span>}
                    {fmtVal(node.bucket.total, { compact: true })}
                    {hasAfter && <span style={{ color: "#94A3B8" }}>›</span>}
                  </span>
                )}
              </div>

              <div style={{ position: "relative", flex: 1, overflow: "hidden", height: 30 }}>
                <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
                  {weekends.map((d) => (
                    <div key={`wb${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, bottom: 0, width: dayWidth, background: "rgba(100,116,139,0.06)" }} />
                  ))}
                  {periods.map((p, i) => {
                    const micros = node.bucket.cells[i] ?? 0;
                    if (micros === 0) return null; // blank, not "$0" — a grid of zeros is noise
                    const cellLeft = xForDay(p.start);
                    const cellW = Math.max((p.end - p.start) * dayWidth - 2, 12);
                    // Tint by share of this row's busiest period, so the
                    // expensive stretches pop without reading digits.
                    const peak = Math.max(...node.bucket.cells, 1);
                    const intensity = Math.min(1, micros / peak);
                    const label = fmtVal(micros, { compact: true });
                    const showNum = cellW * viewZoom >= label.length * 6.5 + 6;
                    return (
                      <div
                        key={i}
                        title={`${fmtVal(micros)} · ${node.label}`}
                        style={{
                          position: "absolute", left: cellLeft + 1, top: 5, width: cellW, height: 20,
                          background: `rgba(139,92,246,${0.10 + intensity * 0.28})`,
                          borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                        }}
                      >
                        {showNum && (
                          <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: "#4C1D95", transform: `scaleX(${1 / viewZoom})` }}>{label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {cellsTotal === 0 && (
                  <span className="mono" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#CBD5E1" }}>
                    {hasBefore || hasAfter ? "— outside view —" : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky total row. Its period cells are per-period column sums; only the
          left/corner figure is all-time (CO11). */}
      {rows.length > 0 && (
        <div className="flex items-stretch flex-shrink-0 border-t" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
          <div className="flex items-center gap-1.5 py-1.5" style={{ width: labelWidth, flexShrink: 0, borderRight: "1px solid #F1F5F9", paddingLeft: 8, paddingRight: 8 }}>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "#123359", flex: 1, letterSpacing: "0.04em" }}>{t("cost.totalRow")}</span>
            {showTotals && (
              <span className="mono flex items-center justify-end gap-0.5" style={{ width: TOTAL_W, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#123359", flexShrink: 0 }}>
                {grand.before > 0 && <span style={{ color: "#94A3B8" }}>‹</span>}
                {fmtVal(grand.total, { compact: true })}
                {grand.after > 0 && <span style={{ color: "#94A3B8" }}>›</span>}
              </span>
            )}
          </div>
          <div style={{ position: "relative", flex: 1, overflow: "hidden", height: 26 }}>
            <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
              {periods.map((p, i) => {
                const micros = grand.cells[i] ?? 0;
                if (micros === 0) return null;
                const cellLeft = xForDay(p.start);
                const cellW = Math.max((p.end - p.start) * dayWidth - 2, 12);
                const label = fmtVal(micros, { compact: true });
                const showNum = cellW * viewZoom >= label.length * 6.5 + 6;
                return (
                  <div key={i} title={fmtVal(micros)} style={{ position: "absolute", left: cellLeft + 1, top: 4, width: cellW, height: 18, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {showNum && (
                      <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "#123359", transform: `scaleX(${1 / viewZoom})` }}>{label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
