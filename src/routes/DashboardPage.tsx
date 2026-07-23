import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { createPulse, subscribeMyPulses, removeMyPulseEntry, updateMyPulseRole, setMyPulseArchived, deletePulse } from "@/services/firestore/pulses";
import { fetchMembership } from "@/services/firestore/memberships";
import { inviteToPulse } from "@/services/firestore/invites";
import { confirmAt } from "@/stores/confirmStore";
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
  const [query, setQuery] = useState("");

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
  const uid = firebaseUser.uid;

  // Three groups: Pulses you own, ones shared with you, and archived ones —
  // each narrowed by the search box (matched on name).
  const q = query.trim().toLowerCase();
  const match = (p: MyPulseIndexEntry) => !q || (p.name || "").toLowerCase().includes(q);
  const active = pulses?.filter((p) => !p.archived) ?? [];
  const owned = active.filter((p) => p.role === "owner" && match(p));
  const shared = active.filter((p) => p.role !== "owner" && match(p));
  const archived = (pulses?.filter((p) => p.archived) ?? []).filter(match);
  const noResults = q !== "" && owned.length === 0 && shared.length === 0 && archived.length === 0;

  const del = async (entry: MyPulseIndexEntry, pt: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(pt, {
      message: `Delete "${entry.name || "Untitled Pulse"}" permanently?`,
      detail: "This erases the Pulse and all its data for everyone — it can't be undone. Archiving instead keeps everything and just hides it from your dashboard.",
      confirmLabel: "Delete forever",
    });
    if (ok) await deletePulse(entry.pulseId, uid);
  };

  const grid = (entries: MyPulseIndexEntry[]) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <PulseCard
          key={entry.pulseId}
          entry={entry}
          onInviteClick={() => setInvitingPulse(entry)}
          onArchive={() => void setMyPulseArchived(uid, entry.pulseId, true)}
          onUnarchive={() => void setMyPulseArchived(uid, entry.pulseId, false)}
          onDelete={(pt) => void del(entry, pt)}
        />
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
        <div className="mb-8 flex items-center gap-3">
          <div className="relative flex-1" style={{ maxWidth: 420 }}>
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#94A3B8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx={11} cy={11} r={7} />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Pulses…"
              className="w-full rounded-lg border text-sm"
              style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", padding: "9px 34px", outline: "none" }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontSize: 15, lineHeight: 1 }}>✕</button>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg flex-shrink-0"
            style={{ background: "#D85A28" }}
          >
            + New Pulse
          </button>
        </div>

        {pulses === null ? (
          <p className="text-sm text-yasdu-muted">Loading…</p>
        ) : noResults ? (
          <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "#E2DFD9" }}>
            <p className="text-sm text-yasdu-muted">No Pulses match “{query.trim()}”.</p>
          </div>
        ) : (
          <>
            {(owned.length > 0 || !q) && (
              <>
                <SectionHeading first count={owned.length}>Your Pulses</SectionHeading>
                {owned.length > 0 ? (
                  grid(owned)
                ) : (
                  <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "#E2DFD9" }}>
                    <p className="text-sm text-yasdu-muted">No Pulses yet. Create one to start laying out your roadmap.</p>
                  </div>
                )}
              </>
            )}

            {shared.length > 0 && (
              <>
                <SectionHeading count={shared.length}>Shared with me</SectionHeading>
                {grid(shared)}
              </>
            )}

            {archived.length > 0 && (
              <>
                <SectionHeading count={archived.length}>Archived</SectionHeading>
                {grid(archived)}
              </>
            )}
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

function SectionHeading({ children, count, first }: { children: React.ReactNode; count: number; first?: boolean }) {
  return (
    <h2 className={`font-display flex items-center gap-2 font-medium text-yasdu-fg ${first ? "mb-4 text-xl" : "mb-4 mt-10 text-lg"}`}>
      {children}
      <span className="mono text-xs text-yasdu-muted">{count}</span>
    </h2>
  );
}
