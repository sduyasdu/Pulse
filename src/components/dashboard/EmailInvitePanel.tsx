import { useEffect, useState } from "react";
import type { PulseMember, PulseRole, Resource } from "@/types";
import { inviteToPulse, inviteUrl } from "@/services/firestore/invites";
import { emailKey } from "@/services/firestore/emailKey";
import { fetchResources } from "@/services/firestore/resources";
import { subscribePulseMembers } from "@/services/firestore/memberships";
import { logDirectActivity } from "@/domain/activityRecorder";
import { roleMeta } from "@/domain/permissions";
import { copyText, shareOrCopy } from "@/domain/share";
import { Icon } from "@/components/shared/Icon";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/i18n";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** Someone this Pulse already names but can't let in. */
interface Candidate {
  email: string;
  name: string;
  resource: Resource;
}

/**
 * Which linked people to offer as invitees.
 *
 * A resource carrying a `linkedEmail` names a real person; `linkedUid` is what
 * that address resolved to *against this Pulse's membership*, so its absence is
 * already the app's record of "we know who this is, and they can't open the
 * Pulse". That's the entire list — the inviter shouldn't have to notice the
 * distinction themselves and retype an address the Pulse is already holding.
 *
 * Member emails are checked too, even though `linkedUid` should cover it.
 * Membership docs created before the field existed have no email, and the
 * resolver only fills `linkedUid` in when it runs — a resource linked to a
 * member it never resolved would otherwise be offered as an invitee, and
 * inviting an existing collaborator is a confusing no-op.
 */
export function candidatesFrom(resources: Resource[], members: PulseMember[], invited: Set<string>): Candidate[] {
  const memberEmails = new Set(members.map((m) => emailKey(m.email ?? "")).filter(Boolean));
  const out = new Map<string, Candidate>();
  for (const r of resources) {
    const email = emailKey(r.linkedEmail ?? "");
    if (!email) continue;
    if (r.linkedUid) continue;
    if (memberEmails.has(email) || invited.has(email)) continue;
    // First resource wins the display name; two resources sharing an address is
    // one person either way, and one row is what the inviter can act on.
    if (!out.has(email)) out.set(email, { email, name: r.name || email, resource: r });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface Props {
  pulseId: string;
  role: PulseRole;
  /** Emails with an outstanding invite — excluded from the suggestions, since
   * inviting them again would just rewrite the same doc. */
  invitedEmails: string[];
  /** Lets the host dialog refresh its pending list after a new invite. */
  onInvited?: () => void;
}

/**
 * Invite one named person (Current-Spec IV6). The link this produces is not a
 * capability — see `inviteToPulse`. Whoever opens it has to prove they own the
 * address before it grants anything, so the safe thing to do with it is exactly
 * what people already do: paste it into a chat.
 */
export function EmailInvitePanel({ pulseId, role, invitedEmails, onInvited }: Props) {
  const t = useT();
  const uid = useAuthStore((s) => s.firebaseUser?.uid ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed by address so only the row that was copied flashes. The typed-input
  // path gets its own flag: it clears `email` on success, so keying its flash
  // off the input's value would compare against "" and never light up.
  const [copied, setCopied] = useState<string | null>(null);
  const [typedCopied, setTypedCopied] = useState(false);
  const [resources, setResources] = useState<Resource[]>([]);
  const [members, setMembers] = useState<PulseMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchResources(pulseId)
      .then((rs) => { if (!cancelled) setResources(rs); })
      .catch(() => { if (!cancelled) setResources([]); });
    const unsub = subscribePulseMembers(pulseId, (ms) => { if (!cancelled) setMembers(ms); });
    return () => { cancelled = true; unsub(); };
  }, [pulseId]);

  const invitedSet = new Set(invitedEmails.map(emailKey));
  const candidates = candidatesFrom(resources, members, invitedSet);

  const flashCopied = (key: string, typed: boolean) => {
    if (typed) {
      setTypedCopied(true);
      setTimeout(() => setTypedCopied(false), 1800);
      return;
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  };

  /** Create the invitation, then hand over its link. Both halves matter: the
   * invite doc alone works (it resolves on their next sign-in) but nobody has
   * been told, and the link alone grants nothing without the doc. */
  const invite = async (raw: string, share: boolean) => {
    const key = emailKey(raw);
    if (!EMAIL_RE.test(key)) { setError(t("invite.emailInvalid")); return; }
    if (members.some((m) => emailKey(m.email ?? "") === key)) { setError(t("invite.alreadyMember")); return; }

    setBusy(true);
    setError(null);
    try {
      await inviteToPulse(pulseId, key, role, uid);
      logDirectActivity(pulseId, {
        entityKind: "invite", entityId: key, entityName: key, verb: "add",
        summary: `invited ${key} as ${roleMeta(role).label}`,
      });
      const url = inviteUrl(pulseId, key);
      const outcome = share ? await shareOrCopy({ title: t("share.pulseTitle"), url }) : (await copyText(url)) ? "copied" : "failed";
      if (outcome === "failed") setError(t("invite.copyError"));
      else if (outcome === "copied") flashCopied(key, share);
      setEmail("");
      onInvited?.();
    } catch {
      setError(t("invite.createError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) void invite(email, true); }}
          placeholder={t("invite.emailPlaceholder")}
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "#E2DFD9" }}
        />
        <button
          type="button"
          onClick={() => void invite(email, true)}
          disabled={busy || !email.trim()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-yasdu-primary-fg disabled:opacity-50"
          style={{ background: typedCopied ? "#12A594" : "#D85A28" }}
        >
          <Icon name={typedCopied ? "check" : "person_add"} size={15} />
          {typedCopied ? t("invite.linkCopied") : t("invite.createAndCopy")}
        </button>
      </div>

      <p className="text-xs text-yasdu-muted">{t("invite.emailHint", { role: roleMeta(role).label })}</p>

      {candidates.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="mono text-[11px] uppercase tracking-wide text-yasdu-muted">{t("invite.suggested")}</div>
          <p className="text-xs text-yasdu-muted">{t("invite.suggestedHint")}</p>
          {candidates.map((c) => (
            <div key={c.email} className="flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5" style={{ borderColor: "#E2DFD9" }}>
              {/* Not ResourceBadge: that reads the live pulse store, which
                  isn't loaded when this dialog opens from the dashboard, so it
                  would render "?" for every row. The initials are already on
                  the resource we fetched. */}
              <span
                className="mono flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{ background: "#E2DFD9", color: "#475569" }}
              >
                {c.resource.initials || "?"}
              </span>
              <span className="flex flex-1 min-w-0 flex-col">
                <span className="truncate text-sm text-yasdu-fg">{c.name}</span>
                <span className="mono truncate text-[10px] text-yasdu-muted">{c.email}</span>
              </span>
              <button
                type="button"
                onClick={() => void invite(c.email, false)}
                disabled={busy}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ background: copied === c.email ? "#12A594" : "#FFF7F1", color: copied === c.email ? "#FFFFFF" : "#D85A28" }}
                title={t("invite.inviteAs", { role: roleMeta(role).label })}
              >
                {copied === c.email ? t("invite.linkCopied") : t("invite.suggestInvite")}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
