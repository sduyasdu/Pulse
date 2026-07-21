import { useState } from "react";
import type { PulseRole } from "@/types";

interface InviteDialogProps {
  pulseName: string;
  onClose: () => void;
  onInvite: (email: string, role: PulseRole) => Promise<void>;
}

const ROLES: { value: PulseRole; label: string; hint: string }[] = [
  { value: "editor", label: "Editor", hint: "Can edit everything" },
  { value: "viewer", label: "Viewer", hint: "Read-only" },
];

export function InviteDialog({ pulseName, onClose, onInvite }: InviteDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PulseRole>("editor");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onInvite(email.trim(), role);
      setSent(true);
    } catch (err) {
      setError((err as Error).message || "Couldn't send this invite — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-1 text-base font-semibold text-yasdu-fg">Invite to “{pulseName}”</h2>
        <p className="mb-4 text-xs text-yasdu-muted">
          They'll get access as soon as they sign in with this email.
        </p>
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <span className="text-sm text-yasdu-fg">Invite sent to {email}.</span>
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: "#E2DFD9" }}
            />
            <div className="flex gap-2">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setRole(r.value)}
                  className="flex-1 rounded-lg border px-3 py-2 text-left text-xs"
                  style={{
                    borderColor: role === r.value ? "#EE7240" : "#E2DFD9",
                    background: role === r.value ? "#FFF7F1" : "#FFFFFF",
                  }}
                >
                  <div className="font-semibold text-yasdu-fg">{r.label}</div>
                  <div className="text-yasdu-muted">{r.hint}</div>
                </button>
              ))}
            </div>
            {error && <span className="text-xs text-red-600">{error}</span>}
            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-yasdu-muted">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!email.trim() || submitting}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
                style={{ background: "#D85A28" }}
              >
                Send invite
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
