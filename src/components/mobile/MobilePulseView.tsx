import { useMemo, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Link, useNavigate } from "react-router-dom";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { PresenceBar } from "@/components/presence/PresenceBar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { todayIndex } from "@/domain/dateUtils";
import type { Feature, Pulse, PulseRole } from "@/types";
import { DetailsTab } from "@/components/leftPanel/DetailsTab";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { CapacityTab } from "@/components/leftPanel/CapacityTab";
import { ActivityTab } from "@/components/leftPanel/ActivityTab";
import { CollaboratorsDialog } from "@/components/dashboard/CollaboratorsDialog";
import { AllCommentsPanel } from "@/components/comments/AllCommentsPanel";
import { MobileTaskList } from "@/components/mobile/MobileTaskList";
import { MobileBoard } from "@/components/mobile/MobileBoard";
import { HelpDrawer } from "@/components/help/HelpDrawer";
import { useT } from "@/i18n";

interface MobilePulseViewProps {
  pulse: Pulse | null;
  canEdit: boolean;
  /** Per-feature edit gate (Task Lead edits only tasks they lead). */
  canEditFeature: (f: Feature) => boolean;
  myRole: PulseRole;
  uid: string;
}

type Tab = "tasks" | "team" | "capacity" | "activity";

export function MobilePulseView({ pulse, canEdit, canEditFeature, myRole, uid }: MobilePulseViewProps) {
  const t = useT();
  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "tasks", label: t("mobile.tasks"), icon: "checklist" },
    { id: "team", label: t("mobile.team"), icon: "group" },
    { id: "capacity", label: t("mobile.capacity"), icon: "bar_chart" },
    { id: "activity", label: t("mobile.activity"), icon: "timeline" },
  ];
  const features = usePulseStore((s) => s.features);
  const epics = usePulseStore((s) => s.epics);
  const resources = usePulseStore((s) => s.resources);
  const addFeature = usePulseStore((s) => s.addFeature);
  const duplicateFeature = usePulseStore((s) => s.duplicateFeature);

  const navigate = useNavigate();
  const email = useAuthStore((s) => s.firebaseUser?.email ?? "");
  const [tab, setTab] = useState<Tab>("tasks");
  const [taskView, setTaskView] = useState<"list" | "board">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showComments, setShowComments] = useState(false);
  // HL5: mobile has no toolbar, so help lives in the header beside comments.
  const [showHelp, setShowHelp] = useState(false);
  const [myTasksOnly, setMyTasksOnly] = useState(false);

  // "My Pulse": tasks involving a resource linked to my account.
  const myResourceIds = useMemo(() => resources.filter((r) => r.linkedUid === uid).map((r) => r.id), [resources, uid]);
  const myFilter = myTasksOnly && myResourceIds.length > 0 ? myResourceIds : null;

  const selected = features.find((f) => f.id === selectedId) ?? null;

  const handleAdd = async () => {
    const id = await addFeature({ x: todayIndex(), y: 20 });
    if (id) setSelectedId(id);
  };

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "#F7F6F2" }}>
      {/* Header */}
      <header className="flex items-center gap-2 px-3 flex-shrink-0" style={{ height: 52, background: "#123359" }}>
        <Link to="/" className="flex items-center justify-center rounded" style={{ width: 32, height: 32, color: "#EE7240", fontSize: 20 }} title={t("toolbar.backToDashboard")}><Icon name="chevron_left" size={24} /></Link>
        <div className="flex-1 overflow-hidden">
          <div className="font-display text-white text-sm font-semibold truncate">{pulse?.name?.trim() || t("common.untitledPulse")}</div>
          <div className="mono" style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase" }}>{myRole}</div>
        </div>
        <PresenceBar pulseId={pulse?.id} uid={uid} email={email} dark />
        {pulse && (
          <button onClick={() => setShowComments(true)} className="flex items-center justify-center rounded" style={{ width: 32, height: 32, color: "#EE7240" }} title={t("pulse.comments")} aria-label={t("pulse.comments")}>
            <Icon name="forum" size={20} />
          </button>
        )}
        <button onClick={() => setShowHelp(true)} className="flex items-center justify-center rounded" style={{ width: 32, height: 32, color: "#EE7240" }} title={t("help.open")} aria-label={t("help.open")}>
          <Icon name="help" size={20} />
        </button>
        <NotificationsBell pulseId={pulse?.id} uid={uid} onOpenTask={setSelectedId} dark />
        {canEdit && (
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-1 rounded px-2.5 py-1.5" style={{ background: "#1B3A63", color: "#EE7240", fontSize: 12, fontWeight: 600 }}>
            <Icon name="add" size={13} /> {t("toolbar.invite")}
          </button>
        )}
      </header>

      {/* List/Board switch for the Tasks tab (kept out of the scroll area so it
          stays put above whichever view is scrolling). */}
      {tab === "tasks" && (
        <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #E2DFD9", background: "#FFFFFF" }}>
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setTaskView(v)}
              className="text-xs font-semibold rounded-full px-3 py-1 capitalize"
              style={{ background: taskView === v ? "#123359" : "#F4F2EC", color: taskView === v ? "#FFFFFF" : "#64748B" }}
            >
              {v === "list" ? t("mobile.list") : t("mobile.board")}
            </button>
          ))}
          <button
            onClick={() => setMyTasksOnly((v) => !v)}
            disabled={myResourceIds.length === 0}
            className="text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 ml-auto"
            style={{ background: myTasksOnly ? "#EE7240" : "#F4F2EC", color: myTasksOnly ? "#FFFFFF" : "#64748B", opacity: myResourceIds.length === 0 ? 0.45 : 1 }}
            title={myResourceIds.length > 0 ? t("mobile.myBeatOn") : t("mobile.myBeatOff")}
          >
            <Icon name="person" size={13} /> {t("toolbar.myBeat")}
          </button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "tasks" &&
          (taskView === "list" ? (
            <MobileTaskList features={features} epics={epics} resources={resources} onSelect={setSelectedId} myResourceIds={myFilter} />
          ) : (
            <MobileBoard features={features} epics={epics} resources={resources} canEdit={canEdit} onSelect={setSelectedId} myResourceIds={myFilter} />
          ))}
        {tab === "team" && <TeamTab canEdit={canEdit} filterResource={null} setFilterResource={() => {}} />}
        {tab === "capacity" && <CapacityTab canEdit={canEdit} />}
        {tab === "activity" && <ActivityTab />}
      </div>

      {/* Floating add button (Tasks tab, editors only) */}
      {tab === "tasks" && canEdit && (
        <button
          onClick={() => void handleAdd()}
          aria-label={t("toolbar.addTask")}
          className="fixed rounded-full flex items-center justify-center"
          style={{ right: 18, bottom: 74, width: 52, height: 52, background: "#EE7240", color: "#fff", fontSize: 28, lineHeight: 1, boxShadow: "0 6px 16px rgba(238,114,64,0.45)", zIndex: 20 }}
        >
          +
        </button>
      )}

      {/* Bottom tab bar */}
      <nav className="flex flex-shrink-0 border-t" style={{ borderColor: "#E2DFD9", background: "#FFFFFF", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 flex flex-col items-center justify-center gap-0.5" style={{ height: 56, color: tab === t.id ? "#EE7240" : "#94A3B8" }}>
            <Icon name={t.icon} size={20} style={{ opacity: tab === t.id ? 1 : 0.75 }} />
            <span className="mono" style={{ fontSize: 10, fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Full-screen task editor */}
      {selected && (
        <div className="fixed inset-0 flex flex-col" style={{ background: "#FFFFFF", zIndex: 50 }}>
          <header className="flex items-center gap-2 px-3 flex-shrink-0 border-b" style={{ height: 52, borderColor: "#E2DFD9", background: "#FFFFFF" }}>
            <button onClick={() => setSelectedId(null)} className="flex items-center gap-1" style={{ color: "#123359", fontSize: 14, fontWeight: 600 }}>
              <Icon name="chevron_left" size={22} /> {t("mobile.tasks")}
            </button>
          </header>
          <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <DetailsTab
              feature={selected}
              canEdit={canEditFeature(selected)}
              onClose={() => setSelectedId(null)}
              onDuplicate={async () => {
                const newId = await duplicateFeature(selected.id);
                if (newId) setSelectedId(newId);
              }}
            />
          </div>
        </div>
      )}

      {/* Full-screen Pulse conversation — every comment, pulse-level posts,
          @-mentions and filtering (mirrors the desktop comments drawer). */}
      {showComments && pulse && (
        <div className="fixed inset-0 flex flex-col" style={{ background: "#FFFFFF", zIndex: 50 }}>
          <header className="flex items-center gap-2 px-3 flex-shrink-0 border-b" style={{ height: 52, borderColor: "#E2DFD9", background: "#FFFFFF" }}>
            <button onClick={() => setShowComments(false)} className="flex items-center gap-1" style={{ color: "#123359", fontSize: 14, fontWeight: 600 }}>
              <Icon name="chevron_left" size={22} /> {t("mobile.back")}
            </button>
            <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{t("pulse.comments")}</span>
          </header>
          <div className="flex-1" style={{ minHeight: 0 }}>
            <AllCommentsPanel
              pulseId={pulse.id}
              onSelectTask={(id) => { setShowComments(false); setSelectedId(id); }}
              selectedFeatureId={selectedId}
            />
          </div>
        </div>
      )}

      {showHelp && <HelpDrawer onClose={() => setShowHelp(false)} fullScreen />}

      {showInvite && (
        <CollaboratorsDialog
          pulseId={pulse!.id}
          pulseName={pulse?.name?.trim() || t("common.thisPulse")}
          members={usePulseStore.getState().members}
          currentUid={uid}
          myRole={myRole}
          onClose={() => setShowInvite(false)}
          onLeave={() => navigate("/")}
        />
      )}
    </div>
  );
}
