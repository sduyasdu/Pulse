import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { confirmAt } from "@/stores/confirmStore";
import { useT } from "@/i18n";
import { subscribeRoster, createMasterResource, patchMasterResource, deleteMasterResource, initialsOf } from "@/services/firestore/roster";
import type { MasterResource } from "@/types";

/**
 * The workspace roster (Resource-Master-Spec §1) — one list of people that
 * Pulses copy from, instead of the same person being retyped in every Pulse.
 *
 * Only an owner curates it; everyone else sees it read-only, because a member
 * needs to read the roster to staff a Pulse but has no business editing the org's
 * people.
 */
export function RosterSection({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<MasterResource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [editing, setEditing] = useState<MasterResource | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeRoster(workspaceId, (r) => { setRows(r); setError(null); }, setError);
  }, [workspaceId]);

  const commitAdd = async () => {
    const name = draftName.trim();
    if (!name) return;
    await createMasterResource(workspaceId, { name, linkedEmail: draftEmail.trim() || null });
    setDraftName("");
    setDraftEmail("");
    setAdding(false);
  };

  const remove = async (r: MasterResource, e: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(e, {
      message: t("roster.deleteConfirm", { name: r.name }),
      // States what it does NOT do. Removing someone from the roster is a
      // tidy-up, and a customer has every reason to fear it will strip them out
      // of live plans — it does not (RM13).
      detail: t("roster.deleteDetail"),
      confirmLabel: t("roster.deleteAction"),
    });
    if (!ok) return;
    await deleteMasterResource(workspaceId, r.id);
  };

  return (
    <section className="mt-12">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold text-yasdu-fg">{t("roster.title")}</h2>
        {rows && <span className="mono text-xs" style={{ color: "#94A3B8" }}>{rows.length}</span>}
        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className="hoverable mono ml-auto flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold border-yasdu-orange-soft bg-yasdu-accent text-yasdu-primary"
          >
            <Icon name="person_add" size={14} />
            {t("roster.add")}
          </button>
        )}
      </div>
      <p className="mb-3 text-xs" style={{ color: "#94A3B8" }}>{t("roster.intro")}</p>

      {error ? (
        // Distinct from an empty roster on purpose: "this org has no people" and
        // "you may not see them" must not render identically (CLAUDE.md).
        <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "#FDECEA", border: "1px solid #F3C7C1", color: "#8C2F22" }}>
          {t("roster.loadError")}
        </p>
      ) : rows === null ? (
        <Spinner size={20} label={t("common.loading")} className="py-6" />
      ) : (
        <div className="rounded-xl border" style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}>
          {adding && (
            <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "#F1F5F9" }}>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t("roster.namePlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter") void commitAdd(); if (e.key === "Escape") { setDraftName(""); setDraftEmail(""); setAdding(false); } }}
                className="min-w-0 flex-1 rounded border px-2 py-1.5 text-xs outline-none"
                style={{ borderColor: "#E2DFD9" }}
              />
              <input
                value={draftEmail}
                onChange={(e) => setDraftEmail(e.target.value)}
                placeholder={t("roster.emailPlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter") void commitAdd(); if (e.key === "Escape") { setDraftName(""); setDraftEmail(""); setAdding(false); } }}
                className="min-w-0 flex-1 rounded border px-2 py-1.5 text-xs outline-none"
                style={{ borderColor: "#E2DFD9" }}
              />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void commitAdd()}
                disabled={draftName.trim() === ""}
                aria-label={t("roster.addConfirm")}
                title={t("roster.addConfirm")}
                className="hoverable rounded border p-1 disabled:opacity-35"
                style={{ borderColor: "#E2DFD9", color: "#D85A28" }}
              >
                <Icon name="check" size={14} />
              </button>
            </div>
          )}

          {rows.length === 0 && !adding ? (
            <p className="px-3 py-6 text-center text-xs" style={{ color: "#94A3B8" }}>{t("roster.empty")}</p>
          ) : (
            rows.map((r) => <RosterRow key={r.id} r={r} canManage={canManage} onEdit={() => setEditing(r)} onRemove={remove} />)
          )}
        </div>
      )}

      {editing && (
        <EditRosterDialog
          resource={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await patchMasterResource(workspaceId, editing.id, patch); setEditing(null); }}
        />
      )}
    </section>
  );
}

/** One person. The link chip is RM20's three states, read straight off the two
 * fields — no stored flag, because a stored one could drift from them. */
function RosterRow({ r, canManage, onEdit, onRemove }: {
  r: MasterResource;
  canManage: boolean;
  onEdit: () => void;
  onRemove: (r: MasterResource, e: { clientX: number; clientY: number }) => void;
}) {
  const t = useT();
  const live = !!r.linkedUid;
  const waiting = !live && !!r.linkedEmail;

  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0" style={{ borderColor: "#F5F3EF" }}>
      <span
        className="mono flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ width: 26, height: 26, background: "#F1F5F9", color: "#475569" }}
      >
        {r.initials || initialsOf(r.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold" style={{ color: "#1F2330" }}>{r.name}</div>
        <div className="mono truncate text-[10px]" style={{ color: "#94A3B8" }}>
          {[r.type, `${r.capacity ?? 100}%`, r.linkedEmail].filter(Boolean).join(" · ")}
        </div>
      </div>

      <span
        className="mono shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
        title={live ? t("roster.linkedTitle") : waiting ? t("roster.waitingTitle") : t("roster.unlinkedTitle")}
        style={
          live ? { background: "#E7F6F1", color: "#0F766E" }
            : waiting ? { background: "#FEF3C7", color: "#92400E" }
              : { background: "#F4F5F7", color: "#94A3B8" }
        }
      >
        {live ? t("roster.linked") : waiting ? t("roster.waiting") : t("roster.unlinked")}
      </span>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onEdit} title={t("common.edit")} aria-label={t("common.edit")} className="hoverable rounded border p-1" style={{ borderColor: "#E2DFD9", color: "#64748B" }}>
            <Icon name="edit" size={13} />
          </button>
          <button onClick={(e) => void onRemove(r, e)} title={t("roster.deleteAction")} aria-label={t("roster.deleteAction")} className="hoverable rounded border p-1" style={{ borderColor: "#E2DFD9", color: "#94A3B8" }}>
            <Icon name="delete" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function EditRosterDialog({ resource, onClose, onSave }: {
  resource: MasterResource;
  onClose: () => void;
  onSave: (patch: { name: string; type: string | null; capacity: number; linkedEmail: string | null }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(resource.name);
  const [type, setType] = useState(resource.type ?? "");
  const [capacity, setCapacity] = useState(String(resource.capacity ?? 100));
  const [email, setEmail] = useState(resource.linkedEmail ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await onSave({
      name: name.trim(),
      type: type.trim() || null,
      capacity: Math.max(1, Math.min(1000, Number(capacity) || 100)),
      linkedEmail: email.trim() || null,
    });
  };

  const field = "w-full rounded-lg border px-3 py-2 text-sm outline-none";
  const label = "mono text-[10px] uppercase tracking-wide";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">{t("roster.editTitle")}</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={label} style={{ color: "#94A3B8" }}>{t("roster.nameLabel")}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} style={{ borderColor: "#E2DFD9" }} />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={label} style={{ color: "#94A3B8" }}>{t("roster.typeLabel")}</span>
              <input value={type} onChange={(e) => setType(e.target.value)} className={field} style={{ borderColor: "#E2DFD9" }} />
            </label>
            <label className="flex w-28 flex-col gap-1">
              <span className={label} style={{ color: "#94A3B8" }}>{t("roster.capacityLabel")}</span>
              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" className={field} style={{ borderColor: "#E2DFD9" }} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={label} style={{ color: "#94A3B8" }}>{t("roster.emailLabel")}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className={field} style={{ borderColor: "#E2DFD9" }} />
            {/* Says what linking does and, more usefully, what it does not: it
                grants nobody access to anything (RM6). */}
            <span className="text-[11px]" style={{ color: "#94A3B8" }}>{t("roster.emailHint")}</span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm" style={{ color: "#64748B" }}>{t("common.cancel")}</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50" style={{ background: "#D85A28" }}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
