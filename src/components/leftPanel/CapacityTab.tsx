import { useState } from "react";
import { usePulseStore } from "@/stores/pulseStore";
import { allocInRange, resourcePeakPct, utilizationPct } from "@/domain/assignments";
import { todayIndex } from "@/domain/dateUtils";
import { clamp } from "@/domain/constants";
import { useDebouncedText } from "@/hooks/useDebouncedText";

interface CapacityTabProps {
  canEdit: boolean;
}

// Persisted (across reloads) collapse state for the overview + types boxes.
// Absent key = collapsed, so it starts closed the first time.
const OVERVIEW_KEY = "pulse.capacity.overviewOpen";

function ResourceNameInput({ name, disabled, onCommit }: { name: string; disabled: boolean; onCommit: (name: string) => void }) {
  const [local, onChange] = useDebouncedText(name, onCommit);
  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      title={disabled ? undefined : "Click to rename"}
      className="text-sm font-medium w-full rounded px-1.5 py-0.5"
      style={{
        color: "#1F2330",
        background: disabled ? "transparent" : "#F8FAFC",
        border: "1px solid " + (disabled ? "transparent" : "#E2DFD9"),
        outline: "none",
      }}
    />
  );
}

export function CapacityTab({ canEdit }: CapacityTabProps) {
  const resources = usePulseStore((s) => s.resources);
  const features = usePulseStore((s) => s.features);
  const pulse = usePulseStore((s) => s.pulse);
  const patchResource = usePulseStore((s) => s.patchResource);
  const setResourceTypes = usePulseStore((s) => s.setResourceTypes);

  const [query, setQuery] = useState("");
  const [showOverview, setShowOverview] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OVERVIEW_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleOverview = () =>
    setShowOverview((v) => {
      const next = !v;
      try {
        localStorage.setItem(OVERVIEW_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable (private mode) — state just won't persist
      }
      return next;
    });

  const resourceTypes = pulse?.resourceTypes ?? [];
  const overLimit = resources.filter((r) => utilizationPct(features, r) > 100).length;

  const q = query.trim().toLowerCase();
  const filtered = resources.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.type || "").toLowerCase().includes(q));

  // Three forward 4-week windows from today for the per-resource load
  // indicators (avg allocation over the window ÷ the person's capacity).
  const today = todayIndex();
  const LOAD_WINDOWS = [
    { label: "1–4w", lo: today, hi: today + 28 },
    { label: "5–8w", lo: today + 28, hi: today + 56 },
    { label: "9–12w", lo: today + 56, hi: today + 84 },
  ];

  const addType = () => {
    const n = window.prompt("New resource type:");
    if (n && n.trim() && !resourceTypes.includes(n.trim())) void setResourceTypes([...resourceTypes, n.trim()]);
  };
  const renameType = (t: string) => {
    const nn = window.prompt("Rename type:", t);
    if (!nn || !nn.trim() || nn.trim() === t) return;
    void setResourceTypes(resourceTypes.map((x) => (x === t ? nn.trim() : x)));
    resources.filter((r) => r.type === t).forEach((r) => void patchResource(r.id, { type: nn.trim() }));
  };
  const deleteType = (t: string) => {
    if (window.confirm(`Delete type "${t}"? Resources keep the label but it leaves the list.`)) {
      void setResourceTypes(resourceTypes.filter((x) => x !== t));
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <button
        onClick={toggleOverview}
        className="flex items-center justify-between rounded px-3 py-2"
        style={{ border: "1px solid #E2DFD9", background: "#F8FAFC" }}
        title={showOverview ? "Hide overview & resource types" : "Show overview & resource types"}
      >
        <span className="mono text-xs" style={{ color: "#64748B" }}>OVERVIEW &amp; RESOURCE TYPES</span>
        <span className="flex items-center gap-2">
          {overLimit > 0 && <span className="mono text-xs font-semibold" style={{ color: "#E5484D" }}>{overLimit} over limit</span>}
          <span style={{ fontSize: 12, color: "#64748B" }}>{showOverview ? "▾" : "▸"}</span>
        </span>
      </button>

      {showOverview && (
        <>
          <div className="rounded px-3 py-2.5" style={{ background: "#F8FAFC", border: "1px solid #EEF1F4" }}>
            <div className="flex justify-between mb-1">
              <span className="mono text-xs" style={{ color: "#64748B" }}>TEAM — PEAK vs LIMIT</span>
              <span className="mono text-xs font-semibold" style={{ color: "#334155" }}>{overLimit} over limit</span>
            </div>
            <div className="mono text-xs" style={{ color: "#78859A" }}>per-person bars = avg load in weeks 1–4 · 5–8 · 9–12 ÷ occupation limit</div>
          </div>

      <div className="rounded px-3 py-2.5" style={{ border: "1px solid #E2DFD9" }}>
        <div className="flex items-center justify-between">
          <span className="mono text-xs" style={{ color: "#64748B" }}>RESOURCE TYPES</span>
          {canEdit && (
            <button onClick={addType} className="mono text-xs px-2 py-0.5 rounded" style={{ background: "#F7E8DA", color: "#D85A28" }}>+ add</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {resourceTypes.map((t) => (
            <span key={t} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: "#F1F5F9", color: "#475569" }}>
              {t}
              {canEdit && (
                <>
                  <button onClick={() => renameType(t)} title="Rename"><span style={{ fontSize: 9, color: "#64748B" }}>✎</span></button>
                  <button onClick={() => deleteType(t)} title="Delete"><span style={{ fontSize: 9, color: "#64748B" }}>✕</span></button>
                </>
              )}
            </span>
          ))}
          {resourceTypes.length === 0 && <span className="mono text-xs" style={{ color: "#78859A" }}>no types yet</span>}
        </div>
      </div>
        </>
      )}

      <div className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ border: "1px solid #E2DFD9", background: "#FDFCF8" }}>
        <span style={{ fontSize: 12, color: "#64748B" }}>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or type…"
          className="bg-transparent text-xs flex-1"
          style={{ color: "#1F2330", outline: "none", minWidth: 0 }}
        />
        <span className="mono text-xs" style={{ color: "#94A3B8" }}>{filtered.length}</span>
        {query && (
          <button onClick={() => setQuery("")}>
            <span style={{ fontSize: 11, color: "#64748B" }}>✕</span>
          </button>
        )}
      </div>

      {filtered.length === 0 && resources.length > 0 && (
        <p className="mono text-xs text-center py-2" style={{ color: "#94A3B8" }}>No people match “{query}”.</p>
      )}

      {filtered.map((r) => {
        const pct = utilizationPct(features, r);
        const peak = resourcePeakPct(features, r.id);
        const loadPct = (lo: number, hi: number) => clamp(Math.round((allocInRange(features, r.id, lo, hi) / (r.capacity || 100)) * 100), 0, 999);
        const rows = features.filter((f) => (f.resources || []).includes(r.id) || (f.children || []).some((c) => (c.resources || []).includes(r.id)));
        return (
          <div key={r.id} className="rounded px-3 py-3" style={{ border: "1px solid #E2DFD9" }}>
            <div className="flex items-center gap-2">
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#6366F1", width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {r.initials}
              </span>
              <div className="flex-1 overflow-hidden">
                <ResourceNameInput name={r.name} disabled={!canEdit} onCommit={(name) => void patchResource(r.id, { name })} />
                <div className="mono text-xs" style={{ color: "#64748B" }}>peak {peak}% · limit {r.capacity}% · {pct}% used</div>
              </div>
              {rows.length === 0 && <span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: "#F1F5F9", color: "#64748B" }}>idle</span>}
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
                    <div style={{ height: 5, background: "#F1F5F9", borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
                      <div style={{ height: "100%", width: `${clamp(load, 0, 100)}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1">
                <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>TYPE</span>
                <select
                  value={r.type || ""}
                  disabled={!canEdit}
                  onChange={(e) => void patchResource(r.id, { type: e.target.value || null })}
                  className="mono text-xs border rounded px-1 py-0.5 w-full"
                  style={{ borderColor: "#E2DFD9" }}
                >
                  <option value="">— none —</option>
                  {resourceTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {r.type && !resourceTypes.includes(r.type) && <option value={r.type}>{r.type}</option>}
                </select>
              </div>
              <div style={{ width: 112 }}>
                <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>LIMIT %</span>
                <div className="flex items-center gap-1">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    disabled={!canEdit}
                    value={r.capacity}
                    onChange={(e) => void patchResource(r.id, { capacity: parseInt(e.target.value, 10) })}
                    className="flex-1"
                    style={{ accentColor: "#EE7240", minWidth: 0 }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={!canEdit}
                    value={r.capacity}
                    onChange={(e) => void patchResource(r.id, { capacity: clamp(parseInt(e.target.value || "0", 10), 0, 100) })}
                    className="mono text-xs border rounded px-1 py-0.5 text-right"
                    style={{ borderColor: "#E2DFD9", width: 54, flexShrink: 0 }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>Limit is the max % a person may be assigned. Bars show their busiest-day load against that limit; red means over-allocated.</p>
    </div>
  );
}
