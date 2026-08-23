import { useState } from "react";
import { useT } from "@/i18n";
import { initialsOf } from "@/services/firestore/roster";
import type { MasterResource } from "@/types";

/**
 * Add or edit a person in the roster — **every field, on the way in.**
 *
 * The earlier inline row asked only for a name, which meant every person had to
 * be created and then immediately edited. A roster entry is a small record and
 * there is no reason to split it across two steps.
 */
export function MasterResourceDialog({ resource, onClose, onSave }: {
  resource: MasterResource | null;
  onClose: () => void;
  onSave: (values: { name: string; initials: string; type: string | null; capacity: number; linkedEmail: string | null }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(resource?.name ?? "");
  // Empty means "derive from the name" — kept as a placeholder rather than
  // prefilled, so typing a name updates it instead of fighting a stale value.
  const [initials, setInitials] = useState(resource?.initials ?? "");
  const [type, setType] = useState(resource?.type ?? "");
  const [capacity, setCapacity] = useState(String(resource?.capacity ?? 100));
  const [email, setEmail] = useState(resource?.linkedEmail ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        initials: (initials.trim() || initialsOf(name)).slice(0, 3).toUpperCase(),
        type: type.trim() || null,
        // Clamped rather than validated: a capacity of 0 or 10000 is a typo, and
        // refusing the whole form over it is worse than fixing it.
        capacity: Math.max(1, Math.min(1000, Number(capacity) || 100)),
        linkedEmail: email.trim() || null,
      });
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border px-3 py-2 text-sm outline-none";
  const label = "mono text-[10px] uppercase tracking-wide";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">
          {resource ? t("roster.editTitle") : t("roster.addTitle")}
        </h2>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={label} style={{ color: "#94A3B8" }}>{t("roster.nameLabel")}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("roster.namePlaceholder")} className={field} style={{ borderColor: "#E2DFD9" }} />
          </label>

          <div className="flex gap-3">
            <label className="flex w-24 flex-col gap-1">
              <span className={label} style={{ color: "#94A3B8" }}>{t("roster.initialsLabel")}</span>
              <input
                value={initials}
                onChange={(e) => setInitials(e.target.value)}
                placeholder={name.trim() ? initialsOf(name) : "—"}
                maxLength={3}
                className={field}
                style={{ borderColor: "#E2DFD9" }}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={label} style={{ color: "#94A3B8" }}>{t("roster.typeLabel")}</span>
              <input value={type} onChange={(e) => setType(e.target.value)} placeholder={t("roster.typePlaceholder")} className={field} style={{ borderColor: "#E2DFD9" }} />
            </label>
            <label className="flex w-24 flex-col gap-1">
              <span className={label} style={{ color: "#94A3B8" }}>{t("roster.capacityLabel")}</span>
              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" className={field} style={{ borderColor: "#E2DFD9" }} />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className={label} style={{ color: "#94A3B8" }}>{t("roster.emailLabel")}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder={t("roster.emailPlaceholder")} className={field} style={{ borderColor: "#E2DFD9" }} />
            {/* The thing customers most need told: linking says who someone is
                and grants access to nothing (RM6). */}
            <span className="text-[11px] leading-relaxed" style={{ color: "#94A3B8" }}>{t("roster.emailHint")}</span>
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
