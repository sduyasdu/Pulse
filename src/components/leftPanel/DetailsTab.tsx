import { useState } from "react";
import type { Feature, Subtask } from "@/types";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import {
  allocSum,
  assignedEffort,
  durationForAssignedResources,
  elapsedOf,
  estimateEffort,
  graphEffort,
  isEstimateLocked,
  theoreticalElapsed,
} from "@/domain/graphEffort";
import { dayIndexFromDateInputValue, fmtDate, toDateInputValue } from "@/domain/dateUtils";
import { STATUS_META, LABEL_COLORS, colorForName } from "@/domain/constants";
import { Attachments } from "@/components/shared/Attachments";
import { useDebouncedText } from "@/hooks/useDebouncedText";

interface DetailsTabProps {
  feature: Feature;
  canEdit: boolean;
  onClose: () => void;
  onDuplicate: () => void;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function DetailsTab({ feature, canEdit, onClose, onDuplicate }: DetailsTabProps) {
  const epics = usePulseStore((s) => s.epics);
  const resources = usePulseStore((s) => s.resources);
  const pulse = usePulseStore((s) => s.pulse);
  const patchFeature = usePulseStore((s) => s.patchFeature);
  const moveFeatureToEpic = usePulseStore((s) => s.moveFeatureToEpic);
  const removeFeature = usePulseStore((s) => s.removeFeature);
  const setAlloc = usePulseStore((s) => s.setAlloc);
  const unassignResource = usePulseStore((s) => s.unassignResource);
  const addSubtask = usePulseStore((s) => s.addSubtask);
  const patchSubtask = usePulseStore((s) => s.patchSubtask);
  const removeSubtask = usePulseStore((s) => s.removeSubtask);
  const toggleSubtaskResource = usePulseStore((s) => s.toggleSubtaskResource);
  const addAttachment = usePulseStore((s) => s.addAttachment);
  const removeAttachment = usePulseStore((s) => s.removeAttachment);

  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});
  const [title, onTitleChange] = useDebouncedText(feature.title, (v) => void patchFeature(feature.id, { title: v }));

  const graph = graphConfigOf(pulse);
  const elapsed = elapsedOf(feature);
  const theo = theoreticalElapsed(feature, graph);
  const graph_ = graphEffort(feature, graph);
  const est = estimateEffort(feature, graph);
  const estFixed = isEstimateLocked(feature);
  const assigned = assignedEffort(feature);
  const hasRes = allocSum(feature) > 0;
  const gap = round1(assigned - est);
  const over = gap > 0.05;
  const under = gap < -0.05;
  const stateColor = !hasRes ? "#94A3B8" : over ? "#92400E" : under ? "#9F1D23" : "#0F6B5C";
  const stateBg = !hasRes ? "#F1F5F9" : over ? "#FFF6E2" : under ? "#FDEBEC" : "#E6F7F4";

  const adjustLengthToResources = () => {
    const duration = durationForAssignedResources(feature, graph);
    if (duration != null) void patchFeature(feature.id, { duration });
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold mono" style={{ color: "#64748B" }}>TASK DETAILS</span>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <button
              title="Duplicate task"
              onClick={onDuplicate}
              className="rounded"
              style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "#F1F5F9" }}
            >
              <span style={{ fontSize: 12, color: "#64748B" }}>⧉</span>
            </button>
            <button
              title="Delete task"
              onClick={() => {
                if (window.confirm(`Delete task "${feature.title}"? You can undo this (⌘Z).`)) {
                  void removeFeature(feature.id);
                  onClose();
                }
              }}
              className="rounded"
              style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "#FDEBEC" }}
            >
              <span style={{ fontSize: 11, color: "#9F1D23" }}>🗑</span>
            </button>
          </div>
        )}
      </div>

      <input
        value={title}
        disabled={!canEdit}
        onChange={(e) => onTitleChange(e.target.value)}
        className="text-sm font-semibold border rounded px-2 py-1.5"
        style={{ borderColor: "#E2DFD9" }}
      />

      <div className="flex gap-2">
        <div className="flex-1">
          <span className="mono text-xs" style={{ color: "#64748B" }}>EPIC</span>
          <select
            value={feature.epicId || ""}
            disabled={!canEdit}
            onChange={(e) => void moveFeatureToEpic(feature.id, e.target.value || null)}
            className="mt-1 w-full text-sm border rounded px-2 py-1.5"
            style={{ borderColor: "#E2DFD9" }}
          >
            <option value="">— none —</option>
            {epics.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <span className="mono text-xs" style={{ color: "#64748B" }}>TEAM LEADER</span>
          <select
            value={feature.lead || ""}
            disabled={!canEdit}
            onChange={(e) => void patchFeature(feature.id, { lead: e.target.value || null })}
            className="mt-1 w-full text-sm border rounded px-2 py-1.5"
            style={{ borderColor: feature.lead ? "#F5A524" : "#E2DFD9" }}
          >
            <option value="">— none —</option>
            {(feature.resources || []).map((r) => (
              <option key={r} value={r}>★ {resources.find((x) => x.id === r)?.name || r}</option>
            ))}
          </select>
          {(feature.resources || []).length === 0 && <div className="mono text-xs mt-1" style={{ color: "#78859A" }}>assign someone first</div>}
        </div>
      </div>

      <div>
        <span className="mono text-xs" style={{ color: "#64748B" }}>
          SUBTASKS {(feature.children || []).length > 0 && `(${feature.children!.length})`}
        </span>
        <div className="flex flex-col gap-1.5 mt-2">
          {(feature.children || []).length === 0 && <span className="mono text-xs" style={{ color: "#78859A" }}>No subtasks yet — break this feature into steps.</span>}
          {(feature.children || []).map((c) => {
            const cm = STATUS_META[c.status];
            const open = !!expandedSubs[c.id];
            return (
              <div key={c.id} className="rounded" style={{ border: "1px solid #E2DFD9" }}>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button onClick={() => setExpandedSubs((s) => ({ ...s, [c.id]: !s[c.id] }))} title={open ? "Collapse" : "Expand"} style={{ flexShrink: 0, width: 16 }}>
                    <span style={{ fontSize: 12, color: "#64748B" }}>{open ? "▾" : "▸"}</span>
                  </button>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: cm.border, flexShrink: 0 }} />
                  <SubtaskTitleInput title={c.title} disabled={!canEdit} onCommit={(v) => void patchSubtask(feature.id, c.id, { title: v })} />
                  {(c.resources || []).length > 0 && <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{c.resources.length}👤</span>}
                  {canEdit && (
                    <button onClick={() => window.confirm(`Delete subtask "${c.title}"?`) && void removeSubtask(feature.id, c.id)} title="Delete subtask">
                      <span style={{ fontSize: 12, color: "#64748B" }}>✕</span>
                    </button>
                  )}
                </div>
                {open && (
                  <div className="px-2 pb-2 border-t" style={{ borderColor: "#F1F5F9" }}>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <select
                        value={c.status}
                        disabled={!canEdit}
                        onChange={(e) => void patchSubtask(feature.id, c.id, { status: e.target.value as Subtask["status"] })}
                        className="mono text-xs border rounded px-1 py-0.5 flex-1"
                        style={{ borderColor: "#E2DFD9" }}
                      >
                        {Object.entries(STATUS_META).map(([k, m]) => (
                          <option key={k} value={k}>{m.label}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <button disabled={!canEdit} onClick={() => void patchSubtask(feature.id, c.id, { effort: Math.max(1, (c.effort || 1) - 1) })} className="px-1 rounded border" style={{ borderColor: "#E2DFD9", fontSize: 11 }}>−</button>
                        <span className="mono text-xs w-8 text-center" style={{ color: "#334155" }}>{c.effort || 1}e</span>
                        <button disabled={!canEdit} onClick={() => void patchSubtask(feature.id, c.id, { effort: (c.effort || 1) + 1 })} className="px-1 rounded border" style={{ borderColor: "#E2DFD9", fontSize: 11 }}>+</button>
                      </div>
                    </div>
                    <div className="mt-1.5">
                      <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>assigned:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {resources.map((res) => {
                          const on = (c.resources || []).includes(res.id);
                          return (
                            <button
                              key={res.id}
                              disabled={!canEdit}
                              onClick={() => void toggleSubtaskResource(feature.id, c.id, res.id)}
                              title={res.name}
                              className="mono"
                              style={{ fontSize: 9, fontWeight: 700, width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: on ? "#fff" : "#64748B", background: on ? colorForName(res.id) : "#F1F5F9", border: on ? "none" : "1px solid #E2DFD9", opacity: on ? 1 : 0.7 }}
                            >
                              {res.initials}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-1.5">
                      <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>attachments:</span>
                      <div className="mt-1">
                        <Attachments
                          compact
                          canEdit={canEdit}
                          items={c.attachments}
                          onAdd={(t, u) => void addAttachment(feature.id, t, u, c.id)}
                          onDelete={(aid) => void removeAttachment(feature.id, aid, c.id)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button onClick={() => void addSubtask(feature.id)} className="mono text-xs flex items-center justify-center gap-1 w-full mt-2 py-1.5 rounded" style={{ background: "#F7E8DA", color: "#D85A28", border: "1px dashed #F0A875" }}>
            + add subtask
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="mono text-xs" style={{ color: "#64748B" }}>RESOURCES & % TIME</span>
          <span className="mono text-xs" style={{ color: "#64748B" }}>★ = team leader</span>
        </div>
        <div className="flex flex-col gap-2 mt-2">
          {(feature.resources || []).length === 0 && <span className="text-xs" style={{ color: "#9F1D23" }}>No one assigned — drag someone from the Team tab onto this box</span>}
          {(feature.resources || []).map((r) => {
            const pctVal = feature.alloc?.[r] ?? 100;
            const isLead = feature.lead === r;
            return (
              <div key={r} className="rounded px-2 py-2" style={{ border: isLead ? "1px solid #F5A524" : "1px solid #E2DFD9", background: isLead ? "#FFFBEB" : "#fff" }}>
                <div className="flex items-center gap-2">
                  <button disabled={!canEdit} title={isLead ? "Team leader — click to unset" : "Make team leader"} onClick={() => void patchFeature(feature.id, { lead: isLead ? null : r })} style={{ fontSize: 13, lineHeight: 1, color: isLead ? "#F5A524" : "#CBD5E1", flexShrink: 0 }}>★</button>
                  <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: colorForName(r), width: 18, height: 18, borderRadius: isLead ? 4 : "50%", border: isLead ? "2px solid #F5A524" : "none", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {resources.find((x) => x.id === r)?.initials || "?"}
                  </span>
                  <span className="text-xs flex-1" style={{ color: "#334155" }}>
                    {resources.find((x) => x.id === r)?.name || r}
                    {isLead && <span className="mono ml-1" style={{ fontSize: 9, color: "#B45309" }}>lead</span>}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="5"
                    disabled={!canEdit}
                    value={pctVal}
                    onChange={(e) => void setAlloc(feature.id, r, Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10))))}
                    className="mono text-xs text-right border rounded px-1 py-0.5"
                    style={{ width: 48, borderColor: "#E2DFD9" }}
                  />
                  <span className="mono text-xs" style={{ color: "#64748B" }}>%</span>
                  {canEdit && (
                    <button onClick={() => void unassignResource(feature.id, r)}>
                      <span style={{ fontSize: 12, color: "#64748B" }}>✕</span>
                    </button>
                  )}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  disabled={!canEdit}
                  value={pctVal}
                  onChange={(e) => void setAlloc(feature.id, r, parseInt(e.target.value, 10))}
                  className="w-full mt-1.5"
                  style={{ accentColor: colorForName(r) }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded px-3 py-2.5" style={{ border: "1px solid #E2DFD9" }}>
        <div className="flex items-center justify-between">
          <span className="mono text-xs" style={{ color: "#64748B" }}>SCHEDULE &amp; EFFORT</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 mono text-xs cursor-pointer" style={{ color: feature.useWeekends ? "#D85A28" : "#94A3B8" }} title="Count weekends as working days (urgent)">
              <input type="checkbox" disabled={!canEdit} checked={!!feature.useWeekends} onChange={(e) => void patchFeature(feature.id, { useWeekends: e.target.checked })} /> weekends
            </label>
            {canEdit && (
              <button
                onClick={() => void patchFeature(feature.id, { plannedX: feature.x, plannedDuration: feature.duration })}
                title="Freeze the current dates as the plan (won't move when you drag)"
                className="mono text-xs px-2 py-0.5 rounded"
                style={{ background: "#EEF2FF", color: "#4338CA" }}
              >
                📌 set plan
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <input
            type="date"
            disabled={!canEdit}
            value={toDateInputValue(feature.x)}
            title="Start date — moves the whole box, keeping its duration"
            onChange={(e) => {
              if (!e.target.value) return;
              void patchFeature(feature.id, { x: dayIndexFromDateInputValue(e.target.value) });
            }}
            className="text-sm border rounded px-1.5 py-1"
            style={{ borderColor: "#E2DFD9", color: "#334155" }}
          />
          <span className="text-sm" style={{ color: "#334155" }}>→ {fmtDate(feature.x + feature.duration)}</span>
          <span className="mono text-xs" style={{ color: "#94A3B8" }}>{feature.duration} cal · {elapsed} wd{feature.useWeekends ? " · wknd on" : ""}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded px-2 py-1.5" style={{ background: "#F8FAFC" }}>
            <div className="mono" style={{ fontSize: 9, color: "#64748B" }}>ELAPSED TIME</div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: "#1F2330" }}>{elapsed} <span className="text-xs font-normal" style={{ color: "#64748B" }}>wd</span></div>
            <div className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>box length</div>
          </div>
          <div className="rounded px-2 py-1.5" style={{ background: "#F8FAFC" }}>
            <div className="mono" style={{ fontSize: 9, color: "#64748B" }}>THEOR. ELAPSED</div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: theo != null ? "#1F2330" : "#B4BECC" }}>{theo != null ? `${theo} wd` : "—"}</div>
            <div className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>estimate ÷ resources</div>
          </div>
          <div className="rounded px-2 py-1.5" style={{ background: "#F8FAFC" }}>
            <div className="mono" style={{ fontSize: 9, color: "#64748B" }}>GRAPH EFFORT</div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: "#1F2330" }}>{graph_} <span className="text-xs font-normal" style={{ color: "#64748B" }}>md</span></div>
            <div className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>{elapsed}wd × {feature.work ?? feature.effort ?? 1} work</div>
          </div>
          <div className="rounded px-2 py-1.5" style={{ background: estFixed ? "#FFF7F1" : "#F8FAFC", border: estFixed ? "1px solid #F0A875" : "1px solid transparent" }}>
            <div className="mono flex items-center justify-between" style={{ fontSize: 9, color: "#64748B" }}>
              <span>ESTIMATE EFFORT</span>
              {canEdit &&
                (estFixed ? (
                  <button title="Reset to Graph Effort" onClick={() => void patchFeature(feature.id, { estEffort: null })}>
                    <span style={{ fontSize: 10, color: "#D85A28" }}>↺</span>
                  </button>
                ) : (
                  <button title="Fix this value" onClick={() => void patchFeature(feature.id, { estEffort: graph_ })}>
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>🔒</span>
                  </button>
                ))}
            </div>
            <div className="flex items-baseline gap-1">
              <input
                type="number"
                min="0"
                step="0.5"
                disabled={!canEdit}
                value={est}
                onChange={(e) => void patchFeature(feature.id, { estEffort: Math.max(0, parseFloat(e.target.value || "0")) })}
                className="text-sm font-semibold border rounded px-1 py-0.5 w-full mt-0.5"
                style={{ borderColor: "#E2DFD9", color: "#1F2330", background: estFixed ? "#fff" : "#F1F5F9" }}
              />
              <span className="text-xs" style={{ color: "#64748B" }}>md</span>
            </div>
            <div className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>{estFixed ? "fixed manually" : "= graph effort"}</div>
          </div>
          <div className="rounded px-2 py-1.5 col-span-2" style={{ background: stateBg }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="mono" style={{ fontSize: 9, color: "#64748B" }}>ASSIGNED EFFORT</div>
                <div className="text-sm font-semibold" style={{ color: stateColor }}>{hasRes ? `${assigned} md` : "—"}</div>
                <div className="mono" style={{ fontSize: 8, color: "#94A3B8" }}>{elapsed}wd × Σ resources %</div>
              </div>
              <div className="text-right">
                <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: stateColor }}>{!hasRes ? "no resources" : over ? "over-assigned" : under ? "under-assigned" : "✓ balanced"}</div>
                {hasRes && <div className="mono" style={{ fontSize: 10, color: stateColor, fontWeight: 600 }}>{gap > 0 ? "+" : ""}{gap} md vs est.</div>}
              </div>
            </div>
          </div>
        </div>

        {canEdit && (
          <button
            onClick={adjustLengthToResources}
            disabled={!hasRes}
            title="Set the box length so the assigned resources deliver the Estimate Effort"
            className="mono text-xs w-full mt-2 py-1.5 rounded flex items-center justify-center gap-1"
            style={{ background: hasRes ? "#F7E8DA" : "#F1F5F9", color: hasRes ? "#D85A28" : "#B4BECC", border: "1px solid " + (hasRes ? "#F0A875" : "#E2DFD9") }}
          >
            ⇥ adjust length to resources
          </button>
        )}
        <div className="mono mt-2" style={{ fontSize: 9, color: "#94A3B8" }}>
          {elapsed}wd over {feature.duration} calendar days · {feature.useWeekends ? "weekends count as working days" : "weekdays only"}.
        </div>

        {feature.plannedX != null && (
          <div className="mt-2 rounded px-2 py-1.5" style={{ background: "#F8FAFC", border: "1px solid #EEF1F4" }}>
            <div className="flex items-center justify-between">
              <span className="mono text-xs" style={{ color: "#64748B" }}>PLAN (frozen)</span>
              {canEdit && (
                <button onClick={() => void patchFeature(feature.id, { plannedX: null, plannedDuration: null })} title="Clear the frozen plan">
                  <span style={{ fontSize: 11, color: "#94A3B8" }}>✕</span>
                </button>
              )}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#334155" }}>
              {fmtDate(feature.plannedX)} → {fmtDate(feature.plannedX + (feature.plannedDuration ?? 0))}
            </div>
            {(() => {
              const dStart = feature.x - (feature.plannedX ?? 0);
              const late = dStart > 0;
              return (
                <div className="mono text-xs mt-1" style={{ color: dStart === 0 ? "#0F6B5C" : late ? "#9F1D23" : "#0F6B5C", fontWeight: 600 }}>
                  {dStart === 0 ? "✓ started on plan" : late ? `▶ start delayed ${dStart}d` : `◀ started ${-dStart}d early`}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <div>
        <span className="mono text-xs" style={{ color: "#64748B" }}>STATUS</span>
        <select
          value={feature.status}
          disabled={!canEdit}
          onChange={(e) => void patchFeature(feature.id, { status: e.target.value as Feature["status"] })}
          className="mt-1 w-full text-sm border rounded px-2 py-1.5"
          style={{ borderColor: "#E2DFD9" }}
        >
          {Object.entries(STATUS_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </select>
      </div>

      <div>
        <span className="mono text-xs" style={{ color: "#64748B" }}>LABEL COLOR <span style={{ opacity: 0.7 }}>(group related tasks)</span></span>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {LABEL_COLORS.map((lc) => {
            const active = (feature.labelColor || null) === lc.color;
            return (
              <button
                key={lc.id}
                disabled={!canEdit}
                title={lc.name}
                onClick={() => void patchFeature(feature.id, { labelColor: lc.color })}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: lc.color || "#fff",
                  border: lc.color ? (active ? "2px solid #123359" : "2px solid #fff") : "1px dashed #CBD5E1",
                  boxShadow: active ? "0 0 0 2px #EE7240" : "0 0 0 1px rgba(15,23,42,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                {!lc.color && <span style={{ fontSize: 11, color: "#64748B" }}>∅</span>}
                {lc.color && active && <span style={{ fontSize: 12, color: "#fff" }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: "#334155" }}>
        <input type="checkbox" disabled={!canEdit} checked={!!feature.ai} onChange={(e) => void patchFeature(feature.id, { ai: e.target.checked })} /> AI-assisted estimate <span style={{ fontSize: 13, color: "#8B5CF6" }}>✨</span>
      </label>

      <Attachments
        canEdit={canEdit}
        items={feature.attachments}
        onAdd={(t, u) => void addAttachment(feature.id, t, u)}
        onDelete={(aid) => void removeAttachment(feature.id, aid)}
      />

    </div>
  );
}

function SubtaskTitleInput({ title, disabled, onCommit }: { title: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [local, onChange] = useDebouncedText(title, onCommit);
  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs font-medium flex-1 bg-transparent"
      style={{ border: "none", outline: "none", color: "#334155", minWidth: 0 }}
    />
  );
}
