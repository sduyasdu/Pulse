import { useState } from "react";
import type { DuplicateMode } from "@/services/firestore/pulses";
import { useT } from "@/i18n";

interface DuplicatePulseDialogProps {
  pulseName: string;
  onClose: () => void;
  onDuplicate: (name: string, mode: DuplicateMode) => Promise<void>;
}

export function DuplicatePulseDialog({ pulseName, onClose, onDuplicate }: DuplicatePulseDialogProps) {
  const t = useT();
  const MODES: { id: DuplicateMode; label: string; detail: string }[] = [
    { id: "full", label: t("dialog.copyFull"), detail: t("dialog.copyFullDetail") },
    { id: "noResources", label: t("dialog.copyNoResources"), detail: t("dialog.copyNoResourcesDetail") },
    { id: "empty", label: t("dialog.copyEmpty"), detail: t("dialog.copyEmptyDetail") },
  ];
  const [name, setName] = useState(`${pulseName || t("common.untitledPulse")} ${t("card.copySuffix")}`);
  const [mode, setMode] = useState<DuplicateMode>("full");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDuplicate(name.trim(), mode);
    } catch (err) {
      setError((err as Error).message || t("dialog.duplicateError"));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">{t("dialog.duplicatePulse")}</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("dialog.newPulseNamePlaceholder")}
            className="rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "#E2DFD9" }}
          />
          <div className="flex flex-col gap-2">
            {MODES.map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className="text-left rounded-lg border px-3 py-2.5"
                  style={{ borderColor: on ? "#D85A28" : "#E2DFD9", background: on ? "#FFF7F1" : "#FFFFFF" }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: on ? "4px solid #D85A28" : "2px solid #CBD5E1" }} />
                    <span className="text-sm font-semibold text-yasdu-fg">{m.label}</span>
                  </div>
                  <div className="mono mt-1" style={{ fontSize: 11, color: "#64748B", paddingLeft: 22 }}>{m.detail}</div>
                </button>
              );
            })}
          </div>
          {error && <span className="text-xs text-red-600">{error}</span>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-yasdu-muted">{t("common.cancel")}</button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
              style={{ background: "#D85A28" }}
            >
              {submitting ? t("dialog.duplicating") : t("dialog.duplicate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
