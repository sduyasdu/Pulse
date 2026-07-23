import { useState } from "react";
import type { DuplicateMode } from "@/services/firestore/pulses";

interface DuplicatePulseDialogProps {
  pulseName: string;
  onClose: () => void;
  onDuplicate: (name: string, mode: DuplicateMode) => Promise<void>;
}

const MODES: { id: DuplicateMode; label: string; detail: string }[] = [
  { id: "full", label: "Copy tasks & resources", detail: "Epics, tasks and subtasks, plus the team and their assignments." },
  { id: "noResources", label: "Copy tasks, no resources", detail: "Epics, tasks and subtasks, but no team — tasks are left unassigned." },
  { id: "empty", label: "Empty Pulse", detail: "A blank Pulse — nothing is copied, just the name." },
];

export function DuplicatePulseDialog({ pulseName, onClose, onDuplicate }: DuplicatePulseDialogProps) {
  const [name, setName] = useState(`${pulseName || "Untitled Pulse"} (copy)`);
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
      setError((err as Error).message || "Couldn't duplicate this Pulse — try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">Duplicate Pulse</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New Pulse name"
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
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-yasdu-muted">Cancel</button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
              style={{ background: "#D85A28" }}
            >
              {submitting ? "Duplicating…" : "Duplicate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
