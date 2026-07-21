import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { createPulse, subscribeMyPulses, removeMyPulseEntry, updateMyPulseRole } from "@/services/firestore/pulses";
import { fetchMembership } from "@/services/firestore/memberships";
import { inviteToPulse } from "@/services/firestore/invites";
import type { MyPulseIndexEntry, PulseRole } from "@/types";
import { CreatePulseDialog } from "@/components/dashboard/CreatePulseDialog";
import { InviteDialog } from "@/components/dashboard/InviteDialog";
import { PulseCard } from "@/components/dashboard/PulseCard";

export function DashboardPage() {
  const { firebaseUser, userDoc, signOutUser } = useAuthStore();
  const navigate = useNavigate();
  const [pulses, setPulses] = useState<MyPulseIndexEntry[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [invitingPulse, setInvitingPulse] = useState<MyPulseIndexEntry | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    return subscribeMyPulses(firebaseUser.uid, setPulses);
  }, [firebaseUser]);

  // Self-heal stale dashboard entries against the authoritative pulseMembers
  // doc (always self-readable), since a user's users/{uid}/myPulses index is
  // theirs alone and no one else can fix it:
  //   - membership gone (removed / Pulse deleted) -> drop the dangling entry;
  //   - role changed by an owner -> sync the cached role label + section.
  // Only acts on a definitive read (getDoc succeeded); a transient/network
  // error leaves the entry for the next load to retry.
  useEffect(() => {
    if (!firebaseUser || !pulses || pulses.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const p of pulses) {
        try {
          const membership = await fetchMembership(p.pulseId, firebaseUser.uid);
          if (cancelled) return;
          if (membership === null) {
            await removeMyPulseEntry(firebaseUser.uid, p.pulseId);
          } else if (membership.role !== p.role) {
            await updateMyPulseRole(firebaseUser.uid, p.pulseId, membership.role);
          }
        } catch {
          // transient — skip; a later load retries
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, pulses]);

  if (!firebaseUser) return null;

  // "Your Pulses" are the ones you own; everything you were invited to
  // (editor/viewer) lives under "Shared with you".
  const owned = pulses?.filter((p) => p.role === "owner") ?? [];
  const shared = pulses?.filter((p) => p.role !== "owner") ?? [];

  const grid = (entries: MyPulseIndexEntry[]) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <PulseCard key={entry.pulseId} entry={entry} onInviteClick={() => setInvitingPulse(entry)} />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-yasdu-bg">
      <header className="flex items-center gap-3 border-b px-6 py-3" style={{ borderColor: "#E2DFD9", background: "#123359" }}>
        <span className="font-display text-base font-semibold text-white">Pulse</span>
        <span className="mono text-[9px] uppercase tracking-wide text-yasdu-orange-soft">by Yasdu</span>
        <div className="flex-1" />
        <span className="mono text-xs text-yasdu-orange-soft">{firebaseUser.email}</span>
        <button onClick={() => void signOutUser()} className="mono text-xs text-white/70 hover:text-white">
          sign out
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-xl font-medium text-yasdu-fg">Your Pulses</h1>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg"
            style={{ background: "#D85A28" }}
          >
            + New Pulse
          </button>
        </div>

        {pulses === null ? (
          <p className="text-sm text-yasdu-muted">Loading…</p>
        ) : owned.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "#E2DFD9" }}>
            <p className="text-sm text-yasdu-muted">
              No Pulses yet. Create one to start laying out your roadmap.
            </p>
          </div>
        ) : (
          grid(owned)
        )}

        {shared.length > 0 && (
          <>
            <h2 className="font-display mb-4 mt-10 text-lg font-medium text-yasdu-fg">Shared with you</h2>
            {grid(shared)}
          </>
        )}
      </main>

      {creating && (
        <CreatePulseDialog
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const workspaceId = userDoc?.personalWorkspaceId;
            if (!workspaceId) {
              throw new Error("Still setting up your workspace — wait a moment and try again.");
            }
            const pulseId = await createPulse(firebaseUser.uid, workspaceId, name);
            setCreating(false);
            navigate(`/p/${pulseId}`);
          }}
        />
      )}

      {invitingPulse && (
        <InviteDialog
          pulseName={invitingPulse.name}
          onClose={() => setInvitingPulse(null)}
          onInvite={async (email, role: PulseRole) => {
            await inviteToPulse(invitingPulse.pulseId, email, role, firebaseUser.uid);
          }}
        />
      )}
    </div>
  );
}
