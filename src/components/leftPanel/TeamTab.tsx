import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { usePulseStore } from "@/stores/pulseStore";
import { allocInRange } from "@/domain/assignments";
import { todayIndex } from "@/domain/dateUtils";
import { clamp, colorForName } from "@/domain/constants";
import { confirmAt } from "@/stores/confirmStore";

interface TeamTabProps {
  canEdit: boolean;
  filterResource: string | null;
  setFilterResource: (id: string | null) => void;
}

export function TeamTab({ canEdit, filterResource, setFilterResource }: TeamTabProps) {
  const resources = usePulseStore((s) => s.resources);
  const features = usePulseStore((s) => s.features);
  const members = usePulseStore((s) => s.members);
  const addResource = usePulseStore((s) => s.addResource);
  const removeResource = usePulseStore((s) => s.removeResource);
  const duplicateResource = usePulseStore((s) => s.duplicateResource);
  const patchResource = usePulseStore((s) => s.patchResource);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = resources.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.type || "").toLowerCase().includes(q));

  // Three forward 4-week windows from today, for the per-resource load
  // indicators (avg allocation over the window ÷ the person's capacity).
  const today = todayIndex();
  const LOAD_WINDOWS = [
    { label: "1–4w", lo: today, hi: today + 28 },
    { label: "5–8w", lo: today + 28, hi: today + 56 },
    { label: "9–12w", lo: today + 56, hi: today + 84 },
  ];

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ border: "1px solid #E2DFD9", background: "#FDFCF8" }}>
        <Icon name="search" size={13} style={{ color: "#64748B" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or type…"
          className="bg-transparent text-xs flex-1"
          style={{ color: "#1F2330", outline: "none", minWidth: 0 }}
        />
        {query && (
          <button onClick={() => setQuery("")}>
            <Icon name="close" size={12} style={{ color: "#64748B" }} />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="mono text-xs" style={{ color: "#64748B" }}>{filtered.length} people</span>
        {canEdit && (
          <button onClick={() => setAdding(true)} className="mono text-xs flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "#F7E8DA", color: "#D85A28" }}>
            + add
          </button>
        )}
      </div>
      {adding && (
        <input
          autoFocus
          placeholder="Name, then Enter"
          className="w-full text-xs rounded px-2 py-1.5"
          style={{ border: "1px solid #E2DFD9" }}
          onKeyDown={(e) => {
            const target = e.target as HTMLInputElement;
            if (e.key === "Enter" && target.value.trim()) {
              void addResource(target.value, null);
              target.value = "";
              setAdding(false);
            }
            if (e.key === "Escape") setAdding(false);
          }}
          onBlur={() => setAdding(false)}
        />
      )}
      {filterResource && (
        <button onClick={() => setFilterResource(null)} className="w-full flex items-center justify-between px-2 py-1.5 rounded" style={{ background: "#F7E8DA", border: "1px solid #F0A875" }}>
          <span className="mono text-xs" style={{ color: "#D85A28" }}>
            filtering canvas by: {resources.find((x) => x.id === filterResource)?.name ?? filterResource}
          </span>
          <span className="mono text-xs" style={{ color: "#D85A28", display: "inline-flex", alignItems: "center", gap: 3 }}>clear <Icon name="close" size={11} /></span>
        </button>
      )}
      {filtered.map((r) => {
        const active = filterResource === r.id;
        const loadPct = (lo: number, hi: number) => clamp(Math.round((allocInRange(features, r.id, lo, hi) / (r.capacity || 100)) * 100), 0, 999);
        return (
          <div
            key={r.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
            onClick={() => setFilterResource(active ? null : r.id)}
            className="rounded px-2.5 py-2 cursor-pointer"
            title="Drag onto a box to assign · click to filter the canvas"
            style={{ background: active ? "#FFF7F1" : "#FFFFFF", border: active ? "1px solid #EE7240" : "1px solid #E2DFD9" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="mono"
                title={r.linkedUid ? "Linked to a real account" : "Freeform placeholder — not linked to an account"}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  background: colorForName(r.id),
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: r.linkedUid ? "0 0 0 2px #12A594" : "none",
                }}
              >
                {r.initials}
              </span>
              <div className="overflow-hidden flex-1">
                <div className="text-xs font-medium truncate" style={{ color: "#1F2330" }}>{r.name}</div>
                <div className="mono truncate" style={{ fontSize: 10, color: "#64748B" }}>{r.type || "—"} · limit {r.capacity}%</div>
              </div>
              {active && <span className="mono text-xs" style={{ color: "#EE7240" }}>●</span>}
              {canEdit && (
                <button
                  title="Duplicate this resource"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void duplicateResource(r.id);
                  }}
                  className="flex-shrink-0 rounded"
                  style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#F1F5F9" }}
                >
                  <Icon name="content_copy" size={12} style={{ color: "#64748B" }} />
                </button>
              )}
              {canEdit && (
                <button
                  title="Remove this resource"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmAt(e, { message: `Remove ${r.name}?`, detail: "They'll be unassigned from all tasks.", confirmLabel: "Remove" })) void removeResource(r.id);
                  }}
                  className="flex-shrink-0 rounded"
                  style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#FDEBEC" }}
                >
                  <Icon name="delete" size={13} style={{ color: "#9F1D23" }} />
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              {LOAD_WINDOWS.map((w) => {
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
            {canEdit && members.length > 0 && (
              <select
                value={r.linkedUid || ""}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => void patchResource(r.id, { linkedUid: e.target.value || null })}
                className="mono mt-1.5 w-full text-[10px] border rounded px-1 py-0.5"
                style={{ borderColor: "#E2DFD9", color: "#64748B" }}
                title="Link this Resource to a real Pulse member's account"
              >
                <option value="">not linked to an account</option>
                {members.map((m) => (
                  <option key={m.uid} value={m.uid}>🔗 {m.email}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
