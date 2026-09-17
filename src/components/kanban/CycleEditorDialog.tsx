import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useT, type TranslationKey } from "@/i18n";
import { usePulseStore } from "@/stores/pulseStore";
import {
  cyclesOf, statusMetaOf, STATUS_COLORS, DONE_STATUS_ID,
  STATUS_QUALIFICATIONS, qualificationOf,
} from "@/domain/constants";
import { cycleDeletionBlockers } from "@/domain/cycleDeletion";
import type { Cycle, StatusDef, StatusQualification } from "@/types";

/**
 * The Beat's workflows (Cycles-Spec CY8).
 *
 * One level up from `StatusEditorDialog`, and deliberately the same shape: a
 * list you add to, rename and reorder, with `Done` reserved and immovable
 * (CY5/CY6). What is new is that there are several lists, one is the default
 * (CY4), and deleting one can be refused (CY17).
 *
 * Nothing is written until Save. `cyclesOf` computes a Beat's single implicit
 * cycle (CY11), so opening this dialog on a Beat that has never had cycles
 * shows it exactly as it renders today — and closing without saving still
 * writes nothing.
 */
export function CycleEditorDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const pulse = usePulseStore((s) => s.pulse);
  const features = usePulseStore((s) => s.features);
  const epics = usePulseStore((s) => s.epics);
  const setCycles = usePulseStore((s) => s.setCycles);

  const initial = useMemo(() => cyclesOf(pulse), [pulse]);
  const [list, setList] = useState<Cycle[]>(() => initial.map((c) => ({ ...c, statuses: c.statuses.map((s) => ({ ...s })) })));
  const [defaultId, setDefaultId] = useState(pulse?.defaultCycleId ?? initial[0]?.id ?? "");
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const patch = (id: string, fn: (c: Cycle) => Cycle) =>
    setList((l) => l.map((c) => (c.id === id ? fn(c) : c)));

  const addCycle = () => {
    const id = `cy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // Every cycle ends in Done, so a new one starts with it already there —
    // there is no state in which a cycle lacks its terminal stage (CY6).
    const fresh: Cycle = {
      id,
      name: t("cycle.newName"),
      statuses: [
        { id: `st-${Date.now()}`, label: t("cycle.stageName"), color: STATUS_COLORS[0], qualifies: "planned" },
        { id: DONE_STATUS_ID, label: "Done", color: "#12A594" },
      ],
    };
    setList((l) => [...l, fresh]);
    setOpenId(id);
  };

  const addStage = (cycleId: string) =>
    patch(cycleId, (c) => {
      const stage: StatusDef = {
        id: `st-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        label: "",
        color: STATUS_COLORS[c.statuses.length % STATUS_COLORS.length],
        qualifies: "ongoing",
      };
      // Inserted before Done, never after — the terminal stage is always last.
      const before = c.statuses.filter((s) => s.id !== DONE_STATUS_ID);
      const done = c.statuses.find((s) => s.id === DONE_STATUS_ID)!;
      return { ...c, statuses: [...before, stage, done] };
    });

  const save = async () => {
    setBusy(true);
    // Drop unnamed stages, the same tidy-up the status editor does on save, and
    // guarantee Done is last in every cycle whatever the editing left behind.
    const cleaned = list.map((c) => {
      const kept = c.statuses.filter((s) => s.label.trim() || s.id === DONE_STATUS_ID);
      const done = kept.find((s) => s.id === DONE_STATUS_ID) ?? { id: DONE_STATUS_ID, label: "Done", color: "#12A594" };
      return { ...c, statuses: [...kept.filter((s) => s.id !== DONE_STATUS_ID), done] };
    });
    await setCycles(cleaned, cleaned.some((c) => c.id === defaultId) ? defaultId : cleaned[0].id);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6" onClick={onClose}>
      <div role="dialog" aria-label={t("cycle.title")}
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl bg-yasdu-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-base font-semibold text-yasdu-fg">{t("cycle.title")}</h2>
        <p className="mt-1 text-xs" style={{ color: "#64748B" }}>{t("cycle.intro")}</p>

        <div className="mt-4 flex flex-col gap-2">
          {list.map((c) => (
            <CycleRow
              key={c.id}
              cycle={c}
              open={openId === c.id}
              isDefault={defaultId === c.id}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onMakeDefault={() => setDefaultId(c.id)}
              onRename={(name) => patch(c.id, (x) => ({ ...x, name }))}
              onStage={(sid, next) => patch(c.id, (x) => ({ ...x, statuses: x.statuses.map((s) => (s.id === sid ? { ...s, ...next } : s)) }))}
              onRemoveStage={(sid) => patch(c.id, (x) => ({ ...x, statuses: x.statuses.filter((s) => s.id !== sid) }))}
              onAddStage={() => addStage(c.id)}
              onDelete={() => setList((l) => l.filter((x) => x.id !== c.id))}
              blockers={cycleDeletionBlockers(c.id, features, epics, defaultId)}
              t={t}
            />
          ))}
        </div>

        <button onClick={addCycle}
          className="hoverable no-press mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
          style={{ borderColor: "#E2DFD9", color: "#334155" }}>
          <Icon name="add" size={14} /> {t("cycle.add")}
        </button>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="hoverable no-press rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: "#F1F5F9", color: "#475569" }}>{t("common.cancel")}</button>
          <button onClick={() => void save()} disabled={busy || list.length === 0}
            className="hoverable no-press rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "#EE7240", color: "#0A1428" }}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CycleRow({
  cycle, open, isDefault, onToggle, onMakeDefault, onRename, onStage, onRemoveStage, onAddStage, onDelete, blockers, t,
}: {
  cycle: Cycle; open: boolean; isDefault: boolean;
  onToggle: () => void; onMakeDefault: () => void; onRename: (n: string) => void;
  onStage: (id: string, next: Partial<StatusDef>) => void;
  onRemoveStage: (id: string) => void; onAddStage: () => void; onDelete: () => void;
  blockers: ReturnType<typeof cycleDeletionBlockers>;
  t: (k: TranslationKey, p?: Record<string, string | number>) => string;
}) {
  const stages = cycle.statuses.filter((s) => s.id !== DONE_STATUS_ID);
  return (
    <div className="rounded-xl border" style={{ borderColor: open ? "#EE7240" : "#E2DFD9", background: open ? "#FFF7F1" : "#FFFFFF" }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="no-press" aria-label={cycle.name}>
          <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={16} style={{ color: "#64748B" }} />
        </button>
        <input value={cycle.name} onChange={(e) => onRename(e.target.value)}
          className="min-w-0 flex-1 rounded px-1 py-0.5 text-sm font-semibold"
          style={{ color: "#1F2330", background: "transparent", border: "1px solid transparent", outline: "none" }} />
        <span className="mono text-[10px]" style={{ color: "#94A3B8" }}>{stages.length + 1}</span>
        {isDefault ? (
          <span className="mono rounded px-1.5 py-0.5 text-[9px] uppercase" style={{ background: "#F7E8DA", color: "#D85A28" }}>{t("cycle.default")}</span>
        ) : (
          <button onClick={onMakeDefault} className="hoverable no-press rounded px-1.5 py-0.5 text-[10px]"
            style={{ border: "1px solid #E2DFD9", color: "#64748B" }}>{t("cycle.makeDefault")}</button>
        )}
      </div>

      {open && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "#F1F5F9" }}>
          <div className="mono text-[10px] uppercase" style={{ color: "#94A3B8" }}>{t("cycle.stages")}</div>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {stages.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span style={{ width: 9, height: 9, borderRadius: 5, background: statusMetaOf(s.id, cycle.statuses).border, flexShrink: 0 }} />
                <input value={s.label} placeholder={t("cycle.stageName")} onChange={(e) => onStage(s.id, { label: e.target.value })}
                  className="min-w-0 flex-1 rounded border px-1.5 py-1 text-xs"
                  style={{ borderColor: "#E2DFD9", background: "#FFFFFF", outline: "none" }} />
                {/* CY16: what this stage counts as when something summarises
                    across cycles. Asked here because position cannot infer
                    "stalled" and a report should not have to guess. */}
                <select value={qualificationOf(s.id, cycle.statuses)} title={t("cycle.qualifiesHint")}
                  onChange={(e) => onStage(s.id, { qualifies: e.target.value as StatusQualification })}
                  className="rounded border px-1 py-1 text-[11px]"
                  style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#475569" }}>
                  {STATUS_QUALIFICATIONS.map((q) => (
                    <option key={q.id} value={q.id}>{t(`cycle.q.${q.id}` as TranslationKey)}</option>
                  ))}
                </select>
                <button onClick={() => onRemoveStage(s.id)} className="no-press" aria-label={t("common.remove")}>
                  <Icon name="close" size={13} style={{ color: "#94A3B8" }} />
                </button>
              </div>
            ))}
            {/* Done is shown but not editable — it is the one stage every cycle
                shares, and the lock, finishedAt and every completion count hang
                off it (CY5). */}
            <div className="flex items-center gap-2 opacity-60">
              <span style={{ width: 9, height: 9, borderRadius: 5, background: "#12A594", flexShrink: 0 }} />
              <span className="flex-1 text-xs" style={{ color: "#475569" }}>Done</span>
              <span className="mono text-[9px] uppercase" style={{ color: "#94A3B8" }}>{t("kanban.doneLocked")}</span>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button onClick={onAddStage} className="hoverable no-press rounded border px-2 py-1 text-[11px] font-semibold"
              style={{ borderColor: "#E2DFD9", color: "#334155" }}>
              <Icon name="add" size={12} /> {t("cycle.addStage")}
            </button>
            <div className="flex-1" />
            <DeleteControl blockers={blockers} onDelete={onDelete} t={t} />
          </div>
          {stages.length === 0 && (
            <p className="mt-2 text-[11px]" style={{ color: "#8C2F22" }}>{t("cycle.minStages")}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Delete, or the reason it is refused (CY17).
 *
 * The three blocker kinds are listed separately because they need different
 * actions — and done tasks cannot be reassigned at all (CY2b), so telling
 * someone to move them would send them at a control that will refuse.
 */
function DeleteControl({
  blockers, onDelete, t,
}: {
  blockers: ReturnType<typeof cycleDeletionBlockers>;
  onDelete: () => void;
  t: (k: TranslationKey, p?: Record<string, string | number>) => string;
}) {
  if (blockers.deletable) {
    return (
      <button onClick={onDelete} className="hoverable no-press rounded border px-2 py-1 text-[11px] font-semibold"
        style={{ borderColor: "#F3C7C1", color: "#8C2F22" }}>
        <Icon name="delete_forever" size={12} /> {t("cycle.delete")}
      </button>
    );
  }
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: "#F3C7C1", background: "#FDECEA", maxWidth: 420 }}>
      <div className="text-[11px] font-semibold" style={{ color: "#8C2F22" }}>{t("cycle.inUseTitle")}</div>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {blockers.isBeatDefault && <li className="text-[11px]" style={{ color: "#8C2F22" }}>{t("cycle.inUseDefault")}</li>}
        {blockers.reassignable.length > 0 && (
          <li className="text-[11px]" style={{ color: "#8C2F22" }}>{t("cycle.inUseTasks", { n: blockers.reassignable.length })}</li>
        )}
        {blockers.doneTasks.length > 0 && (
          <li className="text-[11px]" style={{ color: "#8C2F22" }}>{t("cycle.inUseDone", { n: blockers.doneTasks.length })}</li>
        )}
        {blockers.epics.length > 0 && (
          <li className="text-[11px]" style={{ color: "#8C2F22" }}>{t("cycle.inUseEpics", { n: blockers.epics.length })}</li>
        )}
      </ul>
    </div>
  );
}
