import { useEffect, useState } from "react";
import type { PulseMember, PulseRole } from "@/types";
import { subscribePulseMembers } from "@/services/firestore/memberships";
import { Spinner } from "@/components/shared/Spinner";
import { useT } from "@/i18n";
import { CollaboratorsDialog } from "./CollaboratorsDialog";

interface InviteDialogProps {
  pulseName: string;
  pulseId: string;
  currentUid: string;
  /** The role from the dashboard's `myPulses` index — a denormalized cache
   * (Collaboration-Spec §1.6), used only until the authoritative roster
   * arrives. */
  cachedRole: PulseRole;
  onClose: () => void;
}

/**
 * The dashboard card menu's "Invite" — now the same dialog the Pulse itself
 * shows, not a reduced version of it.
 *
 * It used to render the invite panel alone, which made the dashboard the one
 * place you could add someone without being able to see who was already there,
 * what was already pending, or that you'd invited them last week. Everything it
 * offered, the full dialog also offers.
 *
 * All this component does is supply what the dashboard lacks and the Pulse page
 * has ready: the roster. `CollaboratorsDialog` stays a pure component over
 * `members`, so the in-Pulse callers keep passing the store's copy rather than
 * opening a second listener on the same collection.
 */
export function InviteDialog({ pulseName, pulseId, currentUid, cachedRole, onClose }: InviteDialogProps) {
  const t = useT();
  const [members, setMembers] = useState<PulseMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMembers(null);
    setError(null);
    return subscribePulseMembers(pulseId, setMembers, setError);
  }, [pulseId]);

  if (error || !members) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl bg-yasdu-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
          <h2 className="font-display mb-4 text-base font-semibold text-yasdu-fg">{t("collab.title", { name: pulseName })}</h2>
          {error ? (
            // Distinct from an empty roster on purpose: the likely cause is that
            // this card outlived the access it stands for, and "no members"
            // would read as a working dialog.
            <p className="text-sm text-red-600">{t("collab.loadMembersError")}</p>
          ) : (
            <Spinner size={22} label={t("common.loading")} className="py-6" />
          )}
          <div className="mt-4 flex justify-end">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg" style={{ background: "#D85A28" }}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // The roster is what the security rules read, so it decides what this dialog
  // may offer. The index entry is a cache that reconciles later (§1.6) — using
  // it to decide who sees the owner controls would show them to someone whose
  // role had since changed.
  const myRole = members.find((m) => m.uid === currentUid)?.role ?? cachedRole;

  return (
    <CollaboratorsDialog
      pulseId={pulseId}
      pulseName={pulseName}
      members={members}
      currentUid={currentUid}
      myRole={myRole}
      onClose={onClose}
    />
  );
}
