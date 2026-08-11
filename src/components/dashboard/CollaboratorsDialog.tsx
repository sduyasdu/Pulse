import { useCallback, useEffect, useState } from "react";
import type { Invite, PulseMember, PulseRole } from "@/types";
import { fetchInvites, revokeInvite } from "@/services/firestore/invites";
import { removeMember, setMemberRole, leavePulse } from "@/services/firestore/memberships";
import { deletePulse, setPulseArchived, updateMyPulseArchivedAt } from "@/services/firestore/pulses";
import { confirmAt } from "@/stores/confirmStore";
import { roleMeta, ASSIGNABLE_ROLES } from "@/domain/permissions";
import { logDirectActivity } from "@/domain/activityRecorder";
import { useT } from "@/i18n";
import { InviteLinkPanel } from "./InviteLinkPanel";

interface CollaboratorsDialogProps {
  pulseId: string;
  pulseName: string;
  members: PulseMember[];
  currentUid: string;
  myRole: PulseRole;
  onClose: () => void;
  /** Called after the current user leaves the Pulse (e.g. navigate away). */
  onLeave?: () => void;
}

function RoleBadge({ role }: { role: PulseRole }) {
  const m = roleMeta(role);
  return (
    <span className="mono rounded px-1.5 py-0.5" style={{ fontSize: 10, background: m.badgeBg, color: m.badgeFg, textTransform: "uppercase" }}>
      {m.label}
    </span>
  );
}

export function CollaboratorsDialog({ pulseId, pulseName, members, currentUid, myRole, onClose, onLeave }: CollaboratorsDialogProps) {
  const t = useT();
  const canManage = myRole === "owner" || myRole === "editor"; // may invite / revoke
  const isOwner = myRole === "owner"; // may remove members
  // The sole owner can't leave (would orphan the Pulse) — they transfer/grant
  // ownership first, or delete the Pulse.
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const canLeave = myRole !== "owner" || ownerCount > 1;

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
      setInvitesError((err as Error).message || t("collab.loadInvitesError"));
    } finally {
      setLoadingInvites(false);
    }
  }, [pulseId, canManage, t]);

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
    if (!(await confirmAt(e, { message: t("collab.removeMemberMsg", { email: m.email }), detail: t("collab.removeMemberDetail", { name: pulseName }), confirmLabel: t("collab.remove") }))) return;
    // The member's own users/{uid}/myPulses entry isn't ours to delete; their
    // dashboard self-heals it on next load (see DashboardPage's self-heal).
    await removeMember(pulseId, m.uid).catch(() => {});
    logDirectActivity(pulseId, { entityKind: "member", entityId: m.uid, entityName: m.email, verb: "remove", summary: `removed ${m.email}` });
  };

  const handleMakeOwner = async (m: PulseMember, e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, { message: t("collab.makeOwnerMsg", { email: m.email }), detail: t("collab.makeOwnerDetail"), confirmLabel: t("collab.makeOwner") }))) return;
    await setMemberRole(pulseId, m.uid, "owner").catch(() => {});
    logDirectActivity(pulseId, {
      entityKind: "member", entityId: m.uid, entityName: m.email, verb: "role-change",
      summary: `made ${m.email} an owner`,
      deltas: [{ key: "role", before: roleMeta(m.role).label, after: roleMeta("owner").label }],
    });
  };

  const handleLeave = async (e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, { message: t("collab.leaveMsg", { name: pulseName }), detail: t("dashboard.leaveDetail"), confirmLabel: t("dashboard.leaveConfirm") }))) return;
    logDirectActivity(pulseId, { entityKind: "member", entityId: currentUid, entityName: members.find((m) => m.uid === currentUid)?.email ?? "You", verb: "leave", summary: `left the Pulse` });
    await leavePulse(pulseId, currentUid).catch(() => {});
    (onLeave ?? onClose)();
  };

  // The sole owner's three exits (§5.7). Archive keeps everything and stops the
  // changes; delete removes it for everyone; stepping down is the route to
  // actually leaving, and needs a second owner first.
  const handleArchive = async (e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, {
      message: t("dashboard.archiveMessage", { name: pulseName }),
      detail: t("dashboard.archiveDetail", { n: members.length }),
      confirmLabel: t("dashboard.archiveConfirm"),
    }))) return;
    await setPulseArchived(pulseId, currentUid, true).catch(() => {});
    await updateMyPulseArchivedAt(currentUid, pulseId, Date.now());
    logDirectActivity(pulseId, {
      entityKind: "pulse", entityId: pulseId, entityName: pulseName, verb: "archive",
      summary: "archived the Pulse",
    });
    onClose();
  };

  const handleDelete = async (e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, {
      message: t("dashboard.deleteMessage", { name: pulseName }),
      detail: t("dashboard.deleteDetail"),
      confirmLabel: t("dashboard.deleteConfirm"),
    }))) return;
    await deletePulse(pulseId, currentUid).catch(() => {});
    (onLeave ?? onClose)();
  };

  // Step down to Editor. Only offered with another owner present, so it can't
  // be used to strand the Pulse.
  const handleStepDown = async (e: { clientX: number; clientY: number }) => {
    if (!(await confirmAt(e, {
      message: t("collab.demoteSelfMsg"),
      detail: t("collab.demoteSelfDetail"),
      confirmLabel: t("collab.demoteSelf"),
    }))) return;
    await setMemberRole(pulseId, currentUid, "editor").catch(() => {});
    logDirectActivity(pulseId, {
      entityKind: "member", entityId: currentUid, entityName: members.find((m) => m.uid === currentUid)?.email ?? "You", verb: "role-change",
      summary: "stepped down to Editor",
      deltas: [{ key: "role", before: roleMeta("owner").label, after: roleMeta("editor").label }],
    });
  };

  const handleSetRole = async (m: PulseMember, next: PulseRole) => {
    if (next === m.role) return;
    // Authoritative role lives in pulseMembers (rules + roleOf read it), so
    // this takes effect for permissions immediately. The member's cached
    // dashboard label reconciles on their next load (DashboardPage self-heal).
    await setMemberRole(pulseId, m.uid, next).catch(() => {});
    logDirectActivity(pulseId, {
      entityKind: "member", entityId: m.uid, entityName: m.email, verb: "role-change",
      summary: `changed ${m.email}'s role to ${roleMeta(next).label}`,
      deltas: [{ key: "role", before: roleMeta(m.role).label, after: roleMeta(next).label }],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">{t("collab.title", { name: pulseName })}</h2>

        <div className="flex-1 overflow-y-auto">
          {/* Members */}
          <div className="mono mb-2 text-[11px] uppercase tracking-wide text-yasdu-muted">
            {t("collab.members", { count: members.length })}
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
                    {m.uid === currentUid && <span className="text-yasdu-muted">{t("collab.you")}</span>}
                  </span>
                  {editable ? (
                    <>
                      <select
                        value={m.role === "fullViewer" ? "viewer" : m.role}
                        onChange={(e) => void handleSetRole(m, e.target.value as PulseRole)}
                        className="mono rounded border px-1.5 py-1 text-[11px]"
                        style={{ borderColor: "#E2DFD9", color: "#334155" }}
                        title={t("collab.changeRole")}
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r.value} value={r.value} title={r.hint}>{r.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => void handleMakeOwner(m, e)}
                        className="text-xs hover:underline"
                        style={{ color: "#0F766E" }}
                        title={t("collab.makeOwnerTitle")}
                      >
                        {t("collab.makeOwner")}
                      </button>
                      <button
                        onClick={(e) => void handleRemoveMember(m, e)}
                        className="text-xs text-red-600 hover:underline"
                        title={t("collab.removeTitle")}
                      >
                        {t("collab.remove")}
                      </button>
                    </>
                  ) : (
                    <>
                      <RoleBadge role={m.role} />
                      {/* Self-demote: the one way an owner in a multi-owner Pulse
                          gets to a state where they may leave, since no owner may
                          self-delete (Hide-and-Archive-Spec §5.7). Hidden for a
                          sole owner — that's the case the invariant protects. */}
                      {isOwner && m.uid === currentUid && ownerCount > 1 && (
                        <button
                          onClick={(e) => void handleStepDown(e)}
                          className="text-xs hover:underline"
                          style={{ color: "#64748B" }}
                          title={t("collab.demoteSelfTitle")}
                        >
                          {t("collab.demoteSelf")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pending invitations */}
          {canManage && (
            <>
              <div className="mono mb-2 text-[11px] uppercase tracking-wide text-yasdu-muted">
                {t("collab.pending")}{!loadingInvites && ` (${invites.length})`}
              </div>
              <div className="mb-5 flex flex-col gap-1.5">
                {loadingInvites ? (
                  <span className="text-xs text-yasdu-muted">{t("common.loading")}</span>
                ) : invitesError ? (
                  <span className="text-xs text-red-600">{invitesError}</span>
                ) : invites.length === 0 ? (
                  <span className="text-xs text-yasdu-muted">{t("collab.noPending")}</span>
                ) : (
                  invites.map((inv) => (
                    <div key={inv.email} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2" style={{ borderColor: "#E2DFD9" }}>
                      <span className="flex-1 truncate text-sm text-yasdu-fg" title={inv.email}>{inv.email}</span>
                      <RoleBadge role={inv.role} />
                      <button onClick={() => void handleRevoke(inv.email)} className="text-xs text-red-600 hover:underline" title={t("collab.cancelInvite")}>
                        {t("common.revoke")}
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
            <div className="mono text-[11px] uppercase tracking-wide text-yasdu-muted">{t("collab.inviteByLink")}</div>
            <InviteLinkPanel pulseId={pulseId} canEdit={canManage} />
          </div>
        )}

        {/* A sole owner may never leave — a Pulse must always keep an owner, or
            archive/unarchive/delete/promote all become impossible and an
            archived one is stranded forever (HA10). So the dead end offers the
            three real routes instead of just naming the problem. Archive comes
            first: it's the non-destructive answer to "I'm done with this", which
            is what someone reaching for Leave usually means. */}
        {!canLeave && (
          <div className="mt-4 rounded-lg border px-3 py-2.5" style={{ borderColor: "#E2DFD9", background: "#FAF9F5" }}>
            <div className="text-xs font-semibold text-yasdu-fg">{t("collab.soleOwner")}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-yasdu-muted">
              <button onClick={(e) => void handleArchive(e)} className="hover:underline" style={{ color: "#1B3A63", fontWeight: 600 }}>
                {t("collab.soleOwnerArchive")}
              </button>
              <button onClick={(e) => void handleDelete(e)} className="text-red-600 hover:underline" style={{ fontWeight: 600 }}>
                {t("collab.soleOwnerDelete")}
              </button>
              <span>{t("collab.soleOwnerTransfer")}</span>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          {canLeave ? (
            <button onClick={(e) => void handleLeave(e)} className="text-sm text-red-600 hover:underline" title={t("collab.leaveTitle")}>{t("collab.leavePulse")}</button>
          ) : (
            <span />
          )}
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
