import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

interface CreatePulseDialogProps {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  /** The plan's Pulse cap, for the message shown if the rules refuse the
   * create. `null` = unlimited, in which case a denial isn't about quota. */
  limit?: number | null;
  /** The org looks full. Warned about up front rather than used to block —
   * the counter is async, so this can be stale in either direction and the
   * rules are what actually decide. */
  atLimit?: boolean;
  used?: number;
}

export function CreatePulseDialog({ onClose, onCreate, limit, atLimit, used = 0 }: CreatePulseDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim());
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
