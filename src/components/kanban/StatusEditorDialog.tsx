import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { usePulseStore } from "@/stores/pulseStore";
import { statusesOf, statusMetaOf, STATUS_COLORS, DONE_STATUS_ID } from "@/domain/constants";
import { useT } from "@/i18n";
import type { StatusDef } from "@/types";

/** Per-Pulse status manager: add / rename / recolour / reorder columns. "Done"
 * is reserved — always present, pinned last, never deletable. Any status still
 * used by a task can't be deleted (the user must move those tasks first). */
export function StatusEditorDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const pulse = usePulseStore((s) => s.pulse);
  const features = usePulseStore((s) => s.features);
  const setStatuses = usePulseStore((s) => s.setStatuses);
  const [list, setList] = useState<StatusDef[]>(() => statusesOf(pulse).map((s) => ({ ...s })));
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  // How many tasks/subtasks reference each status id (delete is blocked > 0).
  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of features) {
      m[f.status] = (m[f.status] || 0) + 1;
      for (const c of f.children || []) m[c.status] = (m[c.status] || 0) + 1;
    }
    return m;
  }, [features]);

  const done = list.find((s) => s.id === DONE_STATUS_ID);
  const nonDone = list.filter((s) => s.id !== DONE_STATUS_ID);

  const update = (id: string, patch: Partial<StatusDef>) => setList((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => setList((l) => l.filter((s) => s.id !== id));
  // Live drag reorder within the non-done rows ("done" stays pinned last).
  const reorder = (overId: string) => {
    if (!dragId || dragId === overId || overId === DONE_STATUS_ID) return;
    setList((l) => {
      const nd = l.filter((s) => s.id !== DONE_STATUS_ID);
      const from = nd.findIndex((s) => s.id === dragId);
      const to = nd.findIndex((s) => s.id === overId);
      if (from < 0 || to < 0 || from === to) return l;
      const copy = [...nd];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return done ? [...copy, done] : copy;
    });
  };
  // Touch-friendly reorder (iPad has no HTML5 drag): swap with the neighbour
  // within the non-done rows.
  const move = (id: string, dir: -1 | 1) =>
    setList((l) => {
      const nd = l.filter((s) => s.id !== DONE_STATUS_ID);
      const i = nd.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= nd.length) return l;
      const copy = [...nd];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return done ? [...copy, done] : copy;
    });
  const add = () =>
    setList((l) => {
      const nd = l.filter((s) => s.id !== DONE_STATUS_ID);
      const item: StatusDef = { id: `s_${Math.random().toString(36).slice(2, 9)}`, label: "New status", color: STATUS_COLORS[l.length % STATUS_COLORS.length] };
      return done ? [...nd, item, done] : [...nd, item];
    });

  const save = async () => {
    // Drop blank rows; guarantee Done exists and is terminal.
    const kept = list.filter((s) => s.label.trim() || s.id === DONE_STATUS_ID);
    const d = kept.find((s) => s.id === DONE_STATUS_ID) ?? { id: DONE_STATUS_ID, label: "Done", color: "#12A594" };
    const out = [...kept.filter((s) => s.id !== DONE_STATUS_ID), d];
    setSaving(true);
    await setStatuses(out);
    onClose();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 300, background: "rgba(15,23,42,0.4)" }} onClick={onClose}>
      <div className="rounded-xl" style={{ width: 480, maxWidth: "92vw", maxHeight: "85vh", overflow: "auto", background: "#FFFFFF", padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{t("status.edit")}</span>
          <button onClick={onClose} className="no-press" style={{ color: "#94A3B8", fontSize: 18, lineHeight: 1 }} aria-label={t("common.close")}><Icon name="close" size={18} /></button>
        </div>
        <p className="mono mb-3" style={{ fontSize: 10, color: "#94A3B8" }}>{t("status.hint")}</p>

        <div className="flex flex-col gap-2">
          {nonDone.map((s, i) => (
            <Row
              key={s.id}
              s={s}
              usage={usage[s.id] || 0}
              dragging={dragId === s.id}
              canMoveUp={i > 0}
              canMoveDown={i < nonDone.length - 1}
              onMoveUp={() => move(s.id, -1)}
              onMoveDown={() => move(s.id, 1)}
              onUpdate={update}
              onRemove={remove}
              onDragStart={() => setDragId(s.id)}
              onDragOver={(e) => { e.preventDefault(); reorder(s.id); }}
              onDragEnd={() => setDragId(null)}
            />
          ))}
          {done && <Row s={done} usage={usage[done.id] || 0} reserved onUpdate={update} onRemove={remove} onDragStart={() => {}} onDragOver={(e) => e.preventDefault()} onDragEnd={() => {}} />}
        </div>

        <button onClick={add} className="mono text-xs mt-3" style={{ color: "#0F766E" }}>{t("status.addStatus")}</button>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded" style={{ color: "#64748B" }}>{t("common.cancel")}</button>
          <button onClick={() => void save()} disabled={saving} className="text-xs px-3 py-1.5 rounded font-semibold" style={{ background: "#D85A28", color: "#FFFFFF", opacity: saving ? 0.6 : 1 }}>{t("common.save")}</button>
        </div>
      </div>
    </div>
  );
}

function Row({
  s,
  usage,
  reserved,
  dragging,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  s: StatusDef;
  usage: number;
  reserved?: boolean;
  dragging?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onUpdate: (id: string, patch: Partial<StatusDef>) => void;
  onRemove: (id: string) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const t = useT();
  const meta = statusMetaOf(s.id, [s]);
  const canDelete = !reserved && usage === 0;
  return (
    <div
      onDragOver={onDragOver}
      className="flex items-center gap-2 rounded px-2 py-1.5"
      style={{ border: "1px solid #E2DFD9", background: meta.bg, opacity: dragging ? 0.4 : 1 }}
    >
      <span
        draggable={!reserved}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="flex-shrink-0"
        title={reserved ? "" : t("status.dragReorder")}
        style={{ color: reserved ? "#CBD5E1" : "#94A3B8", fontSize: 13, lineHeight: 1, cursor: reserved ? "default" : "grab" }}
      >
        <Icon name="drag_indicator" size={16} />
      </span>
      {/* Up/down buttons — reorder without dragging (works on iPad/touch). */}
      {!reserved && (
        <div className="flex flex-col flex-shrink-0" style={{ lineHeight: 0 }}>
          <button onClick={onMoveUp} disabled={!canMoveUp} className="no-press" title={t("status.moveUp")} aria-label={t("status.moveUp")} style={{ color: canMoveUp ? "#64748B" : "#D8DCE3", display: "flex", cursor: canMoveUp ? "pointer" : "default" }}>
            <Icon name="keyboard_arrow_up" size={16} />
          </button>
          <button onClick={onMoveDown} disabled={!canMoveDown} className="no-press" title={t("status.moveDown")} aria-label={t("status.moveDown")} style={{ color: canMoveDown ? "#64748B" : "#D8DCE3", display: "flex", cursor: canMoveDown ? "pointer" : "default" }}>
            <Icon name="keyboard_arrow_down" size={16} />
          </button>
        </div>
      )}
      <input
        value={s.label}
        onChange={(e) => onUpdate(s.id, { label: e.target.value })}
        className="text-sm bg-transparent flex-1"
        style={{ border: "none", outline: "none", color: "#1F2330", fontWeight: 600, minWidth: 0 }}
      />
      <div className="flex items-center gap-1 flex-shrink-0">
        {STATUS_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onUpdate(s.id, { color: c })}
            title={c}
            className="no-press"
            style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: s.color === c ? "2px solid #1F2330" : "1px solid rgba(15,23,42,0.15)" }}
          />
        ))}
      </div>
      {reserved ? (
        <span className="mono flex-shrink-0" style={{ fontSize: 8, color: "#94A3B8", textTransform: "uppercase", width: 54, textAlign: "right" }}>{t("status.reserved")}</span>
      ) : (
        <button
          onClick={() => canDelete && onRemove(s.id)}
          disabled={!canDelete}
          title={usage > 0 ? t("status.inUse", { n: usage }) : t("status.deleteStatus")}
          className="no-press flex-shrink-0"
          style={{ color: canDelete ? "#DC2626" : "#CBD5E1", fontSize: 13, width: 54, textAlign: "right", cursor: canDelete ? "pointer" : "not-allowed" }}
        >
          {usage > 0 ? <span className="mono" style={{ fontSize: 9 }}>{t("status.inUseShort", { n: usage })}</span> : <Icon name="delete" size={13} />}
        </button>
      )}
    </div>
  );
}
