import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import type { Feature, Resource, StatusDef, Subtask } from "@/types";
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
import { dayIndexFromDateInputValue, fmtDate, toDateInputValue, todayIndex } from "@/domain/dateUtils";
import { LABEL_COLORS, colorForName, statusesOf, statusMetaOf } from "@/domain/constants";
import { Attachments } from "@/components/shared/Attachments";
import { RichTextEditor } from "@/components/shared/RichTextEditor";
import { Comments } from "@/components/comments/Comments";
import { FeatureActivity } from "./FeatureActivity";
import { FeatureCosts } from "./FeatureCosts";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { useT } from "@/i18n";

interface DetailsTabProps {
  feature: Feature;
  canEdit: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  /** Desktop hosts comments in their own right-panel tab, so hide the inline
   * thread there; mobile keeps it inline (no tabs). */
  hideComments?: boolean;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Baseline-plan state colours, shared by the header icon and the SCHEDULE &
 * EFFORT control so "set" reads identically in both. Orange-on-ink is the
 * toolbar's active-button palette (`Toolbar.tsx` — `#EE7240` / `#0A1428`);
 * `#0A1428` rather than white because small text on this orange needs the
 * contrast. Grey matches the neighbouring duplicate button. */
const PLAN_ON = { background: "#EE7240", color: "#0A1428" } as const;
const PLAN_OFF = { background: "#F1F5F9", color: "#64748B" } as const;

export function DetailsTab({ feature, canEdit: canEditProp, onClose, onDuplicate, hideComments }: DetailsTabProps) {
  // A "done" task is locked: every content field is read-only. Only the status
  // (so it can be reopened) and the duplicate/delete actions stay on the real
  // permission. Reusing the name `canEdit` means all field bindings below pick
  // up the lock automatically.
  const t = useT();
  const locked = feature.status === "done";
  const canEdit = canEditProp && !locked;
  const epics = usePulseStore((s) => s.epics);
  const resources = usePulseStore((s) => s.resources);
  const pulse = usePulseStore((s) => s.pulse);
  const statuses = statusesOf(pulse);
  const patchFeature = usePulseStore((s) => s.patchFeature);
  const setFeatureStatus = usePulseStore((s) => s.setFeatureStatus);
  const moveFeatureToEpic = usePulseStore((s) => s.moveFeatureToEpic);
  const removeFeature = usePulseStore((s) => s.removeFeature);
  const setAlloc = usePulseStore((s) => s.setAlloc);
  const assignResource = usePulseStore((s) => s.assignResource);
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

  // Baseline plan. Both controls (the header icon and the one in SCHEDULE &
  // EFFORT) drive this same toggle: setting freezes today's dates, and clicking
  // again *clears* them. Before this there was no unset — the button only ever
  // re-froze the baseline to the current dates, so the only way to remove one
  // was the small × in the PLAN (frozen) block, which isn't visible until a plan
  // exists.
  const planSet = feature.plannedX != null;
  const togglePlan = () =>
    void patchFeature(
      feature.id,
      planSet ? { plannedX: null, plannedDuration: null } : { plannedX: feature.x, plannedDuration: feature.duration },
    );
  const planTitle = planSet ? t("details.unsetPlanTitle") : t("details.setPlanTitle");

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
      {/* Header + title stay pinned to the top of the scrolling panel: the form
       * is long enough that you lose track of which task you are editing. The
       * negative margins let the opaque background cover the container's p-4,
       * so content scrolls under it rather than beside it. */}
      <div
        className="sticky flex flex-col gap-2"
        style={{ top: 0, zIndex: 30, background: "#FFFFFF", margin: "-16px -16px 0", padding: "16px 16px 8px", borderBottom: "1px solid #F1F5F9" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold mono" style={{ color: "#64748B" }}>{t("details.taskDetails")}</span>
          {canEditProp && (
            <div className="flex items-center gap-1.5">
              {/* Gated on canEdit, not canEditProp: freezing a baseline is a
                  content edit, so a done/locked task shouldn't offer it — same
                  rule the SCHEDULE & EFFORT control follows. */}
              {canEdit && (
                <button
                  title={planTitle}
                  aria-label={planTitle}
                  aria-pressed={planSet}
                  onClick={togglePlan}
                  className="rounded"
                  style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", ...(planSet ? PLAN_ON : PLAN_OFF) }}
                >
                  <Icon name="keep" size={13} />
                </button>
              )}
              <button
                title={t("details.duplicateTask")}
                onClick={onDuplicate}
                className="rounded"
                style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "#F1F5F9" }}
              >
                <Icon name="content_copy" size={13} style={{ color: "#64748B" }} />
              </button>
              <button
                title={t("details.deleteTask")}
                onClick={async (e) => {
                  if (await confirmAt(e, { message: t("details.deleteTaskMsg", { title: feature.title || t("details.thisTask") }), detail: t("details.deleteTaskDetail"), confirmLabel: t("common.delete") })) {
                    void removeFeature(feature.id);
                    onClose();
                  }
                }}
                className="rounded"
                style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "#FDEBEC" }}
              >
                <Icon name="delete" size={13} style={{ color: "#9F1D23" }} />
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
      </div>

      {locked && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "#E6F7F4", border: "1px solid #A7E3D8", color: "#0F6B5C" }}>
          <Icon name="lock" size={14} />
          <span>{t("details.doneLocked")}</span>
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <span className="mono text-xs" style={{ color: "#64748B" }}>{t("details.epic")}</span>
          <select
            value={feature.epicId || ""}
            disabled={!canEdit}
            onChange={(e) => void moveFeatureToEpic(feature.id, e.target.value || null)}
            className="mt-1 w-full text-sm border rounded px-2 py-1.5"
            style={{ borderColor: "#E2DFD9" }}
          >
            <option value="">{t("common.none")}</option>
            {epics.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <span className="mono text-xs" style={{ color: "#64748B" }}>{t("details.teamLeader")}</span>
          <select
            value={feature.lead || ""}
            disabled={!canEdit}
            onChange={(e) => void patchFeature(feature.id, { lead: e.target.value || null })}
            className="mt-1 w-full text-sm border rounded px-2 py-1.5"
            style={{ borderColor: feature.lead ? "#F5A524" : "#E2DFD9" }}
          >
            <option value="">{t("common.none")}</option>
            {(feature.resources || []).map((r) => (
              <option key={r} value={r}>★ {resources.find((x) => x.id === r)?.name || r}</option>
            ))}
          </select>
          {(feature.resources || []).length === 0 && <div className="mono text-xs mt-1" style={{ color: "#78859A" }}>{t("details.assignFirst")}</div>}
        </div>
      </div>

      <div>
        <span className="mono text-xs" style={{ color: "#64748B" }}>{t("details.status")}</span>
        <div className="mt-1">
          <StatusSelect
            statuses={statuses}
            value={feature.status}
            disabled={!canEditProp}
            onChange={(id) => void setFeatureStatus(feature.id, id as Feature["status"])}
          />
        </div>
        {(feature.status === "done" || feature.finishedAt) && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="mono" style={{ fontSize: 10, color: "#64748B" }}>{t("details.finished")}</span>
            <input
              type="date"
              disabled={!canEditProp}
              value={feature.finishedAt || ""}
              onChange={(e) => void patchFeature(feature.id, { finishedAt: e.target.value || null })}
              title="Actual completion date (set automatically when marked done, editable)"
              className="text-sm border rounded px-1.5 py-1"
              style={{ borderColor: "#E2DFD9", color: "#334155" }}
            />
            {feature.finishedAt && canEditProp && (
              <button onClick={() => void patchFeature(feature.id, { finishedAt: null })} title="Clear finished date">
                <Icon name="close" size={12} style={{ color: "#94A3B8" }} />
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <span className="mono text-xs" style={{ color: "#64748B" }}>
          {t("details.subtasks")} {(feature.children || []).length > 0 && `(${feature.children!.length})`}
        </span>
        <div className="flex flex-col gap-1.5 mt-2">
          {(feature.children || []).length === 0 && <span className="mono text-xs" style={{ color: "#78859A" }}>{t("details.noSubtasks")}</span>}
          {(feature.children || []).map((c) => {
            const cm = statusMetaOf(c.status, statuses);
            const open = !!expandedSubs[c.id];
            const respId = c.resources?.[0] ?? null;
            const resp = respId ? resources.find((x) => x.id === respId) ?? null : null;
            return (
              <div key={c.id} className="rounded" style={{ border: "1px solid #E2DFD9" }}>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button onClick={() => setExpandedSubs((s) => ({ ...s, [c.id]: !s[c.id] }))} title={open ? t("details.collapse") : t("details.expand")} className="flex items-center justify-center" style={{ flexShrink: 0, width: 22 }}>
                    <Icon name={open ? "keyboard_arrow_down" : "chevron_right"} size={22} style={{ color: "#475569" }} />
                  </button>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={c.status === "done"}
                    onChange={(e) => setSubtaskStatus(c, e.target.checked ? "done" : "planned")}
                    title={c.status === "done" ? t("details.markNotDone") : t("details.markDone")}
                    style={{ flexShrink: 0, accentColor: "#12A594", cursor: canEdit ? "pointer" : "default" }}
                  />
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: cm.border, flexShrink: 0 }} />
                  <SubtaskTitleInput title={c.title} disabled={!canEdit} done={c.status === "done"} onCommit={(v) => void patchSubtask(feature.id, c.id, { title: v })} />
                  {resp && <ResourceBadge resourceId={resp.id} size={16} title={t("details.responsibleName", { name: resp.name })} />}
                  {canEdit && (
                    <button onClick={async (e) => { if (await confirmAt(e, { message: t("details.deleteSubtaskMsg", { title: c.title }) })) void removeSubtask(feature.id, c.id); }} title={t("details.deleteSubtask")}>
                      <Icon name="close" size={13} style={{ color: "#64748B" }} />
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
                        {statuses.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <SubtaskDates subtask={c} disabled={!canEdit} onPatch={(p) => void patchSubtask(feature.id, c.id, p)} />
                    <div className="mt-1.5">
                      <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("details.responsible")}</span>
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
                      <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{t("details.notesLower")}</span>
                      <RichTextEditor value={c.notes || ""} disabled={!canEdit} placeholder={t("details.addNotesShort")} minHeight={44} onChange={(v) => void patchSubtask(feature.id, c.id, { notes: v })} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button onClick={() => void addSubtask(feature.id)} className="mono text-xs flex items-center justify-center gap-1 w-full mt-2 py-1.5 rounded" style={{ background: "#F7E8DA", color: "#D85A28", border: "1px dashed #F0A875" }}>
            {t("details.addSubtask")}
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="mono text-xs" style={{ color: "#64748B" }}>{t("details.resourcesTime")}</span>
          <span className="mono text-xs" style={{ color: "#64748B", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="star" size={11} /> {t("details.teamLeaderLegend")}</span>
        </div>
        <div className="flex flex-col gap-2 mt-2">
          {(feature.resources || []).length === 0 && <span className="text-xs" style={{ color: "#9F1D23" }}>{t("details.noneAssigned")}</span>}
          {(feature.resources || []).map((r) => {
            const pctVal = feature.alloc?.[r] ?? 100;
            const isLead = feature.lead === r;
            return (
              <div key={r} className="rounded px-2 py-2" style={{ border: isLead ? "1px solid #F5A524" : "1px solid #E2DFD9", background: isLead ? "#FFFBEB" : "#fff" }}>
                <div className="flex items-center gap-2">
                  <button disabled={!canEdit} title={isLead ? "Team leader — click to unset" : "Make team leader"} onClick={() => void patchFeature(feature.id, { lead: isLead ? null : r })} style={{ fontSize: 13, lineHeight: 1, color: isLead ? "#F5A524" : "#CBD5E1", flexShrink: 0 }}><Icon name="star" size={14} /></button>
                  <ResourceBadge resourceId={r} size={18} ring={isLead ? "#F5A524" : undefined} />
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
                    <button
                      onClick={() => void unassignResource(feature.id, r)}
                      title={t("details.unassign")}
                      className="flex items-center justify-center rounded"
                      style={{ width: 24, height: 24, flexShrink: 0, background: "#FDEBEC" }}
                    >
                      <Icon name="close" size={13} style={{ color: "#9F1D23" }} />
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
          {canEdit && (
            <AssignResourcePicker
              resources={resources}
              assignedIds={feature.resources || []}
              onAssign={(id) => void assignResource(feature.id, id)}
            />
          )}
        </div>
      </div>

      <div className="rounded px-3 py-2.5" style={{ border: "1px solid #E2DFD9" }}>
        <div className="flex items-center justify-between">
          <span className="mono text-xs" style={{ color: "#64748B" }}>SCHEDULE &amp; EFFORT</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 mono text-xs cursor-pointer" style={{ color: feature.useWeekends ? "#D85A28" : "#94A3B8" }} title="Count weekends as working days (urgent)">
              <input type="checkbox" disabled={!canEdit} checked={!!feature.useWeekends} onChange={(e) => void patchFeature(feature.id, { useWeekends: e.target.checked })} /> weekends
            </label>
            {canEdit ? (
              <button
                onClick={togglePlan}
                title={planTitle}
                aria-pressed={planSet}
                className="mono text-xs px-2 py-0.5 rounded"
                style={planSet ? PLAN_ON : PLAN_OFF}
              >
                <Icon name="keep" size={13} /> {planSet ? t("details.planSet") : t("details.setPlan")}
              </button>
            ) : (
              planSet && (
                <span className="mono text-xs px-2 py-0.5 rounded" title={t("details.planSetTitle")} style={PLAN_ON}><Icon name="keep" size={12} /> {t("details.planSet")}</span>
              )
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
                    <Icon name="refresh" size={12} style={{ color: "#D85A28" }} />
                  </button>
                ) : (
                  <button title="Fix this value" onClick={() => void patchFeature(feature.id, { estEffort: graph_ })}>
                    <Icon name="lock" size={11} style={{ color: "#94A3B8" }} />
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
                  <Icon name="close" size={12} style={{ color: "#94A3B8" }} />
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
        <span className="mono text-xs" style={{ color: "#64748B" }}>{t("details.labelColor")} <span style={{ opacity: 0.7 }}>{t("details.groupRelated")}</span></span>
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
                {!lc.color && <Icon name="block" size={12} style={{ color: "#64748B" }} />}
                {lc.color && active && <Icon name="check" size={13} style={{ color: "#fff" }} />}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: "#334155" }}>
        <input type="checkbox" disabled={!canEdit} checked={!!feature.ai} onChange={(e) => void patchFeature(feature.id, { ai: e.target.checked })} /> {t("details.aiEstimate")} <Icon name="bolt" size={14} style={{ color: "#8B5CF6" }} />
      </label>

      <div>
        <div className="mono mb-1" style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("details.notes")}</div>
        <RichTextEditor value={feature.notes || ""} disabled={!canEdit} placeholder={t("details.notesPlaceholder")} minHeight={72} onChange={(v) => void patchFeature(feature.id, { notes: v })} />
      </div>

      <FeatureCosts featureId={feature.id} canEdit={canEdit} />

      <Attachments
        canEdit={canEdit}
        items={feature.attachments}
        onAdd={(t, u) => void addAttachment(feature.id, t, u)}
        onDelete={(aid) => void removeAttachment(feature.id, aid)}
      />

      {!hideComments && pulse && <Comments pulseId={pulse.id} targetId={feature.id} />}

      <FeatureActivity featureId={feature.id} />

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

/** One labelled metric under a subtask date — same shape as the SCHEDULE &
 * EFFORT tiles, one notch smaller for the nested subtask panel. */
function DateStat({ label, value, color }: { label: string; value: string; color?: string }) {
  const empty = value === "—";
  return (
    <div className="rounded px-1.5 py-1" style={{ background: "#F8FAFC", minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 8, color: "#64748B", letterSpacing: "0.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div className="mono" style={{ fontSize: 11, fontWeight: 600, color: empty ? "#B4BECC" : (color ?? "#1F2330") }}>{value}</div>
    </div>
  );
}

/** A subtask's three dates: created (stamped once by addSubtask, read-only),
 * planned and finished (both editable). Each editable date carries two
 * labelled fields: how long it is from creation, and how it stands against the
 * plan. Anything that can't be computed — no creation date on subtasks that
 * predate the field, no plan, not finished yet — reads "—" rather than
 * disappearing, so the row of fields stays put as the dates get filled in. */
function SubtaskDates({ subtask, disabled, onPatch }: { subtask: Subtask; disabled: boolean; onPatch: (patch: Partial<Subtask>) => void }) {
  const t = useT();
  const created = subtask.createdAt ?? null;
  const planned = subtask.plannedAt ?? null;
  const finished = subtask.finishedAt ?? null;
  const span = (from: string, to: string) => dayIndexFromDateInputValue(to) - dayIndexFromDateInputValue(from);
  const days = (n: number) => t("details.nDays", { n });

  // Against today only while the subtask is still open — once it is finished
  // the honest comparison is finished-vs-planned, which is the pair of fields
  // under the finished date.
  const live = planned && !finished ? dayIndexFromDateInputValue(planned) - todayIndex() : null;
  const slip = planned && finished ? span(planned, finished) : null;

  const label = (s: string) => (
    <span className="mono" style={{ fontSize: 9, color: "#64748B", flexShrink: 0, width: 48, whiteSpace: "nowrap" }}>{s}</span>
  );
  const clear = (title: string, patch: Partial<Subtask>) =>
    !disabled && (
      <button onClick={() => onPatch(patch)} title={title}>
        <Icon name="close" size={12} style={{ color: "#94A3B8" }} />
      </button>
    );
  const dateInput = (value: string | null, onSet: (v: string | null) => void, title: string) => (
    <input
      type="date"
      disabled={disabled}
      value={value || ""}
      onChange={(e) => onSet(e.target.value || null)}
      title={title}
      className="mono text-xs border rounded px-1 py-0.5"
      style={{ borderColor: "#E2DFD9", color: "#334155" }}
    />
  );

  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      <div className="flex items-center gap-1.5">
        {label(t("details.created"))}
        <span className="mono" style={{ fontSize: 11, color: created ? "#334155" : "#B4BECC" }} title={t("details.createdTitle")}>
          {created ? fmtDate(dayIndexFromDateInputValue(created)) : "—"}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {label(t("details.planned"))}
        {dateInput(planned, (v) => onPatch({ plannedAt: v }), t("details.plannedTitle"))}
        {planned && clear(t("details.clearPlanned"), { plannedAt: null })}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <DateStat label={t("details.plannedElapsed")} value={created && planned ? days(span(created, planned)) : "—"} />
        <DateStat
          label={t("details.delayPending")}
          value={live == null ? "—" : live < 0 ? t("details.nDelay", { n: -live }) : live > 0 ? t("details.nPending", { n: live }) : t("details.dueToday")}
          color={live == null ? undefined : live < 0 ? "#9F1D23" : live > 0 ? "#0F6B5C" : "#92400E"}
        />
      </div>

      <div className="flex items-center gap-1.5">
        {label(t("details.finished"))}
        {dateInput(finished, (v) => onPatch({ finishedAt: v }), t("details.finishedTitle"))}
        {finished && clear(t("details.clearFinished"), { finishedAt: null })}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <DateStat label={t("details.finalElapsed")} value={created && finished ? days(span(created, finished)) : "—"} />
        <DateStat
          label={t("details.finalDelayPending")}
          value={slip == null ? "—" : slip > 0 ? t("details.nDelay", { n: slip }) : slip < 0 ? t("details.nEarly", { n: -slip }) : t("details.onPlan")}
          color={slip == null ? undefined : slip > 0 ? "#9F1D23" : "#0F6B5C"}
        />
      </div>
    </div>
  );
}

/** Status picker in the panel's standard dropdown shape (button + panel, same
 * as ResponsibleSelect) instead of a native <select>: a native option list
 * can't carry the status colour, and the colour is how the board is read. */
function StatusSelect({
  statuses,
  value,
  disabled,
  onChange,
}: {
  statuses: StatusDef[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = statusMetaOf(value, statuses);
  const dot = (color: string) => <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />;
  return (
    <div className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-sm border rounded px-2 py-1.5"
        style={{ borderColor: "#E2DFD9", background: disabled ? "#F8FAFC" : "#FFFFFF", minWidth: 0 }}
      >
        {dot(current.border)}
        <span className="truncate" style={{ color: "#334155" }}>{current.label}</span>
        <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={15} style={{ marginLeft: "auto", color: "#94A3B8" }} />
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            className="absolute rounded border"
            style={{ top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}
          >
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {statuses.map((s) => {
                const m = statusMetaOf(s.id, statuses);
                return (
                  <button
                    key={s.id}
                    onClick={() => { onChange(s.id); setOpen(false); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-left"
                    style={{ background: s.id === value ? "#FFF7F1" : undefined }}
                  >
                    {dot(m.border)}
                    <span className="text-sm truncate" style={{ color: "#334155" }}>{m.label}</span>
                    {s.id === value && <Icon name="check" size={14} style={{ marginLeft: "auto", color: "#EE7240" }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ResponsibleSelect({ resources, value, disabled, onChange }: { resources: Resource[]; value: string | null; disabled: boolean; onChange: (id: string | null) => void }) {
  const t = useT();
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
  const badge = (r: Resource, size: number) => <ResourceBadge resourceId={r.id} size={size} />;
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
            <span className="text-xs" style={{ color: "#94A3B8" }}>{t("details.setResponsible")}</span>
          )}
          <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={13} style={{ marginLeft: "auto", color: "#94A3B8" }} />
        </button>
        {current && !disabled && (
          <button onClick={() => pick(null)} title={t("details.removeResponsible")} className="flex-shrink-0 rounded" style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "#FDEBEC" }}>
            <Icon name="close" size={12} style={{ color: "#9F1D23" }} />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="mt-1 rounded border" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("filter.search")}
            className="text-xs w-full px-2 py-1 border-b"
            style={{ borderColor: "#F1F5F9", outline: "none" }}
          />
          <div style={{ maxHeight: 150, overflowY: "auto" }}>
            <button onClick={() => pick(null)} className="flex items-center gap-1.5 w-full px-2 py-1 text-left">
              <span className="text-xs" style={{ color: "#94A3B8" }}>{t("common.none")}</span>
            </button>
            {filtered.map((r) => (
              <button key={r.id} onClick={() => pick(r.id)} className="flex items-center gap-1.5 w-full px-2 py-1 text-left" style={{ background: r.id === value ? "#FFF7F1" : undefined }}>
                {badge(r, 16)}
                <span className="text-xs truncate" style={{ color: "#334155" }}>{r.name}</span>
                {r.type && <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#94A3B8" }}>{r.type}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="text-xs px-2 py-1.5" style={{ color: "#94A3B8" }}>{t("filter.noMatches")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Adds resources to a task straight from the form — the keyboard/tap
 * alternative to dragging someone from the Team tab onto the box. Lists only
 * the not-yet-assigned resources and stays open after a pick so several can be
 * added in a row. */
function AssignResourcePicker({ resources, assignedIds, onAssign }: { resources: Resource[]; assignedIds: string[]; onAssign: (id: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const available = resources.filter((r) => !assignedIds.includes(r.id));
  const filtered = available.filter((r) => !query || r.name.toLowerCase().includes(query) || (r.type || "").toLowerCase().includes(query));
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-sm"
        style={{ background: "#FFF1E9", color: "#C2410C", border: "1px solid #FBD3BE" }}
      >
        <Icon name="person_add" size={17} />
        <span className="font-semibold">{t("details.assignResource")}</span>
        <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={15} style={{ marginLeft: "auto" }} />
      </button>
      {open && (
        <div className="mt-1 rounded border" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
          {available.length > 3 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("filter.search")}
              className="text-xs w-full px-2 py-1.5 border-b"
              style={{ borderColor: "#F1F5F9", outline: "none" }}
            />
          )}
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => { onAssign(r.id); setQ(""); }}
                className="flex items-center gap-2 w-full px-2.5 py-2.5 text-left"
                style={{ borderBottom: "1px solid #F5F3EF" }}
              >
                <ResourceBadge resourceId={r.id} size={18} />
                <span className="text-xs truncate" style={{ color: "#334155" }}>{r.name}</span>
                <Icon name="add" size={14} style={{ marginLeft: "auto", color: "#12A594" }} />
                {r.type && <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{r.type}</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-xs px-2 py-1.5" style={{ color: "#94A3B8" }}>
                {available.length === 0 ? t("details.allAssigned") : t("filter.noMatches")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

