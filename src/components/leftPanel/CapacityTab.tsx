import { usePulseStore } from "@/stores/pulseStore";
import { resourcePeakPct, utilizationPct } from "@/domain/assignments";
import { clamp } from "@/domain/constants";
import { useDebouncedText } from "@/hooks/useDebouncedText";

interface CapacityTabProps {
  canEdit: boolean;
}

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

  const resourceTypes = pulse?.resourceTypes ?? [];
  const overLimit = resources.filter((r) => utilizationPct(features, r) > 100).length;

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
      <div className="rounded px-3 py-2.5" style={{ background: "#F8FAFC", border: "1px solid #EEF1F4" }}>
        <div className="flex justify-between mb-1">
          <span className="mono text-xs" style={{ color: "#64748B" }}>TEAM — PEAK vs LIMIT</span>
          <span className="mono text-xs font-semibold" style={{ color: "#334155" }}>{overLimit} over limit</span>
        </div>
        <div className="mono text-xs" style={{ color: "#78859A" }}>each bar = busiest-day load ÷ occupation limit</div>
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

      {resources.map((r) => {
        const pct = utilizationPct(features, r);
        const peak = resourcePeakPct(features, r.id);
        const barColor = pct >= 100 ? "#E5484D" : pct >= 70 ? "#F5A524" : "#12A594";
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
            <div className="mt-2" style={{ height: 5, background: "#F1F5F9", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${clamp(pct, 0, 100)}%`, background: barColor }} />
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
