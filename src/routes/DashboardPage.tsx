import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { PulseLockup } from "@/components/shared/Logo";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { createPulse, subscribeMyPulses, removeMyPulseEntry, updateMyPulseRole, updateMyPulseName, setMyPulseHidden, updateMyPulseArchivedAt, setPulseArchived, deletePulse, duplicatePulse, renamePulse, getPulse, type DuplicateMode } from "@/services/firestore/pulses";
import { countPulseMembers, fetchMembership, leavePulse } from "@/services/firestore/memberships";
import { confirmAt } from "@/stores/confirmStore";
import { hiddenOf, type MyPulseIndexEntry } from "@/types";
import { logDirectActivity } from "@/domain/activityRecorder";
import { useT } from "@/i18n";
import { AccountMenu } from "@/components/account/AccountMenu";
import { BillingDialog } from "@/components/account/BillingDialog";
import { PlanBanner } from "@/components/shared/PlanBanner";
import { usePulseQuota } from "@/hooks/usePulseQuota";
import { Spinner } from "@/components/shared/Spinner";
import { HelpDrawer } from "@/components/help/HelpDrawer";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CreatePulseDialog } from "@/components/dashboard/CreatePulseDialog";
import { RenamePulseDialog } from "@/components/dashboard/RenamePulseDialog";
import { DuplicatePulseDialog } from "@/components/dashboard/DuplicatePulseDialog";
import { InviteDialog } from "@/components/dashboard/InviteDialog";
import { PulseCard } from "@/components/dashboard/PulseCard";
import { PulseQuotaBanner } from "@/components/dashboard/PulseQuotaBanner";

export function DashboardPage() {
  const { firebaseUser, userDoc } = useAuthStore();
  const t = useT();
  const navigate = useNavigate();
  const [pulses, setPulses] = useState<MyPulseIndexEntry[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const isMobile = useIsMobile();
  const [invitingPulse, setInvitingPulse] = useState<MyPulseIndexEntry | null>(null);
  const [renamingPulse, setRenamingPulse] = useState<MyPulseIndexEntry | null>(null);
  const [duplicatingPulse, setDuplicatingPulse] = useState<MyPulseIndexEntry | null>(null);
  const [query, setQuery] = useState("");
  // Soft gate on the plan's Pulse cap. UX only — firestore.rules is the
  // boundary; without this, hitting the cap surfaces as a bare permissions
  // error with no mention of plans (Plans-Spec §5).
  const quota = usePulseQuota();
  // Its own mount rather than reaching into AccountMenu's: the upsell has to be
  // actionable from here, and only one dialog is ever open at a time.
  const [billingOpen, setBillingOpen] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    return subscribeMyPulses(firebaseUser.uid, setPulses);
  }, [firebaseUser]);

  // Self-heal stale dashboard entries against the authoritative source docs,
  // since a user's users/{uid}/myPulses index is theirs alone and no one else
  // can fix it:
  //   - membership gone (removed / Pulse deleted) -> drop the dangling entry;
  //   - role changed by an owner -> sync the cached role label + section;
  //   - Pulse renamed by someone else -> sync the cached (denormalized) name;
  //   - pre-split `archived` (per-user) -> migrate to `hidden`, NEVER to the new
  //     shared archive, which would surprise the other members of every Pulse
  //     anyone had tidied away (Hide-and-Archive-Spec §8);
  //   - shared archive state -> refresh the denormalized `archivedAt` copy that
  //     drives the card's Archived chip. Free: the Pulse doc is already fetched
  //     here for the name, and cards have no live listener by design.
  // Only acts on a definitive read (getDoc succeeded); a transient/network
  // error leaves the entry for the next load to retry. Updates only when a
  // value actually changed, so it converges (no write/re-run loop).
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
            continue;
          }
          if (membership.role !== p.role) {
            await updateMyPulseRole(firebaseUser.uid, p.pulseId, membership.role);
          }
          // One-pass rename of the pre-split per-user flag. Runs once per entry
          // (setMyPulseHidden clears `archived`), so it can't loop.
          if (p.archived !== undefined && p.hidden === undefined) {
            await setMyPulseHidden(firebaseUser.uid, p.pulseId, p.archived);
          }
          const pulse = await getPulse(p.pulseId);
          if (cancelled) return;
          if (pulse && (pulse.name ?? "") !== (p.name ?? "")) {
            await updateMyPulseName(firebaseUser.uid, p.pulseId, pulse.name ?? "");
          }
          if (pulse && (pulse.archivedAt ?? null) !== (p.archivedAt ?? null)) {
            await updateMyPulseArchivedAt(firebaseUser.uid, p.pulseId, pulse.archivedAt ?? null);
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

  // Four groups, each narrowed by the search box (matched on name). Placement
  // rules (Hide-and-Archive-Spec §5.3): `hidden` wins over archived — hiding is
  // the user's explicit "off my dashboard", and a Hidden Pulse resurfacing in
  // the Archived section would defeat it. Otherwise archived (shared, everyone
  // sees it) outranks the owned/shared split.
  const q = query.trim().toLowerCase();
  const match = (p: MyPulseIndexEntry) => !q || (p.name || "").toLowerCase().includes(q);
  const visible = pulses?.filter((p) => !hiddenOf(p)) ?? [];
  const live = visible.filter((p) => (p.archivedAt ?? null) === null);
  const owned = live.filter((p) => p.role === "owner" && match(p));
  const shared = live.filter((p) => p.role !== "owner" && match(p));
  const archived = visible.filter((p) => (p.archivedAt ?? null) !== null).filter(match);
  const hidden = (pulses?.filter(hiddenOf) ?? []).filter(match);
  const noResults = q !== "" && owned.length === 0 && shared.length === 0 && archived.length === 0 && hidden.length === 0;

  const del = async (entry: MyPulseIndexEntry, pt: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(pt, {
      message: t("dashboard.deleteMessage", { name: entry.name || t("common.untitledPulse") }),
      detail: t("dashboard.deleteDetail"),
      confirmLabel: t("dashboard.deleteConfirm"),
    });
    if (ok) await deletePulse(entry.pulseId, uid);
  };

  // Owner-only, shared, and read-only for everyone — so unlike hiding, it asks
  // first and names the consequence (Hide-and-Archive-Spec §5.4).
  const archive = async (entry: MyPulseIndexEntry, pt: { clientX: number; clientY: number }) => {
    const n = await countPulseMembers(entry.pulseId).catch(() => 0);
    const ok = await confirmAt(pt, {
      message: t("dashboard.archiveMessage", { name: entry.name || t("common.untitledPulse") }),
      detail: t("dashboard.archiveDetail", { n }),
      confirmLabel: t("dashboard.archiveConfirm"),
    });
    if (!ok) return;
    await setPulseArchived(entry.pulseId, uid, true);
    await updateMyPulseArchivedAt(uid, entry.pulseId, Date.now());
    logDirectActivity(entry.pulseId, {
      entityKind: "pulse", entityId: entry.pulseId, entityName: entry.name || "", verb: "archive",
      summary: "archived the Pulse",
    });
  };

  // Unarchiving restores the status quo, so it doesn't ask.
  const unarchive = async (entry: MyPulseIndexEntry) => {
    await setPulseArchived(entry.pulseId, uid, false);
    await updateMyPulseArchivedAt(uid, entry.pulseId, null);
    logDirectActivity(entry.pulseId, {
      entityKind: "pulse", entityId: entry.pulseId, entityName: entry.name || "", verb: "unarchive",
      summary: "unarchived the Pulse",
    });
  };

  const leave = async (entry: MyPulseIndexEntry, pt: { clientX: number; clientY: number }) => {
    const ok = await confirmAt(pt, {
      message: t("dashboard.leaveMessage", { name: entry.name || t("common.untitledPulse") }),
      detail: t("dashboard.leaveDetail"),
      confirmLabel: t("dashboard.leaveConfirm"),
    });
    if (ok) await leavePulse(entry.pulseId, uid);
  };

  const grid = (entries: MyPulseIndexEntry[]) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <PulseCard
          key={entry.pulseId}
          entry={entry}
          onRenameClick={() => setRenamingPulse(entry)}
          onInviteClick={() => setInvitingPulse(entry)}
          onDuplicateClick={() => setDuplicatingPulse(entry)}
          onHide={() => void setMyPulseHidden(uid, entry.pulseId, true)}
          onUnhide={() => void setMyPulseHidden(uid, entry.pulseId, false)}
          onArchive={(pt) => void archive(entry, pt)}
          onUnarchive={() => void unarchive(entry)}
          onDelete={(pt) => void del(entry, pt)}
          onLeave={(pt) => void leave(entry, pt)}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-yasdu-bg">
      <header className="flex items-center gap-3 border-b px-6 py-3" style={{ borderColor: "#E2DFD9", background: "#123359" }}>
        <PulseLockup variant="dark" size={16} />
        <div className="flex-1" />
        {/* Same help as inside a Pulse — arguably more useful here, where a
            newcomer hasn't opened one yet. Full-screen on mobile, a pinned
            drawer on desktop (the dashboard scrolls, so it can't be absolute). */}
        <button
          onClick={() => setHelpOpen(true)}
          title={t("help.open")}
          aria-label={t("help.open")}
          aria-expanded={helpOpen}
          className="flex items-center justify-center rounded"
          style={{ width: 30, height: 30, color: "#EE7240" }}
        >
          <Icon name="help" size={18} />
        </button>
        <AccountMenu />
      </header>

      {/* Delinquency notice (Plans-Spec §5.1). Renders nothing unless the
          signed-in user owns an org whose payment has failed. */}
      <PlanBanner />

      {helpOpen && <HelpDrawer onClose={() => setHelpOpen(false)} placement={isMobile ? "fullScreen" : "fixed"} />}

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* On mobile this stacks: a full-width search box on top, then the
            New Pulse button below it aligned right. On sm+ it's the usual one
            row (search left, button right). */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative order-1 w-full sm:flex-1 sm:max-w-[420px]">
            <Icon name="search" size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", pointerEvents: "none" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dashboard.searchPlaceholder")}
              className="w-full rounded-lg border text-sm"
              style={{ borderColor: "#E2DFD9", background: "#FFFFFF", color: "#1F2330", padding: "11px 36px", outline: "none" }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label={t("dashboard.clearSearch")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontSize: 15, lineHeight: 1 }}><Icon name="close" size={15} /></button>
            )}
          </div>
          {/* Never disabled. `pulseCount` is maintained asynchronously (PL5),
              so a stale-high counter would block a create the server would have
              allowed — the rules are the authority, and they answer in one
              round-trip. The banner and the dialog explain the limit instead. */}
          <button
            onClick={() => setCreating(true)}
            className="order-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-yasdu-primary-fg flex-shrink-0 self-end sm:ml-auto sm:self-auto"
            style={{ background: "#D85A28" }}
          >
            {t("dashboard.newPulse")}
          </button>
        </div>

        <PulseQuotaBanner quota={quota} workspaceId={userDoc?.personalWorkspaceId ?? null} onUpgrade={() => setBillingOpen(true)} />

        {pulses === null ? (
          <Spinner size={22} label={t("common.loading")} className="py-10" />
        ) : noResults ? (
          <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "#E2DFD9" }}>
            <p className="text-sm text-yasdu-muted">{t("dashboard.noMatch", { query: query.trim() })}</p>
          </div>
        ) : (
          <>
            {(owned.length > 0 || !q) && (
              <>
                <SectionHeading first count={owned.length}>{t("dashboard.yourPulses")}</SectionHeading>
                {owned.length > 0 ? (
                  grid(owned)
                ) : (
                  <div className="rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "#E2DFD9" }}>
                    <p className="text-sm text-yasdu-muted">{t("dashboard.noPulsesYet")}</p>
                  </div>
                )}
              </>
            )}

            {shared.length > 0 && (
              <>
                <SectionHeading count={shared.length}>{t("dashboard.sharedWithMe")}</SectionHeading>
                {grid(shared)}
              </>
            )}

            {archived.length > 0 && (
              <>
                <SectionHeading count={archived.length}>{t("dashboard.archived")}</SectionHeading>
                {grid(archived)}
              </>
            )}

            {hidden.length > 0 && (
              <>
                <SectionHeading count={hidden.length}>{t("dashboard.hidden")}</SectionHeading>
                {grid(hidden)}
              </>
            )}
          </>
        )}
      </main>

      {billingOpen && <BillingDialog onClose={() => setBillingOpen(false)} />}

      {creating && (
        <CreatePulseDialog
          limit={quota.limit}
          atLimit={quota.atLimit}
          used={quota.used}
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const workspaceId = userDoc?.personalWorkspaceId;
            if (!workspaceId) {
              throw new Error(t("dashboard.workspaceNotReady"));
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
          pulseId={invitingPulse.pulseId}
          canEdit={invitingPulse.role !== "viewer"}
          onClose={() => setInvitingPulse(null)}
        />
      )}

      {renamingPulse && (
        <RenamePulseDialog
          currentName={renamingPulse.name}
          onClose={() => setRenamingPulse(null)}
          onRename={async (name: string) => {
            await renamePulse(renamingPulse.pulseId, name);
            // The dashboard card name is denormalized on the user's own index
            // entry, so sync it too (the pulse doc drives it everywhere else).
            await updateMyPulseName(uid, renamingPulse.pulseId, name);
            setRenamingPulse(null);
          }}
        />
      )}

      {duplicatingPulse && (
        <DuplicatePulseDialog
          pulseName={duplicatingPulse.name}
          onClose={() => setDuplicatingPulse(null)}
          onDuplicate={async (name: string, mode: DuplicateMode) => {
            const workspaceId = userDoc?.personalWorkspaceId;
            if (!workspaceId) throw new Error(t("dashboard.workspaceNotReady"));
            const newId = await duplicatePulse(firebaseUser.uid, workspaceId, duplicatingPulse.pulseId, name, mode);
            setDuplicatingPulse(null);
            navigate(`/p/${newId}`);
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
