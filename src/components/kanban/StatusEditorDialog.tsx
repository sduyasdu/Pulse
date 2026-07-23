import { useMemo, useState } from "react";
import { usePulseStore } from "@/stores/pulseStore";
import { statusesOf, statusMetaOf, STATUS_COLORS, DONE_STATUS_ID } from "@/domain/constants";
import type { StatusDef } from "@/types";

/** Per-Pulse status manager: add / rename / recolour / reorder columns. "Done"
 * is reserved — always present, pinned last, never deletable. Any status still
 * used by a task can't be deleted (the user must move those tasks first). */
export function StatusEditorDialog({ onClose }: { onClose: () => void }) {
  const pulse = usePulseStore((s) => s.pulse);
  const features = usePulseStore((s) => s.features);
  const setStatuses = usePulseStore((s) => s.setStatuses);
  const [list, setList] = useState<StatusDef[]>(() => statusesOf(pulse).map((s) => ({ ...s })));
  const [saving, setSaving] = useState(false);

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
  const move = (id: string, dir: -1 | 1) =>
    setList((l) => {
      const nd = l.filter((s) => s.id !== DONE_STATUS_ID);
      const i = nd.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= nd.length) return l;
      [nd[i], nd[j]] = [nd[j], nd[i]];
      return done ? [...nd, done] : nd;
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
          <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>Edit statuses</span>
          <button onClick={onClose} className="no-press" style={{ color: "#94A3B8", fontSize: 18, lineHeight: 1 }} aria-label="Close">✕</button>
        </div>
        <p className="mono mb-3" style={{ fontSize: 10, color: "#94A3B8" }}>Columns on the board, left to right. “Done” is reserved and always last.</p>

        <div className="flex flex-col gap-2">
          {nonDone.map((s, i) => (
            <Row key={s.id} s={s} usage={usage[s.id] || 0} first={i === 0} last={i === nonDone.length - 1} onUpdate={update} onMove={move} onRemove={remove} />
          ))}
          {done && <Row s={done} usage={usage[done.id] || 0} reserved onUpdate={update} onMove={move} onRemove={remove} />}
        </div>

        <button onClick={add} className="mono text-xs mt-3" style={{ color: "#0F766E" }}>+ add status</button>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded" style={{ color: "#64748B" }}>Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="text-xs px-3 py-1.5 rounded font-semibold" style={{ background: "#D85A28", color: "#FFFFFF", opacity: saving ? 0.6 : 1 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Row({
  s,
  usage,
  first,
  last,
  reserved,
  onUpdate,
  onMove,
  onRemove,
}: {
  s: StatusDef;
  usage: number;
  first?: boolean;
  last?: boolean;
  reserved?: boolean;
  onUpdate: (id: string, patch: Partial<StatusDef>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  const meta = statusMetaOf(s.id, [s]);
  const canDelete = !reserved && usage === 0;
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5" style={{ border: "1px solid #E2DFD9", background: meta.bg }}>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => onMove(s.id, -1)} disabled={reserved || first} className="no-press" style={{ color: "#94A3B8", fontSize: 11, opacity: reserved || first ? 0.3 : 1 }} title="Move left">▲</button>
        <button onClick={() => onMove(s.id, 1)} disabled={reserved || last} className="no-press" style={{ color: "#94A3B8", fontSize: 11, opacity: reserved || last ? 0.3 : 1 }} title="Move right">▼</button>
      </div>
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
        <span className="mono flex-shrink-0" style={{ fontSize: 8, color: "#94A3B8", textTransform: "uppercase", width: 54, textAlign: "right" }}>reserved</span>
      ) : (
        <button
          onClick={() => canDelete && onRemove(s.id)}
          disabled={!canDelete}
          title={usage > 0 ? `In use by ${usage} — move those tasks first` : "Delete status"}
          className="no-press flex-shrink-0"
          style={{ color: canDelete ? "#DC2626" : "#CBD5E1", fontSize: 13, width: 54, textAlign: "right", cursor: canDelete ? "pointer" : "not-allowed" }}
        >
          {usage > 0 ? <span className="mono" style={{ fontSize: 9 }}>in use {usage}</span> : "🗑"}
        </button>
      )}
    </div>
  );
}
