import { useCallback, useEffect, useState } from "react";
import type { Invite, PulseMember, PulseRole } from "@/types";
import { fetchInvites, revokeInvite } from "@/services/firestore/invites";
import { removeMember, setMemberRole } from "@/services/firestore/memberships";
import { confirmAt } from "@/stores/confirmStore";
import { InviteLinkPanel } from "./InviteLinkPanel";

interface CollaboratorsDialogProps {
  pulseId: string;
  pulseName: string;
  members: PulseMember[];
  currentUid: string;
  myRole: PulseRole;
  onClose: () => void;
}

const ROLE_BADGE: Record<PulseRole, { label: string; bg: string; fg: string }> = {
  owner: { label: "Owner", bg: "#FEF0E7", fg: "#C2410C" },
  editor: { label: "Editor", bg: "#EAF1FB", fg: "#1D4ED8" },
  viewer: { label: "Viewer", bg: "#F1F5F9", fg: "#475569" },
};

function RoleBadge({ role }: { role: PulseRole }) {
  const b = ROLE_BADGE[role];
  return (
    <span className="mono rounded px-1.5 py-0.5" style={{ fontSize: 10, background: b.bg, color: b.fg, textTransform: "uppercase" }}>
      {b.label}
    </span>
  );
}

export function CollaboratorsDialog({ pulseId, pulseName, members, currentUid, myRole, onClose }: CollaboratorsDialogProps) {
  const canManage = myRole === "owner" || myRole === "editor"; // may invite / revoke
  const isOwner = myRole === "owner"; // may remove members

  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [invitesError, setInvitesError] = useState<string | null>(null);

  const reloadInvites = useCallback(async () => {
    if (!canManage) {
      setLoadingInvites(false);
      return;
    }
    try {
      setInvites(await fetchInvites(pulseId));
      setInvitesError(null);
    } catch (err) {
      setInvitesError((err as Error).message || "Couldn't load pending invitations.");
    } finally {
      setLoadingInvites(false);
    }
  }, [pulseId, canManage]);

  useEffect(() => {
    void reloadInvites();
  }, [reloadInvites]);

  const handleRevoke = async (inviteEmail: string) => {
    try {
      await revokeInvite(pulseId, inviteEmail);
      await reloadInvites();
    } catch {
      await reloadInvites();
    }
  };

  const handleRemoveMember = async (m: PulseMember, e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, { message: `Remove ${m.email}?`, detail: `They'll lose access to “${pulseName}” immediately.`, confirmLabel: "Remove" }))) return;
    // The member's own users/{uid}/myPulses entry isn't ours to delete; their
    // dashboard self-heals it on next load (see DashboardPage's self-heal).
    await removeMember(pulseId, m.uid).catch(() => {});
  };

  const handleSetRole = async (m: PulseMember, next: PulseRole) => {
    if (next === m.role) return;
    // Authoritative role lives in pulseMembers (rules + roleOf read it), so
    // this takes effect for permissions immediately. The member's cached
    // dashboard label reconciles on their next load (DashboardPage self-heal).
    await setMemberRole(pulseId, m.uid, next).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">Collaborators · “{pulseName}”</h2>

        <div className="flex-1 overflow-y-auto">
          {/* Members */}
          <div className="mono mb-2 text-[11px] uppercase tracking-wide text-yasdu-muted">
            Members ({members.length})
          </div>
          <div className="mb-5 flex flex-col gap-1.5">
            {members.map((m) => {
              // The owner can re-permission other, non-owner members. You can't
              // change your own role (guards against the last owner locking
              // themselves out), and other owners aren't demotable here.
              const editable = isOwner && m.uid !== currentUid && m.role !== "owner";
              return (
                <div key={m.uid} className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "#E2DFD9" }}>
                  <span className="flex-1 truncate text-sm text-yasdu-fg" title={m.email}>
                    {m.email}
                    {m.uid === currentUid && <span className="text-yasdu-muted"> (you)</span>}
                  </span>
                  {editable ? (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => void handleSetRole(m, e.target.value as PulseRole)}
                        className="mono rounded border px-1.5 py-1 text-[11px]"
                        style={{ borderColor: "#E2DFD9", color: "#334155" }}
                        title="Change this collaborator's permission"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        onClick={(e) => void handleRemoveMember(m, e)}
                        className="text-xs text-red-600 hover:underline"
                        title="Remove this collaborator"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Pending invitations */}
          {canManage && (
            <>
              <div className="mono mb-2 text-[11px] uppercase tracking-wide text-yasdu-muted">
                Pending invitations{!loadingInvites && ` (${invites.length})`}
              </div>
              <div className="mb-5 flex flex-col gap-1.5">
                {loadingInvites ? (
                  <span className="text-xs text-yasdu-muted">Loading…</span>
                ) : invitesError ? (
                  <span className="text-xs text-red-600">{invitesError}</span>
                ) : invites.length === 0 ? (
                  <span className="text-xs text-yasdu-muted">No pending invitations. Invited people appear here until they sign in with that email.</span>
                ) : (
                  invites.map((inv) => (
                    <div key={inv.email} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2" style={{ borderColor: "#E2DFD9" }}>
                      <span className="flex-1 truncate text-sm text-yasdu-fg" title={inv.email}>{inv.email}</span>
                      <RoleBadge role={inv.role} />
                      <button onClick={() => void handleRevoke(inv.email)} className="text-xs text-red-600 hover:underline" title="Cancel this invitation">
                        Revoke
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Invite by link */}
        {canManage && (
          <div className="mt-1 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "#E2DFD9" }}>
            <div className="mono text-[11px] uppercase tracking-wide text-yasdu-muted">Invite by link</div>
            <InviteLinkPanel pulseId={pulseId} canEdit={canManage} />
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>Close</button>
        </div>
      </div>
    </div>
  );
}
