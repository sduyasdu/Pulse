import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Feature, FeatureStatus, StatusDef } from "@/types";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { buildCycleBoard, canDropInSection, placeColumns } from "@/domain/cycleBoard";
import type { StatusColumn } from "@/domain/kanban";
import { hexA, statusesOf, statusMetaOf, cyclesOf } from "@/domain/constants";
import { fmtDate, todayIndex, taskActiveInPeriod, type DatePeriod } from "@/domain/dateUtils";
import { DatePeriodFilter } from "@/components/shared/DatePeriodFilter";
import { assignedEffort, estimateEffort, staffingColor } from "@/domain/graphEffort";
import { confirmAt } from "@/stores/confirmStore";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import { useT } from "@/i18n";

interface KanbanViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canEdit: boolean;
  /** Per-feature edit gate (Task Lead edits only tasks they lead). */
  canEditFeature: (f: Feature) => boolean;
  featureQuery: string;
  featureStatusFilter: Set<string>;
  epicFilter: Set<string>;
  /** CY13. Owned by PulsePage and shared with the canvas — the chips below are
   * one of its two controls, not a board-local filter. */
  cycleFilter: Set<string>;
  setCycleFilter: (v: Set<string>) => void;
  filterResource: string | null;
  /** Exempt from the filters — every task created since the filter last
   * changed (see PulsePage). The board picks up the column's status and epic on
   * create, so those two never hid one; a text query, a resource filter or the
   * date period did. */
  alwaysShowIds?: ReadonlySet<string>;
  /** Told when a card is created here, so the exemption above can be granted
   * for it. Distinct from `onSelect`, which also fires for ordinary clicks. */
  onTaskCreated?: (id: string) => void;
  /** "My Pulse": when set, only tasks involving one of these resource ids (the
   * viewer's linked account) are shown. Null = off. */
  myResourceIds: string[] | null;
}

export function KanbanView({ selectedId, onSelect, canEdit, canEditFeature, featureQuery, featureStatusFilter, epicFilter, cycleFilter, setCycleFilter, filterResource, myResourceIds, alwaysShowIds, onTaskCreated }: KanbanViewProps) {
  const t = useT();
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
  const pulse = usePulseStore((s) => s.pulse);
  const setFeatureStatus = usePulseStore((s) => s.setFeatureStatus);
  const moveFeatureToEpic = usePulseStore((s) => s.moveFeatureToEpic);
  const addFeature = usePulseStore((s) => s.addFeature);
  const addEpic = usePulseStore((s) => s.addEpic);
  const patchEpic = usePulseStore((s) => s.patchEpic);
  const duplicateFeature = usePulseStore((s) => s.duplicateFeature);
  const removeFeature = usePulseStore((s) => s.removeFeature);
  const setStatuses = usePulseStore((s) => s.setStatuses);
  const graph = graphConfigOf(pulse);
  const statuses = statusesOf(pulse);

  const renameStatus = (id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    void setStatuses(statuses.map((s) => (s.id === id ? { ...s, label: trimmed } : s)));
  };

  const renameEpic = (id: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) void patchEpic(id, { name: trimmed });
  };

  const resById = useMemo(() => Object.fromEntries(resources.map((r) => [r.id, r])), [resources]);
  const [dragOverCol, setDragOverCol] = useState<FeatureStatus | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<FeatureStatus | null>(null);
  const [datePeriod, setDatePeriod] = useState<DatePeriod>("all");

  // Query / epic / resource narrow the cards shown; status filter hides whole
  // columns (D7). The matching PREDICATE mirrors the canvas; the treatment does
  // not, and did not for a long time — the canvas dims a non-match while this
  // removes it. They now agree for the resource filter (the canvas returns null
  // for a non-match); query/status/epic still dim there.
  const q = featureQuery.trim().toLowerCase();
  const visibleFeatures = useMemo(
    () =>
      features.filter((f) => {
        if (alwaysShowIds?.has(f.id)) return true;
        const matchesQuery = !q || (f.title || "").toLowerCase().includes(q) || (f.children || []).some((c) => (c.title || "").toLowerCase().includes(q));
        const matchesEpic = epicFilter.size === 0 || (f.epicId != null && epicFilter.has(f.epicId));
        const matchesRes = !filterResource || (f.resources || []).includes(filterResource) || (f.children || []).some((c) => (c.resources || []).includes(filterResource));
        const matchesMine = !myResourceIds || (f.resources || []).some((r) => myResourceIds.includes(r)) || (f.children || []).some((c) => (c.resources || []).some((r) => myResourceIds.includes(r)));
        const matchesDate = taskActiveInPeriod(f, datePeriod);
        return matchesQuery && matchesEpic && matchesRes && matchesMine && matchesDate;
      }),
    [features, q, epicFilter, filterResource, myResourceIds, datePeriod, alwaysShowIds],
  );

  // When a filter narrows the tasks, don't resurrect the hidden epics as empty
  // bands — only show the epics that actually have matching tasks.
  const filtered = !!q || epicFilter.size > 0 || !!filterResource || !!myResourceIds || datePeriod !== "all";
  const cycles = useMemo(() => cyclesOf(pulse), [pulse]);
  const board = useMemo(
    () => buildCycleBoard(visibleFeatures, epics, cycles, !filtered, pulse?.defaultCycleId),
    [visibleFeatures, epics, cycles, filtered, pulse?.defaultCycleId],
  );
  // Chips list only the cycles the board is showing (CY15) — a chip for a cycle
  // with nothing in it filters to an empty board.
  const sections = cycleFilter.size === 0 ? board.sections : board.sections.filter((x) => cycleFilter.has(x.cycleId));

  const addTask = async (status: FeatureStatus, epicId: string | null = null, cycleId?: string) => {
    // The column's own cycle, not the epic's. Creating a task in the Review
    // section's "In review" column with the Beat's default cycle would orphan
    // its status the moment it existed.
    const id = await addFeature({ x: todayIndex(), y: 20, status, epicId, ...(cycleId ? { cycleId } : {}) });
    if (!id) return;
    onTaskCreated?.(id);
    onSelect(id);
  };

  const duplicate = async (id: string) => {
    const nid = await duplicateFeature(id);
    if (nid) onSelect(nid);
  };

  const del = async (f: Feature, pt: { clientX: number; clientY: number }) => {
    if (await confirmAt(pt, { message: t("details.deleteTaskMsg", { title: f.title || t("common.untitledTask") }), confirmLabel: t("common.delete") })) void removeFeature(f.id);
  };

  // Drop rules:
  //  - across columns (status differs) → change status, KEEP the epic (the card
  //    is accommodated under its own epic band in the new column);
  //  - within the same column, onto another epic band → change the epic, keep
  //    the status.
  const handleDrop = (status: FeatureStatus, epicId: string | null | undefined, e: React.DragEvent, cycleId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCol(null);
    setDragOverGroup(null);
    setDraggingStatus(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const f = features.find((x) => x.id === id);
    if (!f || !canEditFeature(f)) return;
    // Refused rather than handled: dropping a card into another cycle's section
    // would change its workflow, and a drag is not how a cycle changes (CY2a).
    // Changing it is a deliberate act on the task itself (CY2b).
    if (cycleId && !canDropInSection(board, id, cycleId)) return;
    if (f.status !== status) {
      void setFeatureStatus(id, status);
    } else if (epicId !== undefined && (f.epicId ?? null) !== epicId) {
      void moveFeatureToEpic(id, epicId);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "#FDFCF8" }}>
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #E2DFD9" }}>
        <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{t("kanban.board")}</span>
        <span className="mono text-xs" style={{ color: "#94A3B8" }}>{t(visibleFeatures.length === 1 ? "card.taskOne" : "card.taskOther", { n: visibleFeatures.length })}</span>
        <DatePeriodFilter value={datePeriod} onChange={setDatePeriod} />
        <div className="flex-1" />
        {canEdit && (
          <button onClick={() => void addEpic(20)} className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: "#F4F2EC", color: "#334155", border: "1px solid #E2DFD9" }}>
            <Icon name="view_agenda" size={13} /> {t("toolbar.addEpic")}
          </button>
        )}
      </div>

      {/* The cycle filter sits above the board and outside the scrolling
          region (CY15), so it stays visible while what it filters moves. */}
      {board.grouped && (
        <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #F1F5F9" }}>
          <span className="mono text-[10px] uppercase" style={{ color: "#94A3B8" }}>{t("cycle.title")}</span>
          {board.sections.map((sec) => {
            const on = cycleFilter.has(sec.cycleId);
            return (
              <button key={sec.cycleId} onClick={() => {
                const next = new Set(cycleFilter);
                if (next.has(sec.cycleId)) next.delete(sec.cycleId); else next.add(sec.cycleId);
                setCycleFilter(next);
              }}
                className="hoverable no-press rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap"
                style={{ border: "1px solid " + (on ? "#EE7240" : "#E2DFD9"), background: on ? "#FFF7F1" : "#FFFFFF",
                  color: on ? "#D85A28" : "#64748B", fontWeight: on ? 600 : 400 }}>
                {sec.name} <span className="mono text-[9px]" style={{ opacity: 0.7 }}>{sec.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Sections run below and the region scrolls (CY15). The board is not
          shrunk to fit them: a section is legible at one size. */}
      <div className="flex-1 overflow-auto">
        <div className="p-3" style={{ minWidth: "min-content" }}>
          {sections.map((section) => {
            const secStatuses = cycles.find((c) => c.id === section.cycleId)?.statuses ?? statuses;
            const cols = featureStatusFilter.size === 0
              ? section.columns
              : section.columns.filter((c) => featureStatusFilter.has(c.status));
            return (
              <div key={section.cycleId} style={{ marginBottom: 18 }}>
                {board.grouped && (
                  <div className="flex items-center gap-2 pb-1.5" style={{ paddingTop: 2 }}>
                    <span className="font-display text-[13px] font-bold" style={{ color: "#1F2330" }}>{section.name}</span>
                    <span className="mono text-[10px]" style={{ color: "#94A3B8" }}>
                      {t(section.count === 1 ? "card.taskOne" : "card.taskOther", { n: section.count })}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "#E2DFD9" }} />
                  </div>
                )}
                {/* CY14: uniform columns packed left, the terminal column in the
                    widest cycle's last slot — so Done lines up across sections
                    and a shorter cycle shows the gap it has. */}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${board.slots}, 260px)`, gap: 12, alignItems: "start" }}>
                  {placeColumns(cols, board.slots).map(({ col, slot }) => (
                    <div key={col.status} style={{ gridColumn: slot }}>
                      <Column
                        col={col}
                        canEdit={canEdit}
                        canEditFeature={canEditFeature}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        graph={graph}
                        statuses={secStatuses}
                        resById={resById}
                        onRenameStatus={renameStatus}
                        onRenameEpic={renameEpic}
                        dragOver={dragOverCol === section.cycleId + col.status}
                        dragOverGroup={dragOverGroup}
                        setDragOverGroup={setDragOverGroup}
                        sameColumnDrag={draggingStatus === col.status}
                        onDuplicate={duplicate}
                        onDelete={del}
                        onDragStartTask={setDraggingStatus}
                        onDragEndTask={() => { setDraggingStatus(null); setDragOverCol(null); setDragOverGroup(null); }}
                        onDragEnterCol={() => setDragOverCol(section.cycleId + col.status)}
                        onDragLeaveCol={() => { setDragOverCol((x) => (x === section.cycleId + col.status ? null : x)); setDragOverGroup(null); }}
                        onDrop={(epicId, e) => handleDrop(col.status, epicId, e, section.cycleId)}
                        onAddTask={(epicId) => void addTask(col.status, epicId, section.cycleId)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Column({
  col,
  canEdit,
  canEditFeature,
  selectedId,
  onSelect,
  graph,
  statuses,
  resById,
  onRenameStatus,
  onRenameEpic,
  dragOver,
  dragOverGroup,
  setDragOverGroup,
  sameColumnDrag,
  onDuplicate,
  onDelete,
  onDragStartTask,
  onDragEndTask,
  onDragEnterCol,
  onDragLeaveCol,
  onDrop,
  onAddTask,
}: {
  col: StatusColumn;
  canEdit: boolean;
  canEditFeature: (f: Feature) => boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  graph: ReturnType<typeof graphConfigOf>;
  statuses: StatusDef[];
  resById: Record<string, { initials: string; name: string }>;
  onRenameStatus: (id: string, label: string) => void;
  onRenameEpic: (id: string, name: string) => void;
  dragOver: boolean;
  dragOverGroup: string | null;
  setDragOverGroup: (k: string | null) => void;
  sameColumnDrag: boolean;
  onDuplicate: (id: string) => void;
  onDelete: (f: Feature, pt: { clientX: number; clientY: number }) => void;
  onDragStartTask: (status: FeatureStatus) => void;
  onDragEndTask: () => void;
  onDragEnterCol: () => void;
  onDragLeaveCol: () => void;
  onDrop: (epicId: string | null | undefined, e: React.DragEvent) => void;
  onAddTask: (epicId: string | null) => void;
}) {
  const t = useT();
  const meta = statusMetaOf(col.status, statuses);
  const [labelDraft, onLabelChange] = useDebouncedText(meta.label, (v) => onRenameStatus(col.status, v));
  return (
    <div
      className="flex flex-col rounded-xl"
      style={{ width: 280, flexShrink: 0, background: dragOver ? "#FFF4EC" : "#F4F2EC", border: `1px solid ${dragOver ? "#EE7240" : "#E2DFD9"}` }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnterCol}
      onDragLeave={onDragLeaveCol}
      onDrop={(e) => onDrop(undefined, e)}
    >
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: meta.border, flexShrink: 0 }} />
        {canEdit ? (
          <input
            value={labelDraft}
            onChange={(e) => onLabelChange(e.target.value)}
            title={t("kanban.renameStatus")}
            className="text-xs font-semibold bg-transparent flex-1"
            style={{ border: "none", outline: "none", color: "#1F2330", minWidth: 0 }}
          />
        ) : (
          <span className="text-xs font-semibold flex-1 truncate" style={{ color: "#1F2330" }}>{meta.label}</span>
        )}
        <span className="mono text-xs flex-shrink-0" style={{ color: "#94A3B8" }}>{col.count}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ minHeight: 40 }}>
        {col.groups.length === 0 && <div className="mono text-xs text-center py-4" style={{ color: "#B4BECC" }}>—</div>}
        {col.groups.map((g) => {
          const key = `${col.status}::${g.epicId ?? "none"}`;
          // Only a same-column drag can reassign the epic, so only then does the
          // band read as a drop target.
          const over = sameColumnDrag && dragOverGroup === key;
          return (
            <div
              key={g.epicId ?? "none"}
              className="mb-2 rounded"
              style={{ outline: over ? "2px dashed #EE7240" : "none", outlineOffset: 1 }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragOverGroup !== key) setDragOverGroup(key); }}
              onDrop={(e) => onDrop(g.epicId, e)}
            >
              {/* Full-width epic band: the epic's colour spans the whole column so
                  the groups read as clearly separated sections. */}
              <div
                className="flex items-center gap-1.5 mb-1.5 rounded"
                style={{ background: hexA(g.color || "#94A3B8", 0.16), borderLeft: `3px solid ${g.color || "#94A3B8"}`, padding: "3px 8px" }}
              >
                <EpicBandName epicId={g.epicId} name={g.name} canEdit={canEdit} onRename={onRenameEpic} />
                <span className="mono text-xs flex-shrink-0" style={{ color: "#64748B", marginLeft: "auto" }}>{g.tasks.length}</span>
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); onAddTask(g.epicId); }} title={t("kanban.addTaskToEpic")} className="no-press" style={{ color: "#475569", fontSize: 14, lineHeight: 1, flexShrink: 0 }}><Icon name="add" size={16} /></button>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {g.tasks.map((f) => (
                  <Card key={f.id} f={f} canEdit={canEditFeature(f)} selected={selectedId === f.id} onSelect={onSelect} graph={graph} statuses={statuses} resById={resById} onDuplicate={onDuplicate} onDelete={onDelete} onDragStartTask={onDragStartTask} onDragEndTask={onDragEndTask} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <button onClick={() => onAddTask(null)} className="mono text-xs px-3 py-2 text-left flex-shrink-0" style={{ color: "#78859A", borderTop: "1px solid #E2DFD9" }}>
          {t("kanban.addTask")}
        </button>
      )}
    </div>
  );
}

function EpicBandName({ epicId, name, canEdit, onRename }: { epicId: string | null; name: string; canEdit: boolean; onRename: (id: string, name: string) => void }) {
  const t = useT();
  const [draft, onChange] = useDebouncedText(name, (v) => { if (epicId != null) onRename(epicId, v); });
  // The "No epic" band and viewers aren't editable.
  if (!canEdit || epicId == null) {
    return <span className="mono text-xs uppercase tracking-wide truncate" style={{ color: "#334155", fontWeight: 600 }}>{name}</span>;
  }
  return (
    <input
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      title={t("kanban.renameEpic")}
      className="mono text-xs uppercase tracking-wide bg-transparent flex-1"
      style={{ border: "none", outline: "none", color: "#334155", fontWeight: 600, letterSpacing: "0.05em", minWidth: 0 }}
    />
  );
}

function Card({
  f,
  canEdit,
  selected,
  onSelect,
  graph,
  statuses,
  resById,
  onDuplicate,
  onDelete,
  onDragStartTask,
  onDragEndTask,
}: {
  f: Feature;
  canEdit: boolean;
  selected: boolean;
  onSelect: (id: string | null) => void;
  graph: ReturnType<typeof graphConfigOf>;
  statuses: StatusDef[];
  resById: Record<string, { initials: string; name: string }>;
  onDuplicate: (id: string) => void;
  onDelete: (f: Feature, pt: { clientX: number; clientY: number }) => void;
  onDragStartTask: (status: FeatureStatus) => void;
  onDragEndTask: () => void;
}) {
  const t = useT();
  const done = f.status === "done";
  const est = estimateEffort(f, graph);
  const coverage = Math.round((assignedEffort(f) / Math.max(0.1, est)) * 100);
  const subs = f.children || [];
  const subDone = subs.filter((c) => c.status === "done").length;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", f.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStartTask(f.status);
      }}
      onDragEnd={onDragEndTask}
      onClick={() => onSelect(selected ? null : f.id)}
      className="group relative rounded-lg overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: `1px solid ${selected ? "#EE7240" : "#E7E3DC"}`,
        boxShadow: selected ? "0 0 0 1px #EE7240" : "0 1px 2px rgba(15,23,42,0.05)",
        cursor: canEdit ? "grab" : "pointer",
        padding: "7px 9px 7px 11px",
      }}
    >
      {f.labelColor && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: f.labelColor }} />}
      {canEdit && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom }); }}
          className="absolute opacity-0 group-hover:opacity-100 flex items-center justify-center rounded"
          style={{ top: 2, right: 2, width: 20, height: 18, background: "#F1EFE8", color: "#64748B", fontSize: 15, lineHeight: 1, zIndex: 3 }}
          title={t("card.moreActions")}
          aria-label={t("card.moreActions")}
        >
          <Icon name="more_horiz" size={16} />
        </button>
      )}
      {menu && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={(e) => { e.stopPropagation(); setMenu(null); }} />
          <div className="fixed rounded-lg border py-1" style={{ left: menu.x - 150, top: menu.y + 2, zIndex: 61, minWidth: 150, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}>
            <button onClick={(e) => { e.stopPropagation(); setMenu(null); onDuplicate(f.id); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary" style={{ color: "#334155" }}>{t("dialog.duplicate")}</button>
            <button onClick={(e) => { e.stopPropagation(); const pt = { clientX: menu.x, clientY: menu.y }; setMenu(null); onDelete(f, pt); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary" style={{ color: "#DC2626" }}>{t("card.delete")}</button>
          </div>
        </>
      )}
      <div className="flex items-center gap-1.5">
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: staffingColor(f, graph), flexShrink: 0, border: "1px solid rgba(255,255,255,0.7)", boxShadow: "0 0 0 1px rgba(15,23,42,0.1)" }} />
        <span className="text-xs font-semibold flex-1 truncate" title={f.title} style={{ color: "#1F2330", textDecoration: done ? "line-through" : "none" }}>{f.title || t("common.untitledTask")}</span>
        {f.plannedX != null && <Icon name="keep" size={12} title={t("kanban.baselineSet")} />}
        {(f.attachments || []).length > 0 && <span className="mono" style={{ fontSize: 9, color: "#D85A28" }}><Icon name="attach_file" size={11} />{f.attachments!.length}</span>}
        {f.ai && <Icon name="bolt" size={13} style={{ color: "#8B5CF6" }} />}
        {done && <Icon name="lock" size={12} title={t("kanban.doneLocked")} />}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{fmtDate(f.x)} → {fmtDate(f.x + f.duration)}</span>
        {subs.length > 0 && <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}><Icon name="check_box" size={11} style={{ verticalAlign: "-2px" }} /> {subDone}/{subs.length}</span>}
        <div className="flex items-center gap-0.5" style={{ marginLeft: "auto" }}>
          {(f.resources || []).slice(0, 4).map((rid) => {
            const r = resById[rid];
            return r ? (
              <ResourceBadge key={rid} resourceId={rid} size={16} title={r.name} />
            ) : null;
          })}
          {(f.resources || []).length > 4 && <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>+{f.resources!.length - 4}</span>}
          {est > 0 && <span className="mono flex-shrink-0" title={t("kanban.coverage", { assigned: Math.round(assignedEffort(f)), est: Math.round(est) })} style={{ fontSize: 9, fontWeight: 700, color: statusMetaOf(f.status, statuses).text, opacity: 0.85, marginLeft: 2 }}>{coverage}%</span>}
        </div>
      </div>
    </div>
  );
}
