import { useMemo, useState } from "react";
import type { Epic, Feature, Resource } from "@/types";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { buildBoard } from "@/domain/kanban";
import { statusesOf, statusMetaOf, colorForName, hexA } from "@/domain/constants";
import { dateForDay } from "@/domain/dateUtils";
import { staffingColor } from "@/domain/graphEffort";

interface MobileBoardProps {
  features: Feature[];
  epics: Epic[];
  resources: Resource[];
  canEdit: boolean;
  onSelect: (id: string) => void;
}

const fmt = (day: number) => dateForDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function MobileBoard({ features, epics, resources, canEdit, onSelect }: MobileBoardProps) {
  const pulse = usePulseStore((s) => s.pulse);
  const setFeatureStatus = usePulseStore((s) => s.setFeatureStatus);
  const graph = graphConfigOf(pulse);
  const statuses = statusesOf(pulse);
  const byId = useMemo(() => Object.fromEntries(resources.map((r) => [r.id, r])), [resources]);

  const columns = useMemo(() => buildBoard(features, epics, statuses), [features, epics, statuses]);
  const [active, setActive] = useState<string | null>(null);
  const col = columns.find((c) => c.status === active) ?? columns[0];

  if (columns.length === 0) return null;

  return (
    <div>
      {/* Status picker — one column at a time. */}
      <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto px-3 py-2" style={{ background: "#F7F6F2", borderBottom: "1px solid #E2DFD9" }}>
        {columns.map((c) => {
          const meta = statusMetaOf(c.status, statuses);
          const on = c.status === col.status;
          return (
            <button
              key={c.status}
              onClick={() => setActive(c.status)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 flex-shrink-0"
              style={{ background: on ? meta.border : "#FFFFFF", border: `1px solid ${on ? meta.border : "#E2DFD9"}` }}
            >
              {!on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.border }} />}
              <span className="text-xs font-semibold" style={{ color: on ? "#FFFFFF" : "#334155" }}>{meta.label}</span>
              <span className="mono text-xs" style={{ color: on ? "rgba(255,255,255,0.8)" : "#94A3B8" }}>{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 p-3">
        {col.groups.length === 0 && <div className="p-8 text-center text-sm" style={{ color: "#94A3B8" }}>No tasks in “{statusMetaOf(col.status, statuses).label}”.</div>}
        {col.groups.map((g) => (
          <div key={g.epicId ?? "none"}>
            <div className="flex items-center gap-1.5 mb-1.5 rounded" style={{ background: hexA(g.color || "#94A3B8", 0.16), borderLeft: `3px solid ${g.color || "#94A3B8"}`, padding: "3px 8px" }}>
              <span className="mono text-xs uppercase tracking-wide truncate" style={{ color: "#334155", fontWeight: 600 }}>{g.name}</span>
              <span className="mono text-xs" style={{ color: "#64748B", marginLeft: "auto" }}>{g.tasks.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {g.tasks.map((f) => {
                const done = f.status === "done";
                const subs = f.children || [];
                const subDone = subs.filter((c) => c.status === "done").length;
                return (
                  <div key={f.id} className="w-full rounded-xl border" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
                    <button onClick={() => onSelect(f.id)} className="w-full text-left px-3 py-2.5 active:brightness-95">
                      <div className="flex items-center gap-2">
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: staffingColor(f, graph), flexShrink: 0 }} />
                        <span className="text-sm font-medium flex-1 truncate" style={{ color: "#1F2330", textDecoration: done ? "line-through" : "none" }}>{f.title || "Untitled task"}</span>
                        {f.plannedX != null && <span style={{ fontSize: 11 }}>📌</span>}
                        {done && <span style={{ fontSize: 12 }}>🔒</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>{fmt(f.x)} → {fmt(f.x + f.duration)}</span>
                        {subs.length > 0 && <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>☑ {subDone}/{subs.length}</span>}
                        <div className="flex items-center gap-0.5" style={{ marginLeft: "auto" }}>
                          {(f.resources || []).slice(0, 4).map((rid) => {
                            const r = byId[rid];
                            return r ? (
                              <span key={rid} className="mono" title={r.name} style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: colorForName(rid), width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.initials}</span>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </button>
                    {canEdit && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ borderTop: "1px solid #F1F5F9" }}>
                        <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>move to</span>
                        <select
                          value={f.status}
                          onChange={(e) => void setFeatureStatus(f.id, e.target.value)}
                          className="mono text-xs flex-1 rounded px-1.5 py-1"
                          style={{ border: "1px solid #E2DFD9", color: "#334155", background: "#FFFFFF" }}
                        >
                          {statuses.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
