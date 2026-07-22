import { useMemo, useState } from "react";
import { usePulseStore } from "@/stores/pulseStore";
import { allocInRange, assignmentsFor, utilizationPct } from "@/domain/assignments";
import { stackRows } from "@/domain/layout";
import { buildPeriods, buildTimeline } from "@/domain/timeline";
import { STATUS_META, RES_LABEL_W, clamp, colorForName, type Density } from "@/domain/constants";
import { fmtDate, todayIndex } from "@/domain/dateUtils";
import type { Feature } from "@/types";

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

export function AssignmentPanel({ offsetX, dayWidth, viewZoom, density, startDay, endDay, weekends, filterResource, setFilterResource, selectedFeature, onCollapse }: AssignmentPanelProps) {
  const resources = usePulseStore((s) => s.resources);
  const features = usePulseStore((s) => s.features);
  const pulse = usePulseStore((s) => s.pulse);

  const [assignPeople, setAssignPeople] = useState<Set<string>>(new Set());
  const [assignTypes, setAssignTypes] = useState<Set<string>>(new Set());
  const [assignStatuses, setAssignStatuses] = useState<Set<string>>(new Set());
  const [assignHideIdle, setAssignHideIdle] = useState(false);
  const [assignCompact, setAssignCompact] = useState(false);
  const [assignAllocFilter, setAssignAllocFilter] = useState<AllocFilter>("all");

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

  return (
    <div style={{ height: "100%", background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
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
            options={resources.map((r) => ({ id: r.id, name: r.name }))}
            selected={assignPeople}
            onChange={setAssignPeople}
          />
          {allTypes.length > 0 && (
            <MultiSelectFilter
              label="types"
              searchable
              options={allTypes.map((t) => ({ id: t, name: t }))}
              selected={assignTypes}
              onChange={setAssignTypes}
            />
          )}
          <MultiSelectFilter
            label="statuses"
            options={Object.entries(STATUS_META).map(([k, m]) => ({ id: k, name: m.label }))}
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
        <div style={{ width: RES_LABEL_W, flexShrink: 0, borderRight: "1px solid #F1F5F9" }} />
        <div style={{ position: "relative", height: 22, flex: 1, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
            {weekends.map((d) => (
              <div key={`wm${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, bottom: 0, width: dayWidth, background: "rgba(100,116,139,0.10)" }} />
            ))}
            {secondaryTicks.map((t) => (
              <div key={t.day} style={{ position: "absolute", left: xForDay(t.day), top: 0, bottom: 0, borderLeft: "1px solid #DDE2EA", paddingLeft: 3, display: "flex", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 9, color: "#78859A", transform: `scaleX(${1 / viewZoom})`, transformOrigin: "left" }}>{t.label}</span>
              </div>
            ))}
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
                onClick={() => setFilterResource(filterResource === r.id ? null : r.id)}
                title="Click to filter the canvas by this resource"
                className={`flex gap-2 px-3 py-2 cursor-pointer ${assignCompact ? "items-center" : "items-start"}`}
                style={{ width: RES_LABEL_W, flexShrink: 0, borderRight: "1px solid #F1F5F9", background: filterResource === r.id ? "#FFF7F1" : undefined }}
              >
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: colorForName(r.id), width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
                        const m = STATUS_META[row.status];
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
    </div>
  );
}

interface Option {
  id: string;
  name: string;
}

/** Compact multi-select dropdown for the panel's filters. Empty selection =
 * no filter ("all"). Opens upward since the panel sits at the bottom. */
function MultiSelectFilter({ label, options, selected, onChange, searchable }: { label: string; options: Option[]; selected: Set<string>; onChange: (next: Set<string>) => void; searchable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = searchable && query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const summary =
    selected.size === 0
      ? `all ${label}`
      : selected.size === 1
        ? options.find((o) => selected.has(o.id))?.name ?? `1 ${label}`
        : `${selected.size} ${label}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mono text-xs border rounded px-1.5 py-1 flex items-center gap-1"
        style={{ borderColor: selected.size ? "#EE7240" : "#E2DFD9", background: selected.size ? "#FFF7F1" : "#FFFFFF", color: "#334155", maxWidth: 150 }}
      >
        <span className="truncate">{summary}</span>
        <span style={{ fontSize: 8, color: "#94A3B8" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => { setOpen(false); setQ(""); }} />
          <div className="absolute rounded border" style={{ bottom: "calc(100% + 4px)", left: 0, zIndex: 50, width: 200, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
            {searchable && (
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="text-xs w-full px-2 py-1.5 border-b" style={{ borderColor: "#F1F5F9", outline: "none" }} />
            )}
            {selected.size > 0 && (
              <button onClick={() => onChange(new Set())} className="mono text-xs w-full text-left px-2 py-1 border-b" style={{ color: "#9F1D23", borderColor: "#F1F5F9" }}>
                ✕ clear ({selected.size})
              </button>
            )}
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {filtered.length === 0 && <div className="mono text-xs px-2 py-1.5" style={{ color: "#94A3B8" }}>No matches</div>}
              {filtered.map((o) => (
                <button key={o.id} onClick={() => toggle(o.id)} className="text-xs w-full text-left px-2 py-1 flex items-center gap-2" style={{ background: selected.has(o.id) ? "#FFF7F1" : undefined }}>
                  <input type="checkbox" readOnly checked={selected.has(o.id)} style={{ accentColor: "#EE7240", pointerEvents: "none", flexShrink: 0 }} />
                  <span className="truncate" style={{ color: "#334155" }}>{o.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
