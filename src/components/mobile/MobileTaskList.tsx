import type { Epic, Feature, Resource } from "@/types";
import { STATUS_META, colorForName } from "@/domain/constants";
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

  if (features.length === 0) {
    return <div className="p-8 text-center text-sm" style={{ color: "#64748B" }}>No tasks yet. Tap the + button to add one.</div>;
  }

  const groups: { epic: Epic | null; items: Feature[] }[] = epics
    .map((ep) => ({ epic: ep as Epic | null, items: features.filter((f) => f.epicId === ep.id) }))
    .filter((g) => g.items.length > 0);
  const loose = features.filter((f) => !f.epicId || !epics.some((e) => e.id === f.epicId));
  if (loose.length) groups.push({ epic: null, items: loose });

  return (
    <div className="flex flex-col gap-4 p-3">
      {groups.map((g, i) => (
        <div key={g.epic?.id ?? `loose-${i}`}>
          <div className="flex items-center gap-2 mb-1.5 px-1">
            {g.epic && <span style={{ width: 8, height: 8, borderRadius: 3, background: g.epic.color, flexShrink: 0 }} />}
            <span className="mono text-xs uppercase tracking-wide truncate" style={{ color: "#64748B" }}>{g.epic ? g.epic.name : "No epic"}</span>
            <span className="mono text-xs" style={{ color: "#94A3B8" }}>{g.items.length}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {g.items.map((f) => {
              const meta = STATUS_META[f.status];
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
                    {f.status === "done" && <span style={{ fontSize: 12 }}>🔒</span>}
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
  );
}
