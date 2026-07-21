import { useState } from "react";

interface CreatePulseDialogProps {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export function CreatePulseDialog({ onClose, onCreate }: CreatePulseDialogProps) {
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
      setError((err as Error).message || "Couldn't create this Pulse — try again.");
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
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">New Pulse</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Pulse de conciliaciones"
            className="rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "#E2DFD9" }}
          />
          {error && <span className="text-xs text-red-600">{error}</span>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-yasdu-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
              style={{ background: "#D85A28" }}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
