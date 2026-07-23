import { useMemo, useState } from "react";
import { usePulseStore } from "@/stores/pulseStore";
import { allocInRange, assignmentsFor, utilizationPct } from "@/domain/assignments";
import { stackRows } from "@/domain/layout";
import { buildPeriods, buildTimeline } from "@/domain/timeline";
import { RES_LABEL_W, clamp, colorForName, statusesOf, statusMetaOf, type Density } from "@/domain/constants";
import { fmtDate, todayIndex } from "@/domain/dateUtils";
import { useCoarsePointer } from "@/hooks/useIsMobile";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import type { Feature, Resource } from "@/types";

interface AssignmentPanelProps {
  offsetX: number;
  dayWidth: number;
  viewZoom: number;
  density: Density;
  startDay: number;
  endDay: number;
  weekends: number[];
  filterResource: string | null;
  setFilterResource: (id: string | null) => void;
  selectedFeature: Feature | null;
  onCollapse?: () => void;
  /** Width of the resource-label column. Tracks the sidebar so this panel's
   * timeline shares the canvas's left origin and the two calendars stay
   * aligned when the sidebar is collapsed. */
  labelWidth?: number;
}

type AllocFilter = "all" | "under" | "over";

/** Everyone working on a feature — its own assignees plus any picked up
 * through its subtasks (which have no schedule of their own and inherit
 * the parent's span). */
function resourceIdsOn(feature: Feature): Set<string> {
  const ids = new Set<string>(feature.resources || []);
  (feature.children || []).forEach((c) => (c.resources || []).forEach((r) => ids.add(r)));
  return ids;
}

export function AssignmentPanel({ offsetX, dayWidth, viewZoom, density, startDay, endDay, weekends, filterResource, setFilterResource, selectedFeature, onCollapse, labelWidth = RES_LABEL_W }: AssignmentPanelProps) {
  const resources = usePulseStore((s) => s.resources);
  const features = usePulseStore((s) => s.features);
  const pulse = usePulseStore((s) => s.pulse);
  const statuses = statusesOf(pulse);
  const coarse = useCoarsePointer();

  const [assignPeople, setAssignPeople] = useState<Set<string>>(new Set());
  const [assignTypes, setAssignTypes] = useState<Set<string>>(new Set());
  const [assignStatuses, setAssignStatuses] = useState<Set<string>>(new Set());
  const [assignHideIdle, setAssignHideIdle] = useState(false);
  const [assignCompact, setAssignCompact] = useState(false);
  const [assignAllocFilter, setAssignAllocFilter] = useState<AllocFilter>("all");
  // Rich hover card for the resource avatar — surfaced when the label column
  // is collapsed (names clipped) so you can still identify who a badge is.
  const [resCard, setResCard] = useState<{ x: number; y: number; r: Resource } | null>(null);

  // Every type present, whether it's in the Pulse's configured list or set
  // freeform on a resource.
  const allTypes = useMemo(
    () => Array.from(new Set([...(pulse?.resourceTypes ?? []), ...resources.map((r) => r.type).filter((t): t is string => !!t)])),
    [pulse?.resourceTypes, resources],
  );

  const xForDay = (day: number) => offsetX + day * dayWidth;
  const periods = useMemo(() => buildPeriods(density, startDay, endDay), [density, startDay, endDay]);
  const secondaryTicks = useMemo(() => buildTimeline(density, startDay, endDay).secondary, [density, startDay, endDay]);

  // Selecting a box scopes this panel to just the people working on it.
  // Their bars still show *all* their work, not only this feature — the
  // point is to see whether the crew for the selected feature is free or
  // already committed elsewhere.
  const selectedResourceIds = useMemo(
    () => (selectedFeature ? resourceIdsOn(selectedFeature) : null),
    [selectedFeature],
  );

  const rows = resources
    .filter((r) => !selectedResourceIds || selectedResourceIds.has(r.id))
    .filter((r) => !filterResource || r.id === filterResource)
    .filter((r) => assignPeople.size === 0 || assignPeople.has(r.id))
    .filter((r) => assignTypes.size === 0 || (r.type != null && assignTypes.has(r.type)))
    .map((r) => {
      let assignRows = assignmentsFor(features, r.id);
      if (assignStatuses.size > 0) assignRows = assignRows.filter((row) => assignStatuses.has(row.status));
      return { r, assignRows };
    })
    .filter(({ assignRows }) => !assignHideIdle || assignRows.length > 0)
    .filter(({ r }) => {
      if (assignAllocFilter === "all") return true;
      const u = utilizationPct(features, r);
      if (assignAllocFilter === "under") return u < 70;
      if (assignAllocFilter === "over") return u > 100;
      return true;
    });

  // Touch gesture on a resource avatar: a quick tap shows the info card, a
  // long-press selects (filters the canvas by) the resource. A move cancels
  // (lets the panel scroll). Mouse keeps hover — see the badge handlers.
  const startBadgeGesture = (r: Resource, e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let resolved = false;
    let timer = 0;
    const remove = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearTimeout(timer);
    };
    function onMove(ev: PointerEvent) {
      if (!resolved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 8) {
        resolved = true;
        remove();
      }
    }
    function onUp() {
      if (!resolved) {
        resolved = true;
        setResCard((c) => (c && c.r.id === r.id ? null : { x: startX, y: startY, r })); // tap -> card
      }
      remove();
    }
    timer = window.setTimeout(() => {
      if (resolved) return;
      resolved = true;
      remove();
      setFilterResource(filterResource === r.id ? null : r.id); // long-press -> select
    }, 500);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="no-select" style={{ height: "100%", background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0 flex-wrap gap-2" style={{ borderColor: "#EEF1F4" }}>
        <div className="flex items-center gap-2">
          {onCollapse && (
            <button onClick={onCollapse} title="Collapse this panel to maximize the canvas" className="no-press" style={{ color: "#64748B", flexShrink: 0, display: "flex", alignItems: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
          <span className="text-xs font-semibold" style={{ color: "#123359" }}>
            Assignment by resource
            {selectedFeature && (
              <span className="mono ml-1.5 rounded px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 600, background: "#F7E8DA", color: "#D85A28" }}>
                team on “{selectedFeature.title}”
              </span>
            )}
            {filterResource ? ` — ${resources.find((x) => x.id === filterResource)?.name || filterResource}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="mono text-xs" style={{ color: "#78859A" }}>filter:</span>
          <MultiSelectFilter
            label="people"
            searchable
            openUp
            options={resources.map((r) => ({ id: r.id, name: r.name }))}
            selected={assignPeople}
            onChange={setAssignPeople}
          />
          {allTypes.length > 0 && (
            <MultiSelectFilter
              label="types"
              searchable
              openUp
              options={allTypes.map((t) => ({ id: t, name: t }))}
              selected={assignTypes}
              onChange={setAssignTypes}
            />
          )}
          <MultiSelectFilter
            label="statuses"
            openUp
            options={statuses.map((s) => ({ id: s.id, name: s.label }))}
            selected={assignStatuses}
            onChange={setAssignStatuses}
          />
          <button onClick={() => setAssignAllocFilter((v) => (v === "under" ? "all" : "under"))} title="Show only under-allocated (<70%)" className="mono text-xs px-2 py-1 rounded border" style={{ borderColor: assignAllocFilter === "under" ? "#12A594" : "#E2DFD9", background: assignAllocFilter === "under" ? "#E6F7F4" : "#fff", color: assignAllocFilter === "under" ? "#0F6B5C" : "#64748B" }}>
            under
          </button>
          <button onClick={() => setAssignAllocFilter((v) => (v === "over" ? "all" : "over"))} title="Show only over-allocated (>100%)" className="mono text-xs px-2 py-1 rounded border" style={{ borderColor: assignAllocFilter === "over" ? "#E5484D" : "#E2DFD9", background: assignAllocFilter === "over" ? "#FDEBEC" : "#fff", color: assignAllocFilter === "over" ? "#9F1D23" : "#64748B" }}>
            over
          </button>
          <button onClick={() => setAssignHideIdle((v) => !v)} className="mono text-xs px-2 py-1 rounded border" style={{ borderColor: assignHideIdle ? "#EE7240" : "#E2DFD9", background: assignHideIdle ? "#F7E8DA" : "#fff", color: assignHideIdle ? "#D85A28" : "#64748B" }}>
            hide idle
          </button>
          <button onClick={() => setAssignCompact((v) => !v)} title="Show only % per resource (hide task bars)" className="mono text-xs px-2 py-1 rounded border" style={{ borderColor: assignCompact ? "#EE7240" : "#E2DFD9", background: assignCompact ? "#F7E8DA" : "#fff", color: assignCompact ? "#D85A28" : "#64748B" }}>
            {assignCompact ? "▣ compact" : "▤ compact"}
          </button>
          {(assignPeople.size > 0 || assignTypes.size > 0 || assignStatuses.size > 0 || assignHideIdle) && (
            <button
              onClick={() => {
                setAssignPeople(new Set());
                setAssignTypes(new Set());
                setAssignStatuses(new Set());
                setAssignHideIdle(false);
              }}
              className="mono text-xs px-2 py-1 rounded"
              style={{ background: "#F1F5F9", color: "#64748B" }}
            >
              clear ✕
            </button>
          )}
        </div>
      </div>

      {/* mini ruler */}
      <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid #F1F5F9" }}>
        <div style={{ width: labelWidth, flexShrink: 0, borderRight: "1px solid #F1F5F9" }} />
        <div style={{ position: "relative", height: 22, flex: 1, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
            {weekends.map((d) => (
              <div key={`wm${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, bottom: 0, width: dayWidth, background: "rgba(100,116,139,0.10)" }} />
            ))}
            {secondaryTicks.map((t, i) => {
              const nextDay = secondaryTicks[i + 1]?.day ?? t.day + (density === "day" ? 1 : density === "week" ? 7 : 30);
              return (
                <div key={t.day} style={{ position: "absolute", left: xForDay(t.day), width: (nextDay - t.day) * dayWidth, top: 0, bottom: 0, borderLeft: "1px solid #DDE2EA", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  <span className="mono" style={{ fontSize: 9, color: "#78859A", transform: `scaleX(${1 / viewZoom})` }}>{t.label}</span>
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
              {selectedFeature && selectedResourceIds?.size === 0
                ? `No one is assigned to “${selectedFeature.title}” yet — drag someone from the Team tab onto it.`
                : "No resources match the current filters."}
            </span>
          </div>
        )}
        {rows.map(({ r, assignRows }) => {
          const today = todayIndex();
          const loadWindows = [
            { label: "1–4w", lo: today, hi: today + 28 },
            { label: "5–8w", lo: today + 28, hi: today + 56 },
            { label: "9–12w", lo: today + 56, hi: today + 84 },
          ];
          const loadPct = (lo: number, hi: number) => clamp(Math.round((allocInRange(features, r.id, lo, hi) / (r.capacity || 100)) * 100), 0, 999);
          const stacked = stackRows(assignRows);
          const laneCount = stacked.reduce((mx, row) => Math.max(mx, row.lane + 1), 0);
          const barsHeight = Math.max(30, laneCount * 17 + 8);
          return (
            <div key={r.id} className="flex items-stretch border-b" style={{ borderColor: "#F5F6F8" }}>
              <div
                onClick={() => { if (!(coarse && labelWidth < 100)) setFilterResource(filterResource === r.id ? null : r.id); }}
                title="Click to filter the canvas by this resource"
                className={`flex gap-2 py-2 cursor-pointer ${assignCompact ? "items-center" : "items-start"}`}
                style={{ width: labelWidth, flexShrink: 0, borderRight: "1px solid #F1F5F9", background: filterResource === r.id ? "#FFF7F1" : undefined, overflow: "hidden", paddingLeft: labelWidth < 100 ? 4 : 12, paddingRight: labelWidth < 100 ? 4 : 12 }}
              >
                <span
                  className="mono"
                  onPointerEnter={(e) => { if (!coarse && labelWidth < 100) setResCard({ x: e.clientX, y: e.clientY, r }); }}
                  onPointerLeave={() => { if (!coarse) setResCard((c) => (c && c.r.id === r.id ? null : c)); }}
                  onPointerDown={(e) => { if (coarse && labelWidth < 100) startBadgeGesture(r, e); }}
                  style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: colorForName(r.id), width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  {r.initials}
                </span>
                <div className="flex-1 overflow-hidden">
                  <div className="text-xs font-medium truncate" style={{ color: "#1F2330" }}>{r.name}</div>
                  {/* Compact hides everything but the name + badge; the per-period
                      allocation cells on the right stay. */}
                  {!assignCompact && (
                    <>
                      <div className="mono" style={{ fontSize: 9, color: "#64748B" }}>{`${assignRows.length} task${assignRows.length === 1 ? "" : "s"}`}</div>
                      <div className="flex gap-1.5 mt-1">
                        {loadWindows.map((w) => {
                          const load = loadPct(w.lo, w.hi);
                          const color = load > 100 ? "#E5484D" : load >= 50 ? "#12A594" : "#F5A524";
                          return (
                            <div key={w.label} className="flex-1" title={`${w.label}: ${load}% load`}>
                              <div className="flex items-center justify-between">
                                <span className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>{w.label}</span>
                                <span className="mono" style={{ fontSize: 8, fontWeight: 700, color }}>{load}%</span>
                              </div>
                              <div style={{ height: 4, background: "#F1F5F9", borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
                                <div style={{ height: "100%", width: `${clamp(load, 0, 100)}%`, background: color }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: assignCompact ? "center" : "flex-start" }}>
                {!assignCompact && (
                  <div style={{ position: "relative", height: barsHeight, overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
                      {weekends.map((d) => (
                        <div key={`wb${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, bottom: 0, width: dayWidth, background: "rgba(100,116,139,0.08)" }} />
                      ))}
                      {secondaryTicks.map((t) => (
                        <div key={t.day} style={{ position: "absolute", left: xForDay(t.day), top: 0, bottom: 0, width: 1, background: "#EDEFF2" }} />
                      ))}
                      <div style={{ position: "absolute", left: xForDay(0), top: 0, bottom: 0, width: 1, background: "rgba(34,211,238,0.35)" }} />
                      {stacked.map((row, i) => {
                        const m = statusMetaOf(row.status, statuses);
                        const bLeft = xForDay(row.start);
                        const bWidth = Math.max(row.duration * dayWidth, 26);
                        return (
                          <div
                            key={i}
                            title={`${row.title} · ${fmtDate(row.start)}→${fmtDate(row.start + row.duration)} · ${row.pct}% time`}
                            style={{ position: "absolute", left: bLeft, top: 4 + row.lane * 17, height: 15, width: bWidth, background: m.bg, border: `1px solid ${m.border}`, borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 4, overflow: "hidden", whiteSpace: "nowrap", transformOrigin: "left" }}
                          >
                            <span style={{ display: "flex", alignItems: "center", transform: `scaleX(${1 / viewZoom})`, transformOrigin: "left", whiteSpace: "nowrap" }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.border, flexShrink: 0, marginRight: 4 }} />
                              <span style={{ fontSize: 10, color: m.text, fontWeight: 500 }}>{row.parent ? `${row.parent} › ` : ""}{row.title}</span>
                              {bWidth * viewZoom > 60 && <span className="mono" style={{ fontSize: 9, color: m.text, opacity: 0.7, marginLeft: 4 }}>{row.pct}%</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {assignRows.length === 0 && <span className="mono text-xs" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }}>— idle —</span>}
                  </div>
                )}
                <div style={{ position: "relative", height: 20, borderTop: assignCompact ? "none" : "1px dashed #EEF1F4", flexShrink: 0, overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
                    {periods.map((p, i) => {
                      const a = allocInRange(features, r.id, p.start, p.end);
                      if (a <= 0) return null;
                      const cellLeft = xForDay(p.start);
                      const cellW = Math.max((p.end - p.start) * dayWidth - 2, 12);
                      const bg = a > 100 ? "#FDEBEC" : a >= 70 ? "#FFF6E2" : "#E6F7F4";
                      const fg = a > 100 ? "#9F1D23" : a >= 70 ? "#92400E" : "#0F6B5C";
                      const label = `${a}%`;
                      // Drop the number once the cell is too narrow on-screen to
                      // render it legibly (it would just clip into a garbled
                      // partial); the color stays as the at-a-glance signal.
                      const showNum = cellW * viewZoom >= label.length * 6.5 + 6;
                      return (
                        <div key={i} title={`${a}% allocated in this ${density}`} style={{ position: "absolute", left: cellLeft + 1, top: 2, width: cellW, height: 16, background: bg, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {showNum && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: fg, transform: `scaleX(${1 / viewZoom})` }}>{label}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {resCard && coarse && <div className="fixed inset-0" style={{ zIndex: 99 }} onClick={() => setResCard(null)} />}
      {resCard && (() => {
        const r = resCard.r;
        const util = utilizationPct(features, r);
        const today = todayIndex();
        const windows = [
          { label: "1–4w", lo: today, hi: today + 28 },
          { label: "5–8w", lo: today + 28, hi: today + 56 },
          { label: "9–12w", lo: today + 56, hi: today + 84 },
        ];
        const left = Math.min(resCard.x + 12, window.innerWidth - 212);
        return (
          <div className="fixed pointer-events-none rounded-lg" style={{ left: Math.max(8, left), top: resCard.y - 12, transform: "translateY(-100%)", width: 200, background: "#123359", border: "1px solid #EE7240", padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", zIndex: 100 }}>
            <div className="flex items-center gap-1.5">
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: colorForName(r.id), width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.initials}</span>
              <span className="text-xs font-semibold truncate" style={{ color: "#F7F6F2" }}>{r.name}</span>
            </div>
            {r.type && <div className="mono" style={{ fontSize: 9, color: "#EE7240", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 4 }}>{r.type}</div>}
            <div className="mono" style={{ fontSize: 10, color: "#F0A875", marginTop: 5 }}>limit {r.capacity}% · {util}% used</div>
            <div className="flex gap-1.5" style={{ marginTop: 6 }}>
              {windows.map((w) => {
                const load = clamp(Math.round((allocInRange(features, r.id, w.lo, w.hi) / (r.capacity || 100)) * 100), 0, 999);
                const color = load > 100 ? "#E5484D" : load >= 50 ? "#12A594" : "#F5A524";
                return (
                  <div key={w.label} className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="mono" style={{ fontSize: 8, color: "#9FB3C8" }}>{w.label}</span>
                      <span className="mono" style={{ fontSize: 8, fontWeight: 700, color }}>{load}%</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.14)", borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
                      <div style={{ height: "100%", width: `${clamp(load, 0, 100)}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
