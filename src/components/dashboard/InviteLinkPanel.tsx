import { useEffect, useState } from "react";
import type { InviteLink, PulseRole } from "@/types";
import { getPulseInviteLink, setPulseInviteLink, clearPulseInviteLink } from "@/services/firestore/joinLinks";

const ROLES: { value: PulseRole; label: string; hint: string }[] = [
  { value: "viewer", label: "Viewer", hint: "Read-only" },
  { value: "editor", label: "Editor", hint: "Can edit everything" },
];

/** Copy-link invite control: pick a role, copy a shareable join link, and
 * revoke it. No email is sent — the user shares the link however they like. */
export function InviteLinkPanel({ pulseId, canEdit }: { pulseId: string; canEdit: boolean }) {
  const [invite, setInvite] = useState<InviteLink | null | undefined>(undefined); // undefined = loading
  const [role, setRole] = useState<PulseRole>("viewer");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPulseInviteLink(pulseId)
      .then((i) => { if (!cancelled) { setInvite(i); if (i) setRole(i.role); } })
      .catch(() => { if (!cancelled) setInvite(null); });
    return () => { cancelled = true; };
  }, [pulseId]);

  if (!canEdit) return null;

  const urlFor = (i: InviteLink) => `${window.location.origin}/join/${pulseId}/${i.token}/${i.role}`;

  const copyLink = async () => {
    setBusy(true);
    setError(null);
    try {
      // Reuse the active link if it already grants the chosen role; otherwise
      // (re)generate — there's one active link at a time.
      let i = invite && invite.role === role ? invite : await setPulseInviteLink(pulseId, role);
      setInvite(i);
      await navigator.clipboard.writeText(urlFor(i));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy the link — try again.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearPulseInviteLink(pulseId);
      setInvite(null);
    } catch {
      setError("Couldn't revoke the link — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        {ROLES.map((r) => (
          <button
            type="button"
            key={r.value}
            onClick={() => setRole(r.value)}
            className="flex-1 rounded-lg border px-3 py-2 text-left text-xs"
            style={{ borderColor: role === r.value ? "#EE7240" : "#E2DFD9", background: role === r.value ? "#FFF7F1" : "#FFFFFF" }}
          >
            <div className="font-semibold text-yasdu-fg">{r.label}</div>
            <div className="text-yasdu-muted">{r.hint}</div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void copyLink()}
        disabled={busy}
        className="rounded-lg px-4 py-2.5 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
        style={{ background: copied ? "#12A594" : "#D85A28" }}
      >
        {copied ? "✓ Link copied" : `Copy ${role} invite link`}
      </button>

      {invite && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={urlFor(invite)}
            onFocus={(e) => e.currentTarget.select()}
            className="mono flex-1 rounded border px-2 py-1.5 text-[11px]"
            style={{ borderColor: "#E2DFD9", color: "#64748B", background: "#F8FAFC" }}
          />
          <button type="button" onClick={() => void revoke()} disabled={busy} className="mono text-[11px]" style={{ color: "#DC2626" }}>
            Revoke
          </button>
        </div>
      )}

      <p className="text-xs text-yasdu-muted">
        Anyone with this link can join as <b>{invite ? invite.role : role}</b>. Send it however you like — Slack, email, etc. Revoke it anytime.
      </p>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
