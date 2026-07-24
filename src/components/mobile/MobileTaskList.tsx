import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Epic, Feature, Resource } from "@/types";
import { colorForName, hexA, statusesOf, statusMetaOf } from "@/domain/constants";
import { usePulseStore } from "@/stores/pulseStore";
import { dateForDay } from "@/domain/dateUtils";

interface MobileTaskListProps {
  features: Feature[];
  epics: Epic[];
  resources: Resource[];
  onSelect: (id: string) => void;
}

const fmt = (day: number) => dateForDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function MobileTaskList({ features, epics, resources, onSelect }: MobileTaskListProps) {
  const byId = Object.fromEntries(resources.map((r) => [r.id, r]));
  const statuses = statusesOf(usePulseStore((s) => s.pulse));
  const [query, setQuery] = useState("");

  if (features.length === 0) {
    return <div className="p-8 text-center text-sm" style={{ color: "#64748B" }}>No tasks yet. Tap the + button to add one.</div>;
  }

  // Match on task title, its epic's name, and any assigned resource's name or
  // initials — the same handles you'd scan the list for.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? features.filter((f) => {
        if ((f.title || "").toLowerCase().includes(q)) return true;
        const ep = epics.find((e) => e.id === f.epicId);
        if (ep && ep.name.toLowerCase().includes(q)) return true;
        return (f.resources || []).some((rid) => {
          const r = byId[rid];
          return r && (r.name.toLowerCase().includes(q) || r.initials.toLowerCase().includes(q));
        });
      })
    : features;

  const groups: { epic: Epic | null; items: Feature[] }[] = epics
    .map((ep) => ({ epic: ep as Epic | null, items: filtered.filter((f) => f.epicId === ep.id) }))
    .filter((g) => g.items.length > 0);
  const loose = filtered.filter((f) => !f.epicId || !epics.some((e) => e.id === f.epicId));
  if (loose.length) groups.push({ epic: null, items: loose });

  return (
    <div>
      {/* Search — sticky so it stays reachable while the list scrolls. */}
      <div className="sticky top-0 z-10 px-3 pt-3 pb-2" style={{ background: "#F7F6F2" }}>
        <div className="relative">
          <Icon name="search" size={16} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, epics, people"
            className="w-full rounded-lg border text-sm"
            style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", padding: "9px 34px 9px 34px", outline: "none" }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="no-press"
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8", fontSize: 16, lineHeight: 1 }}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-3 pb-3">
        {groups.length === 0 && (
          <div className="p-8 text-center text-sm" style={{ color: "#64748B" }}>No tasks match “{query.trim()}”.</div>
        )}
        {groups.map((g, i) => (
          <div key={g.epic?.id ?? `loose-${i}`}>
            <div className="flex items-center gap-1.5 mb-1.5 rounded" style={{ background: hexA(g.epic?.color || "#94A3B8", 0.16), borderLeft: `3px solid ${g.epic?.color || "#94A3B8"}`, padding: "3px 8px" }}>
              <span className="mono text-xs uppercase tracking-wide truncate" style={{ color: "#334155", fontWeight: 600 }}>{g.epic ? g.epic.name : "No epic"}</span>
              <span className="mono text-xs" style={{ color: "#64748B", marginLeft: "auto" }}>{g.items.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {g.items.map((f) => {
                const meta = statusMetaOf(f.status, statuses);
                return (
                  <button
                    key={f.id}
                    onClick={() => onSelect(f.id)}
                    className="w-full text-left rounded-xl border px-3 py-2.5 active:brightness-95"
                    style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}
                  >
                    <div className="flex items-center gap-2">
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: meta.border, flexShrink: 0 }} />
                      <span className="text-sm font-medium flex-1 truncate" style={{ color: "#1F2330", textDecoration: f.status === "done" ? "line-through" : "none" }}>{f.title || "Untitled task"}</span>
                      {f.status === "done" && <Icon name="lock" size={13} />}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="mono rounded px-1.5 py-0.5" style={{ fontSize: 9, background: meta.bg, color: meta.text }}>{meta.label}</span>
                      <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>{fmt(f.x)} → {fmt(f.x + f.duration)}</span>
                      <div className="flex items-center gap-0.5" style={{ marginLeft: "auto" }}>
                        {(f.resources || []).slice(0, 4).map((rid) => {
                          const r = byId[rid];
                          return r ? (
                            <span key={rid} className="mono" title={r.name} style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: colorForName(r.id), width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.initials}</span>
                          ) : null;
                        })}
                        {(f.resources || []).length > 4 && <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>+{f.resources.length - 4}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
