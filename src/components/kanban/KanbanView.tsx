import { useMemo, useState } from "react";
import type { Feature, FeatureStatus } from "@/types";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { buildBoard, type StatusColumn } from "@/domain/kanban";
import { STATUS_META, colorForName, hexA } from "@/domain/constants";
import { fmtDate, todayIndex } from "@/domain/dateUtils";
import { assignedEffort, estimateEffort, staffingColor } from "@/domain/graphEffort";
import { confirmAt } from "@/stores/confirmStore";

interface KanbanViewProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canEdit: boolean;
  featureQuery: string;
  featureStatusFilter: Set<string>;
  epicFilter: Set<string>;
  filterResource: string | null;
}

export function KanbanView({ selectedId, onSelect, canEdit, featureQuery, featureStatusFilter, epicFilter, filterResource }: KanbanViewProps) {
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
  const pulse = usePulseStore((s) => s.pulse);
  const setFeatureStatus = usePulseStore((s) => s.setFeatureStatus);
  const moveFeatureToEpic = usePulseStore((s) => s.moveFeatureToEpic);
  const addFeature = usePulseStore((s) => s.addFeature);
  const addEpic = usePulseStore((s) => s.addEpic);
  const duplicateFeature = usePulseStore((s) => s.duplicateFeature);
  const removeFeature = usePulseStore((s) => s.removeFeature);
  const graph = graphConfigOf(pulse);

  const resById = useMemo(() => Object.fromEntries(resources.map((r) => [r.id, r])), [resources]);
  const [dragOverCol, setDragOverCol] = useState<FeatureStatus | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<FeatureStatus | null>(null);

  // Query / epic / resource narrow the cards shown; status filter hides whole
  // columns (D7). Matching mirrors the canvas so the two views agree.
  const q = featureQuery.trim().toLowerCase();
  const visibleFeatures = useMemo(
    () =>
      features.filter((f) => {
        const matchesQuery = !q || (f.title || "").toLowerCase().includes(q) || (f.children || []).some((c) => (c.title || "").toLowerCase().includes(q));
        const matchesEpic = epicFilter.size === 0 || (f.epicId != null && epicFilter.has(f.epicId));
        const matchesRes = !filterResource || (f.resources || []).includes(filterResource) || (f.children || []).some((c) => (c.resources || []).includes(filterResource));
        return matchesQuery && matchesEpic && matchesRes;
      }),
    [features, q, epicFilter, filterResource],
  );

  const columns = useMemo(() => buildBoard(visibleFeatures, epics), [visibleFeatures, epics]);
  const shownColumns = featureStatusFilter.size === 0 ? columns : columns.filter((c) => featureStatusFilter.has(c.status));

  const addTask = async (status: FeatureStatus) => {
    const id = await addFeature({ x: todayIndex(), y: 20, status });
    if (id) onSelect(id);
  };

  const duplicate = async (id: string) => {
    const nid = await duplicateFeature(id);
    if (nid) onSelect(nid);
  };

  const del = async (f: Feature, pt: { clientX: number; clientY: number }) => {
    if (await confirmAt(pt, { message: `Delete "${f.title || "Untitled task"}"?`, confirmLabel: "Delete" })) void removeFeature(f.id);
  };

  // Drop rules:
  //  - across columns (status differs) → change status, KEEP the epic (the card
  //    is accommodated under its own epic band in the new column);
  //  - within the same column, onto another epic band → change the epic, keep
  //    the status.
  const handleDrop = (status: FeatureStatus, epicId: string | null | undefined, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCol(null);
    setDragOverGroup(null);
    setDraggingStatus(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id || !canEdit) return;
    const f = features.find((x) => x.id === id);
    if (!f) return;
    if (f.status !== status) {
      void setFeatureStatus(id, status);
    } else if (epicId !== undefined && (f.epicId ?? null) !== epicId) {
      void moveFeatureToEpic(id, epicId);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "#FDFCF8" }}>
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #E2DFD9" }}>
        <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>Board</span>
        <span className="mono text-xs" style={{ color: "#94A3B8" }}>{visibleFeatures.length} task{visibleFeatures.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        {canEdit && (
          <button onClick={() => void addEpic(20)} className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: "#F4F2EC", color: "#334155", border: "1px solid #E2DFD9" }}>
            ▤ Add epic
          </button>
        )}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-3 h-full" style={{ minWidth: "min-content" }}>
          {shownColumns.map((col) => (
            <Column
              key={col.status}
              col={col}
              canEdit={canEdit}
              selectedId={selectedId}
              onSelect={onSelect}
              graph={graph}
              resById={resById}
              dragOver={dragOverCol === col.status}
              dragOverGroup={dragOverGroup}
              setDragOverGroup={setDragOverGroup}
              sameColumnDrag={draggingStatus === col.status}
              onDuplicate={duplicate}
              onDelete={del}
              onDragStartTask={setDraggingStatus}
              onDragEndTask={() => { setDraggingStatus(null); setDragOverCol(null); setDragOverGroup(null); }}
              onDragEnterCol={() => setDragOverCol(col.status)}
              onDragLeaveCol={() => { setDragOverCol((s) => (s === col.status ? null : s)); setDragOverGroup(null); }}
              onDrop={(epicId, e) => handleDrop(col.status, epicId, e)}
              onAddTask={() => void addTask(col.status)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Column({
  col,
  canEdit,
  selectedId,
  onSelect,
  graph,
  resById,
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
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  graph: ReturnType<typeof graphConfigOf>;
  resById: Record<string, { initials: string; name: string }>;
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
  onAddTask: () => void;
}) {
  const meta = STATUS_META[col.status];
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
        <span className="text-xs font-semibold" style={{ color: "#1F2330" }}>{meta.label}</span>
        <span className="mono text-xs" style={{ color: "#94A3B8" }}>{col.count}</span>
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
                <span className="mono text-xs uppercase tracking-wide truncate" style={{ color: "#334155", fontWeight: 600 }}>{g.name}</span>
                <span className="mono text-xs" style={{ color: "#64748B", marginLeft: "auto" }}>{g.tasks.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.tasks.map((f) => (
                  <Card key={f.id} f={f} canEdit={canEdit} selected={selectedId === f.id} onSelect={onSelect} graph={graph} resById={resById} onDuplicate={onDuplicate} onDelete={onDelete} onDragStartTask={onDragStartTask} onDragEndTask={onDragEndTask} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <button onClick={onAddTask} className="mono text-xs px-3 py-2 text-left flex-shrink-0" style={{ color: "#78859A", borderTop: "1px solid #E2DFD9" }}>
          + add task
        </button>
      )}
    </div>
  );
}

function Card({
  f,
  canEdit,
  selected,
  onSelect,
  graph,
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
  resById: Record<string, { initials: string; name: string }>;
  onDuplicate: (id: string) => void;
  onDelete: (f: Feature, pt: { clientX: number; clientY: number }) => void;
  onDragStartTask: (status: FeatureStatus) => void;
  onDragEndTask: () => void;
}) {
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
          title="More actions"
          aria-label="More actions"
        >
          ⋯
        </button>
      )}
      {menu && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={(e) => { e.stopPropagation(); setMenu(null); }} />
          <div className="fixed rounded-lg border py-1" style={{ left: menu.x - 150, top: menu.y + 2, zIndex: 61, minWidth: 150, background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.14)" }}>
            <button onClick={(e) => { e.stopPropagation(); setMenu(null); onDuplicate(f.id); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary" style={{ color: "#334155" }}>Duplicate</button>
            <button onClick={(e) => { e.stopPropagation(); const pt = { clientX: menu.x, clientY: menu.y }; setMenu(null); onDelete(f, pt); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-yasdu-secondary" style={{ color: "#DC2626" }}>Delete…</button>
          </div>
        </>
      )}
      <div className="flex items-center gap-1.5">
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: staffingColor(f, graph), flexShrink: 0, border: "1px solid rgba(255,255,255,0.7)", boxShadow: "0 0 0 1px rgba(15,23,42,0.1)" }} />
        <span className="text-xs font-semibold flex-1 truncate" title={f.title} style={{ color: "#1F2330", textDecoration: done ? "line-through" : "none" }}>{f.title || "Untitled task"}</span>
        {f.plannedX != null && <span title="Baseline plan set" style={{ fontSize: 10 }}>📌</span>}
        {(f.attachments || []).length > 0 && <span className="mono" style={{ fontSize: 9, color: "#D85A28" }}>📎{f.attachments!.length}</span>}
        {f.ai && <span style={{ fontSize: 11, color: "#8B5CF6" }}>✨</span>}
        {done && <span title="Done — locked" style={{ fontSize: 10 }}>🔒</span>}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{fmtDate(f.x)} → {fmtDate(f.x + f.duration)}</span>
        {subs.length > 0 && <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>☑ {subDone}/{subs.length}</span>}
        <div className="flex items-center gap-0.5" style={{ marginLeft: "auto" }}>
          {(f.resources || []).slice(0, 4).map((rid) => {
            const r = resById[rid];
            return r ? (
              <span key={rid} className="mono" title={r.name} style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: colorForName(rid), width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.initials}</span>
            ) : null;
          })}
          {(f.resources || []).length > 4 && <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>+{f.resources!.length - 4}</span>}
          {est > 0 && <span className="mono flex-shrink-0" title={`${Math.round(assignedEffort(f))}md assigned of ${Math.round(est)}md`} style={{ fontSize: 9, fontWeight: 700, color: STATUS_META[f.status].text, opacity: 0.85, marginLeft: 2 }}>{coverage}%</span>}
        </div>
      </div>
    </div>
  );
}
