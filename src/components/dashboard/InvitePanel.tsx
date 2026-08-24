import { useState } from "react";
import type { PulseRole } from "@/types";
import { ASSIGNABLE_ROLES } from "@/domain/permissions";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";
import { InviteLinkPanel } from "./InviteLinkPanel";
import { EmailInvitePanel } from "./EmailInvitePanel";

/**
 * The two ways into a Pulse, side by side (Current-Spec IV5–IV7).
 *
 * They differ in what the link is. The **open** link carries the grant: holding
 * the URL is the whole qualification, so it suits a team channel and is exactly
 * as shareable as the person who has it decides. The **bounded** link carries
 * only a destination — the grant sits in an invite doc addressed to one
 * confirmed address — so forwarding it accomplishes nothing.
 *
 * Both are offered rather than one replacing the other, because the choice is
 * about who is being invited and only the inviter knows that. The email kind
 * leads: naming a person is the more common case and the safer default, and the
 * open link stays one click away for "post this to the channel".
 *
 * The role picker is shared. It applies to whichever kind is showing, which is
 * why it sits above the switch — the same decision either way.
 */
export function InvitePanel({ pulseId, canEdit, invitedEmails = [], onInvited }: {
  pulseId: string;
  canEdit: boolean;
  invitedEmails?: string[];
  onInvited?: () => void;
}) {
  const t = useT();
  const [role, setRole] = useState<PulseRole>("viewer");
  const [kind, setKind] = useState<"email" | "link">("email");

  if (!canEdit) return null;

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

      {/* Tabs, not a hover reveal — both kinds have to be discoverable on touch,
          and which one you want isn't something the app can guess. */}
      <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "#F1EFEA" }}>
        {([["email", "alternate_email"], ["link", "link"]] as const).map(([k, icon]) => (
          <button
            type="button"
            key={k}
            onClick={() => setKind(k)}
            className="no-press flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold"
            style={{
              background: kind === k ? "#FFFFFF" : "transparent",
              color: kind === k ? "#D85A28" : "#64748B",
              boxShadow: kind === k ? "0 1px 3px rgba(15,23,42,0.10)" : "none",
            }}
          >
            <Icon name={icon} size={14} />
            {k === "email" ? t("invite.kindEmail") : t("invite.kindLink")}
          </button>
        ))}
      </div>

      {kind === "email" ? (
        <EmailInvitePanel pulseId={pulseId} role={role} invitedEmails={invitedEmails} onInvited={onInvited} />
      ) : (
        <InviteLinkPanel pulseId={pulseId} canEdit={canEdit} role={role} />
      )}
    </div>
  );
}
