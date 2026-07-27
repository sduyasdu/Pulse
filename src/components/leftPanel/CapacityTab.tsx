import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { usePulseStore } from "@/stores/pulseStore";
import { allocInRange, resourcePeakPct, utilizationPct } from "@/domain/assignments";
import { todayIndex } from "@/domain/dateUtils";
import { clamp } from "@/domain/constants";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { confirmAt } from "@/stores/confirmStore";
import { canViewPeopleCost } from "@/domain/permissions";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/i18n";

interface CapacityTabProps {
  canEdit: boolean;
}

// Persisted (across reloads) collapse state for the overview + types boxes.
// Absent key = collapsed, so it starts closed the first time.
const OVERVIEW_KEY = "pulse.capacity.overviewOpen";

/** $/h input. Local while typing, committed on blur or Enter — a rate write is a
 * document write, not something to fire per keystroke. Empty clears the rate,
 * which removes that person's labour rows rather than zeroing them (§8.8). */
function RateInput({ value, onCommit, title }: { value: number | null; onCommit: (v: number | null) => void; title: string }) {
  const [local, setLocal] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? local : value == null ? "" : String(value);
  const commit = () => {
    const n = Number(local);
    onCommit(local.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n);
  };
  return (
    <div className="flex items-center gap-0.5">
      <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>$</span>
      <input
        type="number"
        min="0"
        step="1"
        value={shown}
        title={title}
        placeholder="—"
        onFocus={() => { setLocal(value == null ? "" : String(value)); setFocused(true); }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="mono text-xs border rounded px-1 py-0.5 text-right"
        style={{ borderColor: "#E2DFD9", width: 58, flexShrink: 0 }}
      />
    </div>
  );
}

function ResourceNameInput({ name, disabled, onCommit, renameTitle }: { name: string; disabled: boolean; onCommit: (name: string) => void; renameTitle: string }) {
  const [local, onChange] = useDebouncedText(name, onCommit);
  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      title={disabled ? undefined : renameTitle}
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
  const t = useT();
  const resources = usePulseStore((s) => s.resources);
  const features = usePulseStore((s) => s.features);
  const pulse = usePulseStore((s) => s.pulse);
  const patchResource = usePulseStore((s) => s.patchResource);
  const setResourceTypes = usePulseStore((s) => s.setResourceTypes);
  const rates = usePulseStore((s) => s.rates);
  const members = usePulseStore((s) => s.members);
  const setRate = usePulseStore((s) => s.setRate);
  const uid = useAuthStore((s) => s.firebaseUser?.uid);

  // Pay rates are admin-only (Costs-Spec §8.7 / CO15).
  const me = uid ? members.find((m) => m.uid === uid) : undefined;
  const seesPeopleCost = !!me && canViewPeopleCost(me);
  const rateOf = (rid: string) => rates.find((x) => x.resourceId === rid)?.hourlyCost ?? null;

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
    const n = window.prompt(t("capacity.newTypePrompt"));
    if (n && n.trim() && !resourceTypes.includes(n.trim())) void setResourceTypes([...resourceTypes, n.trim()]);
  };
  const renameType = (type: string) => {
    const nn = window.prompt(t("capacity.renameTypePrompt"), type);
    if (!nn || !nn.trim() || nn.trim() === type) return;
    void setResourceTypes(resourceTypes.map((x) => (x === type ? nn.trim() : x)));
    resources.filter((r) => r.type === type).forEach((r) => void patchResource(r.id, { type: nn.trim() }));
  };
  const deleteType = async (type: string, e: { clientX: number; clientY: number }) => {
    if (await confirmAt(e, { message: t("capacity.deleteTypeMsg", { type }), detail: t("capacity.deleteTypeDetail") })) {
      void setResourceTypes(resourceTypes.filter((x) => x !== type));
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <button
        onClick={toggleOverview}
        className="flex items-center justify-between rounded px-3 py-2"
        style={{ border: "1px solid #E2DFD9", background: "#F8FAFC" }}
        title={showOverview ? t("capacity.hideOverview") : t("capacity.showOverview")}
      >
        <span className="mono text-xs" style={{ color: "#64748B" }}>{t("capacity.overviewHeading")}</span>
        <span className="flex items-center gap-2">
          {overLimit > 0 && <span className="mono text-xs font-semibold" style={{ color: "#E5484D" }}>{t("capacity.overLimit", { n: overLimit })}</span>}
          <Icon name={showOverview ? "keyboard_arrow_down" : "chevron_right"} size={14} style={{ color: "#64748B" }} />
        </span>
      </button>

      {showOverview && (
        <>
          <div className="rounded px-3 py-2.5" style={{ background: "#F8FAFC", border: "1px solid #EEF1F4" }}>
            <div className="flex justify-between mb-1">
              <span className="mono text-xs" style={{ color: "#64748B" }}>{t("capacity.teamPeak")}</span>
              <span className="mono text-xs font-semibold" style={{ color: "#334155" }}>{t("capacity.overLimit", { n: overLimit })}</span>
            </div>
            <div className="mono text-xs" style={{ color: "#78859A" }}>{t("capacity.peakNote")}</div>
          </div>

      <div className="rounded px-3 py-2.5" style={{ border: "1px solid #E2DFD9" }}>
        <div className="flex items-center justify-between">
          <span className="mono text-xs" style={{ color: "#64748B" }}>{t("capacity.resourceTypes")}</span>
          {canEdit && (
            <button onClick={addType} className="mono text-xs px-2 py-0.5 rounded" style={{ background: "#F7E8DA", color: "#D85A28" }}>{t("capacity.add")}</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {resourceTypes.map((rt) => (
            <span key={rt} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: "#F1F5F9", color: "#475569" }}>
              {rt}
              {canEdit && (
                <>
                  <button onClick={() => renameType(rt)} title={t("capacity.rename")}><Icon name="edit" size={12} style={{ color: "#64748B" }} /></button>
                  <button onClick={(e) => void deleteType(rt, e)} title={t("common.delete")}><Icon name="close" size={12} style={{ color: "#64748B" }} /></button>
                </>
              )}
            </span>
          ))}
          {resourceTypes.length === 0 && <span className="mono text-xs" style={{ color: "#78859A" }}>{t("capacity.noTypes")}</span>}
        </div>
      </div>
        </>
      )}

      <div className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ border: "1px solid #E2DFD9", background: "#FDFCF8" }}>
        <Icon name="search" size={13} style={{ color: "#64748B" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("capacity.filterPlaceholder")}
          className="bg-transparent text-xs flex-1"
          style={{ color: "#1F2330", outline: "none", minWidth: 0 }}
        />
        <span className="mono text-xs" style={{ color: "#94A3B8" }}>{filtered.length}</span>
        {query && (
          <button onClick={() => setQuery("")}>
            <Icon name="close" size={12} style={{ color: "#64748B" }} />
          </button>
        )}
      </div>

      {filtered.length === 0 && resources.length > 0 && (
        <p className="mono text-xs text-center py-2" style={{ color: "#94A3B8" }}>{t("capacity.noMatch", { query })}</p>
      )}

      {filtered.map((r) => {
        const pct = utilizationPct(features, r);
        const peak = resourcePeakPct(features, r.id);
        const loadPct = (lo: number, hi: number) => clamp(Math.round((allocInRange(features, r.id, lo, hi) / (r.capacity || 100)) * 100), 0, 999);
        const rows = features.filter((f) => (f.resources || []).includes(r.id) || (f.children || []).some((c) => (c.resources || []).includes(r.id)));
        return (
          <div key={r.id} className="rounded px-3 py-3" style={{ border: "1px solid #E2DFD9" }}>
            <div className="flex items-center gap-2">
              <ResourceBadge resourceId={r.id} size={24} />
              <div className="flex-1 overflow-hidden">
                <ResourceNameInput name={r.name} disabled={!canEdit} onCommit={(name) => void patchResource(r.id, { name })} renameTitle={t("capacity.clickToRename")} />
                <div className="mono text-xs" style={{ color: "#64748B" }}>{t("capacity.peakLine", { peak, limit: r.capacity, used: pct })}</div>
              </div>
              {rows.length === 0 && <span className="mono text-xs px-1.5 py-0.5 rounded" style={{ background: "#F1F5F9", color: "#64748B" }}>{t("capacity.idle")}</span>}
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
                <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("capacity.type")}</span>
                <select
                  value={r.type || ""}
                  disabled={!canEdit}
                  onChange={(e) => void patchResource(r.id, { type: e.target.value || null })}
                  className="mono text-xs border rounded px-1 py-0.5 w-full"
                  style={{ borderColor: "#E2DFD9" }}
                >
                  <option value="">{t("common.none")}</option>
                  {resourceTypes.map((rt) => (
                    <option key={rt} value={rt}>{rt}</option>
                  ))}
                  {r.type && !resourceTypes.includes(r.type) && <option value={r.type}>{r.type}</option>}
                </select>
              </div>
              <div style={{ width: 112 }}>
                <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("capacity.limitPct")}</span>
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
              {/* Hourly cost — admins only (Costs-Spec §8.7). The control simply
                  doesn't exist for anyone else, and the underlying document is
                  unreadable to them, so hiding it isn't the security boundary. */}
              {seesPeopleCost && (
                <div style={{ width: 78 }}>
                  <span className="mono" style={{ fontSize: 9, color: "#0E7490" }}>{t("capacity.hourlyCost")}</span>
                  <RateInput
                    value={rateOf(r.id)}
                    onCommit={(v) => void setRate(r.id, v)}
                    title={t("capacity.hourlyCostTitle")}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>{t("capacity.limitNote")}</p>
    </div>
  );
}
