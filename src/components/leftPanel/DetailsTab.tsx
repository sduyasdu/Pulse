import { useState } from "react";
import type { Feature, Resource, Subtask } from "@/types";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { confirmAt } from "@/stores/confirmStore";
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
import { RichTextEditor } from "@/components/shared/RichTextEditor";
import { useDebouncedText } from "@/hooks/useDebouncedText";

interface DetailsTabProps {
  feature: Feature;
  canEdit: boolean;
  onClose: () => void;
  onDuplicate: () => void;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function DetailsTab({ feature, canEdit: canEditProp, onClose, onDuplicate }: DetailsTabProps) {
  // A "done" task is locked: every content field is read-only. Only the status
  // (so it can be reopened) and the duplicate/delete actions stay on the real
  // permission. Reusing the name `canEdit` means all field bindings below pick
  // up the lock automatically.
  const locked = feature.status === "done";
  const canEdit = canEditProp && !locked;
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

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Changing a subtask's status also maintains its finished date: stamp today
  // when it first becomes done, clear it when reopened. (Manual edits to the
  // date field go straight through patchSubtask and aren't touched here.)
  const setSubtaskStatus = (c: Subtask, status: Subtask["status"]) => {
    const patch: Partial<Subtask> = { status };
    const wasDone = c.status === "done";
    const nowDone = status === "done";
    if (nowDone && !wasDone) patch.finishedAt = todayISO();
    else if (!nowDone && wasDone) patch.finishedAt = null;
    void patchSubtask(feature.id, c.id, patch);
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold mono" style={{ color: "#64748B" }}>TASK DETAILS</span>
        {canEditProp && (
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
              onClick={async (e) => {
                if (await confirmAt(e, { message: `Delete "${feature.title || "this task"}"?`, detail: "You can undo this (⌘Z).", confirmLabel: "Delete" })) {
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

      {locked && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "#E6F7F4", border: "1px solid #A7E3D8", color: "#0F6B5C" }}>
          <span style={{ fontSize: 13 }}>🔒</span>
          <span>Done — locked. Change its status below to edit this task.</span>
        </div>
      )}

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
            const respId = c.resources?.[0] ?? null;
            const resp = respId ? resources.find((x) => x.id === respId) ?? null : null;
            return (
              <div key={c.id} className="rounded" style={{ border: "1px solid #E2DFD9" }}>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button onClick={() => setExpandedSubs((s) => ({ ...s, [c.id]: !s[c.id] }))} title={open ? "Collapse" : "Expand"} className="flex items-center justify-center" style={{ flexShrink: 0, width: 22 }}>
                    <span style={{ fontSize: 22, lineHeight: 1, color: "#475569" }}>{open ? "▾" : "▸"}</span>
                  </button>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={c.status === "done"}
                    onChange={(e) => setSubtaskStatus(c, e.target.checked ? "done" : "planned")}
                    title={c.status === "done" ? "Mark not done" : "Mark done"}
                    style={{ flexShrink: 0, accentColor: "#12A594", cursor: canEdit ? "pointer" : "default" }}
                  />
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: cm.border, flexShrink: 0 }} />
                  <SubtaskTitleInput title={c.title} disabled={!canEdit} done={c.status === "done"} onCommit={(v) => void patchSubtask(feature.id, c.id, { title: v })} />
                  {resp && <span className="mono" title={`Responsible: ${resp.name}`} style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: colorForName(resp.id), width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{resp.initials}</span>}
                  {canEdit && (
                    <button onClick={async (e) => { if (await confirmAt(e, { message: `Delete subtask "${c.title}"?` })) void removeSubtask(feature.id, c.id); }} title="Delete subtask">
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
                        onChange={(e) => setSubtaskStatus(c, e.target.value as Subtask["status"])}
                        className="mono text-xs border rounded px-1 py-0.5 flex-1"
                        style={{ borderColor: "#E2DFD9" }}
                      >
                        {Object.entries(STATUS_META).map(([k, m]) => (
                          <option key={k} value={k}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="mono" style={{ fontSize: 9, color: "#64748B", flexShrink: 0 }}>finished:</span>
                      <input
                        type="date"
                        disabled={!canEdit}
                        value={c.finishedAt || ""}
                        onChange={(e) => void patchSubtask(feature.id, c.id, { finishedAt: e.target.value || null })}
                        title="Set automatically when marked done — editable"
                        className="mono text-xs border rounded px-1 py-0.5"
                        style={{ borderColor: "#E2DFD9", color: "#334155" }}
                      />
                      {c.finishedAt && canEdit && (
                        <button onClick={() => void patchSubtask(feature.id, c.id, { finishedAt: null })} title="Clear finished date">
                          <span style={{ fontSize: 11, color: "#94A3B8" }}>✕</span>
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>responsible:</span>
                      <div className="mt-1">
                        <ResponsibleSelect
                          resources={resources}
                          value={respId}
                          disabled={!canEdit}
                          onChange={(id) => void patchSubtask(feature.id, c.id, { resources: id ? [id] : [] })}
                        />
                      </div>
                    </div>
                    <div className="mt-1.5">
                      <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>notes:</span>
                      <RichTextEditor value={c.notes || ""} disabled={!canEdit} placeholder="Add notes…" minHeight={44} onChange={(v) => void patchSubtask(feature.id, c.id, { notes: v })} />
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
          disabled={!canEditProp}
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

      <div>
        <div className="mono mb-1" style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>Notes</div>
        <RichTextEditor value={feature.notes || ""} disabled={!canEdit} placeholder="Add notes about this task…" minHeight={72} onChange={(v) => void patchFeature(feature.id, { notes: v })} />
      </div>

      <Attachments
        canEdit={canEdit}
        items={feature.attachments}
        onAdd={(t, u) => void addAttachment(feature.id, t, u)}
        onDelete={(aid) => void removeAttachment(feature.id, aid)}
      />

    </div>
  );
}

function SubtaskTitleInput({ title, disabled, done, onCommit }: { title: string; disabled: boolean; done?: boolean; onCommit: (v: string) => void }) {
  const [local, onChange] = useDebouncedText(title, onCommit);
  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs font-medium flex-1 bg-transparent"
      style={{ border: "none", outline: "none", color: done ? "#94A3B8" : "#334155", textDecoration: done ? "line-through" : "none", minWidth: 0 }}
    />
  );
}

function ResponsibleSelect({ resources, value, disabled, onChange }: { resources: Resource[]; value: string | null; disabled: boolean; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = resources.find((r) => r.id === value) ?? null;
  const query = q.trim().toLowerCase();
  const filtered = resources.filter((r) => !query || r.name.toLowerCase().includes(query) || (r.type || "").toLowerCase().includes(query));
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  const badge = (r: Resource, size: number) => (
    <span className="mono" style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: colorForName(r.id), width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.initials}</span>
  );
  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 flex-1 border rounded px-2 py-1"
          style={{ borderColor: "#E2DFD9", background: disabled ? "#F8FAFC" : "#FFFFFF", minWidth: 0 }}
        >
          {current ? (
            <>
              {badge(current, 16)}
              <span className="text-xs truncate" style={{ color: "#334155" }}>{current.name}</span>
            </>
          ) : (
            <span className="text-xs" style={{ color: "#94A3B8" }}>Set responsible…</span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 9, color: "#94A3B8" }}>{open ? "▲" : "▼"}</span>
        </button>
        {current && !disabled && (
          <button onClick={() => pick(null)} title="Remove responsible" className="flex-shrink-0 rounded" style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "#FDEBEC" }}>
            <span style={{ fontSize: 11, color: "#9F1D23" }}>✕</span>
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="mt-1 rounded border" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="text-xs w-full px-2 py-1 border-b"
            style={{ borderColor: "#F1F5F9", outline: "none" }}
          />
          <div style={{ maxHeight: 150, overflowY: "auto" }}>
            <button onClick={() => pick(null)} className="flex items-center gap-1.5 w-full px-2 py-1 text-left">
              <span className="text-xs" style={{ color: "#94A3B8" }}>— None —</span>
            </button>
            {filtered.map((r) => (
              <button key={r.id} onClick={() => pick(r.id)} className="flex items-center gap-1.5 w-full px-2 py-1 text-left" style={{ background: r.id === value ? "#FFF7F1" : undefined }}>
                {badge(r, 16)}
                <span className="text-xs truncate" style={{ color: "#334155" }}>{r.name}</span>
                {r.type && <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#94A3B8" }}>{r.type}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="text-xs px-2 py-1.5" style={{ color: "#94A3B8" }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

