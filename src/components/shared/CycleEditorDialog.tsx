import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useT, type TranslationKey } from "@/i18n";
import { usePulseStore } from "@/stores/pulseStore";
import { getWorkspaceCycles } from "@/services/firestore/workspaces";
import { copyCycleTemplate } from "@/domain/cycleTemplate";
import {
  cyclesOf, statusMetaOf, STATUS_COLORS, DONE_STATUS_ID,
  STATUS_QUALIFICATIONS, qualificationOf,
} from "@/domain/constants";
import { cycleDeletionBlockers, tasksHoldingStage } from "@/domain/cycleDeletion";
import type { Cycle, Epic, Feature, StatusDef, StatusQualification } from "@/types";

/**
 * The Beat's workflows (Cycles-Spec CY8).
 *
 * One level up from the status editor it replaces, and deliberately the same shape: a
 * list you add to, rename and reorder, with `Done` reserved and immovable
 * (CY5/CY6). What is new is that there are several lists, one is the default
 * (CY4), and deleting one can be refused (CY17).
 *
 * Nothing is written until Save. `cyclesOf` computes a Beat's single implicit
 * cycle (CY11), so opening this dialog on a Beat that has never had cycles
 * shows it exactly as it renders today — and closing without saving still
 * writes nothing.
 */
/**
 * The Beat's own cycles, from the toolbar (CY8). Reads the loaded Beat and
 * writes through the store.
 */
export function CycleEditorDialog({ onClose }: { onClose: () => void }) {
  const pulse = usePulseStore((s) => s.pulse);
  const features = usePulseStore((s) => s.features);
  const epics = usePulseStore((s) => s.epics);
  const setCycles = usePulseStore((s) => s.setCycles);
  const setFeatureStatus = usePulseStore((s) => s.setFeatureStatus);
  const initial = useMemo(() => cyclesOf(pulse), [pulse]);

  return (
    <CycleEditor
      onClose={onClose}
      initial={initial}
      initialDefaultId={pulse?.defaultCycleId ?? initial[0]?.id ?? ""}
      features={features}
      epics={epics}
      showDefault
      onSave={setCycles}
      onRemapTask={setFeatureStatus}
      orgWorkspaceId={pulse?.workspaceId ?? null}
    />
  );
}

/**
 * The organisation's cycle templates, from PeoplePage (CY8). Workspace owners
 * only — the rules allow an owner any non-counter field on the workspace doc.
 *
 * The same editor, with `features` and `epics` empty, which is not a shortcut:
 * an org template has no tasks, so no cycle is ever in use (CY17) and no stage
 * deletion can strand anything (CY7). Both guards correctly find nothing rather
 * than being switched off.
 *
 * No default is shown. CY4 takes "the organisation's first cycle", so order is
 * the only thing that matters here, and a default flag that governs nothing is
 * a control that lies.
 */
export function OrgCycleEditorDialog({
  cycles,
  onSave,
  onClose,
}: {
  cycles: Cycle[];
  onSave: (cycles: Cycle[]) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <CycleEditor
      onClose={onClose}
      initial={cycles}
      initialDefaultId={cycles[0]?.id ?? ""}
      features={[]}
      epics={[]}
      showDefault={false}
      onSave={(next) => onSave(next)}
      onRemapTask={async () => {}}
      orgWorkspaceId={null}
    />
  );
}

function CycleEditor({
  onClose,
  initial,
  initialDefaultId,
  features,
  epics,
  showDefault,
  onSave,
  onRemapTask,
  orgWorkspaceId,
}: {
  onClose: () => void;
  initial: Cycle[];
  initialDefaultId: string;
  features: Feature[];
  epics: Epic[];
  showDefault: boolean;
  onSave: (cycles: Cycle[], defaultCycleId: string) => Promise<void>;
  onRemapTask: (featureId: string, status: string) => Promise<void>;
  /** CY1's "Add from organisation". Null at org level — there is nothing above
   * the organisation to copy from. */
  orgWorkspaceId: string | null;
}) {
  const t = useT();
  const [list, setList] = useState<Cycle[]>(() => initial.map((c) => ({ ...c, statuses: c.statuses.map((s) => ({ ...s })) })));
  const [defaultId, setDefaultId] = useState(initialDefaultId);
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  /**
   * CY7: a stage tasks still hold is not removed until the user says where
   * those tasks go. `pendingStage` is the one being asked about; `remaps` are
   * the answers, applied on Save with everything else — nothing here writes
   * before then, and a remap written eagerly would survive a Cancel.
   */
  const [pendingStage, setPendingStage] = useState<{ cycleId: string; statusId: string } | null>(null);
  const [remaps, setRemaps] = useState<{ cycleId: string; from: string; to: string }[]>([]);

  const removeStage = (cycleId: string, statusId: string) => {
    if (tasksHoldingStage(cycleId, statusId, features, defaultId).length > 0) {
      setPendingStage({ cycleId, statusId });
      return;
    }
    patch(cycleId, (x) => ({ ...x, statuses: x.statuses.filter((st) => st.id !== statusId) }));
  };

  const confirmRemoveStage = (cycleId: string, statusId: string, to: string) => {
    setRemaps((r) => [...r, { cycleId, from: statusId, to }]);
    patch(cycleId, (x) => ({ ...x, statuses: x.statuses.filter((st) => st.id !== statusId) }));
    setPendingStage(null);
  };

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
    // Remaps BEFORE the cycle write. The other order leaves every affected task
    // holding a stage that no longer exists for as long as the two writes take,
    // and permanently if the second one fails.
    for (const r of remaps) {
      for (const f of tasksHoldingStage(r.cycleId, r.from, features, defaultId)) {
        await onRemapTask(f.id, r.to);
      }
    }
    await onSave(cleaned, cleaned.some((c) => c.id === defaultId) ? defaultId : cleaned[0].id);
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
              isDefault={showDefault && defaultId === c.id}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onMakeDefault={showDefault ? () => setDefaultId(c.id) : null}
              onRename={(name) => patch(c.id, (x) => ({ ...x, name }))}
              onStage={(sid, next) => patch(c.id, (x) => ({ ...x, statuses: x.statuses.map((s) => (s.id === sid ? { ...s, ...next } : s)) }))}
              onRemoveStage={(sid) => removeStage(c.id, sid)}
              pendingStage={pendingStage?.cycleId === c.id ? pendingStage.statusId : null}
              pendingCount={pendingStage?.cycleId === c.id ? tasksHoldingStage(c.id, pendingStage.statusId, features, defaultId).length : 0}
              onCancelRemoveStage={() => setPendingStage(null)}
              onConfirmRemoveStage={(to) => pendingStage && confirmRemoveStage(c.id, pendingStage.statusId, to)}
              onAddStage={() => addStage(c.id)}
              onDelete={() => setList((l) => l.filter((x) => x.id !== c.id))}
              blockers={cycleDeletionBlockers(c.id, features, epics, defaultId)}
              t={t}
            />
          ))}
        </div>

        {orgWorkspaceId && (
          <AddFromOrg
            workspaceId={orgWorkspaceId}
            existing={list}
            onAdd={(c) => setList((l) => [...l, c])}
            t={t}
          />
        )}

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
  pendingStage, pendingCount, onCancelRemoveStage, onConfirmRemoveStage,
}: {
  cycle: Cycle; open: boolean; isDefault: boolean;
  onToggle: () => void;
  /** Null at org level: CY4 takes the organisation's FIRST cycle, so order is
   * the only thing that matters there and a default flag would govern nothing. */
  onMakeDefault: (() => void) | null; onRename: (n: string) => void;
  onStage: (id: string, next: Partial<StatusDef>) => void;
  onRemoveStage: (id: string) => void; onAddStage: () => void; onDelete: () => void;
  /** CY7. The stage this row is asking about, if any. */
  pendingStage: string | null;
  pendingCount: number;
  onCancelRemoveStage: () => void;
  onConfirmRemoveStage: (to: string) => void;
  blockers: ReturnType<typeof cycleDeletionBlockers>;
  t: (k: TranslationKey, p?: Record<string, string | number>) => string;
}) {
  const stages = cycle.statuses.filter((s) => s.id !== DONE_STATUS_ID);
  // Reset per stage being asked about: a target chosen for one deletion must
  // not be silently pre-applied to the next.
  const [remapTo, setRemapTo] = useState("");
  useEffect(() => { setRemapTo(""); }, [pendingStage]);
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
        {isDefault && (
          <span className="mono rounded px-1.5 py-0.5 text-[9px] uppercase" style={{ background: "#F7E8DA", color: "#D85A28" }}>{t("cycle.default")}</span>
        )}
        {!isDefault && onMakeDefault && (
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
            {/* CY7: a stage tasks still hold is not deleted on the strength of
                "are you sure?" — the question is where those tasks go, and it
                is asked with the count and the options in front of the user.
                Nothing is written until Save, so cancelling here costs
                nothing. */}
            {pendingStage && (
              <div className="rounded border px-2 py-2" style={{ borderColor: "#E9B949", background: "#FFFBEB" }}>
                <div className="text-[11px]" style={{ color: "#8A6100" }}>
                  {t("cycle.stageInUse", { n: pendingCount, stage: statusMetaOf(pendingStage, cycle.statuses).label })}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <select value={remapTo} aria-label={t("cycle.remapTo")}
                    onChange={(e) => setRemapTo(e.target.value)}
                    className="min-w-0 flex-1 rounded border px-1.5 py-1 text-xs"
                    style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
                    <option value="" disabled>{t("cycle.remapTo")}</option>
                    {cycle.statuses.filter((st) => st.id !== pendingStage).map((st) => (
                      <option key={st.id} value={st.id}>{statusMetaOf(st.id, cycle.statuses).label}</option>
                    ))}
                  </select>
                  <button
                    disabled={!remapTo}
                    onClick={() => onConfirmRemoveStage(remapTo)}
                    className="hoverable no-press rounded border px-2 py-1 text-[11px] font-semibold"
                    style={{ borderColor: "#E9B949", color: remapTo ? "#8A6100" : "#C4B08A" }}>
                    {t("cycle.remapAndDelete")}
                  </button>
                  <button onClick={onCancelRemoveStage} className="no-press text-[11px]" style={{ color: "#64748B" }}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
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
  // A mark, not a panel. The reasons still exist and are still translated —
  // they move into the tooltip and the accessible name rather than being
  // dropped, so the "why" is one hover away instead of occupying the card.
  //
  // The lock is the only thing standing between someone and a Delete button
  // that isn't there, so it must carry an `aria-label`: an icon with no
  // accessible name tells a screen reader nothing at all, and the row would
  // simply appear to be missing its delete control for no stated reason.
  const reasons = [
    blockers.isBeatDefault ? t("cycle.inUseDefault") : null,
    blockers.reassignable.length > 0 ? t("cycle.inUseTasks", { n: blockers.reassignable.length }) : null,
    blockers.doneTasks.length > 0 ? t("cycle.inUseDone", { n: blockers.doneTasks.length }) : null,
    blockers.epics.length > 0 ? t("cycle.inUseEpics", { n: blockers.epics.length }) : null,
  ].filter((x): x is string => !!x);
  const why = `${t("cycle.inUseTitle")} — ${reasons.join(" ")}`;

  return (
    <span title={why} aria-label={why} role="img" className="flex items-center" style={{ color: "#B08A2E" }}>
      <Icon name="lock" size={13} />
    </span>
  );
}

/**
 * "Add from organisation" (Cycles-Spec CY1) — the same gesture and the same
 * wording as the roster's "from People" (`AddFromRosterDialog`).
 *
 * What lands in the Beat is a **copy**, not a reference, and the note says so.
 * CY1 chose that for three reasons, of which the one a user feels is blast
 * radius: renaming an org stage must not relabel a historical task in twenty
 * Beats. CY1a completes it — nothing flows back, so a refinement made here
 * stays here.
 *
 * Ids are regenerated on copy. Keeping the template's would make two Beats'
 * cycles compare equal by id while being independently editable, and would
 * collide outright with a cycle already added from the same template.
 */
function AddFromOrg({
  workspaceId,
  existing,
  onAdd,
  t,
}: {
  workspaceId: string;
  existing: Cycle[];
  onAdd: (c: Cycle) => void;
  t: ReturnType<typeof useT>;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Cycle[] | null>(null);

  const load = async () => {
    setOpen(true);
    if (templates) return;
    setTemplates(await getWorkspaceCycles(workspaceId));
  };

  const copyIn = (tpl: Cycle) => {
    // Name collisions are left alone: two cycles called "Support" is the user's
    // business, and silently renaming one to "Support (2)" is a decision they
    // did not make.
    onAdd(copyCycleTemplate(tpl));
    setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={() => void load()}
        className="hoverable no-press mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
        style={{ borderColor: "#E2DFD9", color: "#334155" }}>
        <Icon name="group" size={13} /> {t("cycle.addFromOrg")}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border px-3 py-2.5" style={{ borderColor: "#E2DFD9", background: "#FBFAF7" }}>
      <div className="flex items-center gap-2">
        <span className="mono text-[10px] uppercase" style={{ color: "#94A3B8" }}>{t("cycle.addFromOrg")}</span>
        <div className="flex-1" />
        <button onClick={() => setOpen(false)} className="no-press" aria-label={t("common.cancel")}>
          <Icon name="close" size={13} style={{ color: "#94A3B8" }} />
        </button>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: "#64748B" }}>{t("cycle.addFromOrgNote")}</p>
      {templates === null && <div className="mono mt-2 text-[11px]" style={{ color: "#94A3B8" }}>…</div>}
      {templates?.length === 0 && (
        <div className="mono mt-2 text-[11px]" style={{ color: "#94A3B8" }}>{t("cycle.noOrgTemplates")}</div>
      )}
      <div className="mt-2 flex flex-col gap-1">
        {(templates ?? []).map((tpl) => {
          // Already taken once. Not disabled — a Beat may legitimately want two
          // variants of the same workflow — but worth saying.
          const taken = existing.some((c) => c.name === tpl.name);
          return (
            <button key={tpl.id} onClick={() => copyIn(tpl)}
              className="hoverable--row flex items-center gap-2 rounded px-2 py-1.5 text-left">
              <Icon name="conversion_path" size={13} style={{ color: "#94A3B8" }} />
              <span className="text-xs font-semibold" style={{ color: "#1F2330" }}>{tpl.name}</span>
              <span className="mono text-[10px]" style={{ color: "#94A3B8" }}>
                {tpl.statuses.map((s) => s.label).join(" › ")}
              </span>
              {taken && <span className="mono text-[9px] uppercase" style={{ color: "#B08A2E", marginLeft: "auto" }}>{t("cycle.alreadyAdded")}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
