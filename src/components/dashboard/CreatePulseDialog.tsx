import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";
import { getWorkspaceCycles } from "@/services/firestore/workspaces";
import { copyCycleTemplate } from "@/domain/cycleTemplate";
import type { Cycle } from "@/types";

interface CreatePulseDialogProps {
  onClose: () => void;
  onCreate: (name: string, cycle: Cycle | null) => Promise<void>;
  /** Whose templates to offer (Cycles-Spec CY4). Null while the dashboard is
   * still resolving it — the select simply does not appear, and the Beat is
   * created with no cycles field, which `cyclesOf` handles (CY11). */
  workspaceId?: string | null;
  /** The plan's Pulse cap, for the message shown if the rules refuse the
   * create. `null` = unlimited, in which case a denial isn't about quota. */
  limit?: number | null;
  /** The org looks full. Warned about up front rather than used to block —
   * the counter is async, so this can be stale in either direction and the
   * rules are what actually decide. */
  atLimit?: boolean;
  used?: number;
}

export function CreatePulseDialog({ onClose, onCreate, limit, atLimit, used = 0, workspaceId }: CreatePulseDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * CY4. The org's templates, with the first pre-selected so the common path
   * stays "type a name and press Enter". An org with no templates, or one the
   * creator cannot read, shows no select at all rather than an empty one.
   */
  const [templates, setTemplates] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    void getWorkspaceCycles(workspaceId).then((cs) => {
      if (!live) return;
      setTemplates(cs);
      setCycleId(cs[0]?.id ?? "");
    });
    return () => { live = false; };
  }, [workspaceId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const tpl = templates.find((c) => c.id === cycleId) ?? null;
      // The same copy the Beat's cycle manager makes (CY1): the Beat gets its
      // own ids, and editing it never reaches the template.
      await onCreate(name.trim(), tpl ? copyCycleTemplate(tpl) : null);
    } catch (err) {
      // The soft gate on the dashboard normally prevents this, but the counter
      // is async (PL5) — so a create can still be refused by the rules after the
      // button looked live. "Missing or insufficient permissions" is the wrong
      // thing to show someone who has just hit a paywall.
      const code = (err as { code?: string } | null)?.code;
      setError(
        code === "permission-denied"
          ? t("plan.pulseLimitError", { limit: String(limit ?? "") })
          : (err as Error).message || t("dialog.createError"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">{t("dialog.newPulse")}</h2>
        {atLimit && (
          <div className="mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "#FFF7F1", border: "1px solid #FBD3BE", color: "#9A3412" }}>
            <Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t("plan.pulseLimitReached", { used, limit: String(limit) })}</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("dialog.newPulsePlaceholder")}
            className="rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "#E2DFD9" }}
          />
          {templates.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="mono text-[10px] uppercase" style={{ color: "#94A3B8" }}>{t("cycle.title")}</span>
              <select
                value={cycleId}
                onChange={(e) => setCycleId(e.target.value)}
                className="rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ borderColor: "#E2DFD9", background: "#FFFFFF" }}
              >
                {templates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-yasdu-muted">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
              style={{ background: "#D85A28" }}
            >
              {t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
