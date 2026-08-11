import { useEffect, useState } from "react";
import type { InviteLink, PulseRole } from "@/types";
import { getPulseInviteLink, setPulseInviteLink, clearPulseInviteLink } from "@/services/firestore/joinLinks";
import { ASSIGNABLE_ROLES, roleMeta } from "@/domain/permissions";
import { logDirectActivity } from "@/domain/activityRecorder";
import { canNativeShare, copyText, shareOrCopy } from "@/domain/share";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

/** Copy-link invite control: pick a role, copy a shareable join link, and
 * revoke it. No email is sent — the user shares the link however they like. */
export function InviteLinkPanel({ pulseId, canEdit }: { pulseId: string; canEdit: boolean }) {
  const t = useT();
  const [invite, setInvite] = useState<InviteLink | null | undefined>(undefined); // undefined = loading
  const [role, setRole] = useState<PulseRole>("viewer");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Capability, not a preference — fixed for the session, so read it once.
  const [nativeShare] = useState(() => canNativeShare());

  useEffect(() => {
    let cancelled = false;
    void getPulseInviteLink(pulseId)
      .then((i) => { if (!cancelled) { setInvite(i); if (i) setRole(i.role); } })
      .catch(() => { if (!cancelled) setInvite(null); });
    return () => { cancelled = true; };
  }, [pulseId]);

  if (!canEdit) return null;

  const urlFor = (i: InviteLink) => `${window.location.origin}/join/${pulseId}/${i.token}/${i.role}`;

  const sendLink = async () => {
    setBusy(true);
    setError(null);
    try {
      // Reuse the active link if it already grants the chosen role; otherwise
      // (re)generate — there's one active link at a time.
      const reused = !!(invite && invite.role === role);
      const i = reused ? invite! : await setPulseInviteLink(pulseId, role);
      setInvite(i);
      if (!reused) logDirectActivity(pulseId, { entityKind: "invite", entityId: pulseId, entityName: "invite link", verb: "link-created", summary: `created a ${roleMeta(role).label} invite link` });
      // Share sheet where the platform has one, clipboard everywhere else.
      // Note the round-trip above can cost us the user gesture on Safari when
      // the link had to be created; shareOrCopy falls back to a copy in that
      // case, so the user is never left empty-handed.
      const outcome = await shareOrCopy({ title: t("share.pulseTitle"), url: urlFor(i) });
      if (outcome === "failed") {
        setError(t("invite.copyError"));
      } else if (outcome === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      setError(t("invite.copyError"));
    } finally {
      setBusy(false);
    }
  };

  const copyExisting = async (i: InviteLink) => {
    if (await copyText(urlFor(i))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setError(t("invite.copyError"));
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearPulseInviteLink(pulseId);
      logDirectActivity(pulseId, { entityKind: "invite", entityId: pulseId, entityName: "invite link", verb: "link-revoked", summary: `revoked the invite link` });
      setInvite(null);
    } catch {
      setError(t("invite.revokeError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2">
        {ASSIGNABLE_ROLES.map((r) => (
          <button
            type="button"
            key={r.value}
            onClick={() => setRole(r.value)}
            className="rounded-lg border px-3 py-2 text-left text-xs"
            style={{ borderColor: role === r.value ? "#EE7240" : "#E2DFD9", background: role === r.value ? "#FFF7F1" : "#FFFFFF" }}
          >
            <div className="font-semibold text-yasdu-fg">{r.label}</div>
            <div className="text-yasdu-muted">{r.hint}</div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void sendLink()}
        disabled={busy}
        className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
        style={{ background: copied ? "#12A594" : "#D85A28" }}
      >
        {copied ? (
          t("invite.linkCopied")
        ) : (
          <>
            <Icon name={nativeShare ? "share" : "link"} size={15} />
            {nativeShare ? t("invite.shareRoleLink", { role: roleMeta(role).label }) : t("invite.copyRoleLink", { role: roleMeta(role).label })}
          </>
        )}
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
          {/* Copy stays reachable even when the button above opens a share
              sheet instead — pasting the link somewhere by hand is still the
              fastest route for plenty of people. */}
          <button type="button" onClick={() => void copyExisting(invite)} disabled={busy} title={t("invite.copyLink")} aria-label={t("invite.copyLink")} className="flex items-center" style={{ color: "#64748B" }}>
            <Icon name="content_copy" size={14} />
          </button>
          <button type="button" onClick={() => void revoke()} disabled={busy} className="mono text-[11px]" style={{ color: "#DC2626" }}>
            {t("common.revoke")}
          </button>
        </div>
      )}

      <p className="text-xs text-yasdu-muted">
        {t("invite.anyoneCanJoin", { role: roleMeta(invite ? invite.role : role).label })}
      </p>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
