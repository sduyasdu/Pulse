import { useState } from "react";
import { Icon } from "@/components/shared/Icon";
import { Link, useNavigate } from "react-router-dom";
import { usePulseStore } from "@/stores/pulseStore";
import { useAuthStore } from "@/stores/authStore";
import { PresenceBar } from "@/components/presence/PresenceBar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { todayIndex } from "@/domain/dateUtils";
import type { Pulse, PulseRole } from "@/types";
import { DetailsTab } from "@/components/leftPanel/DetailsTab";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { CapacityTab } from "@/components/leftPanel/CapacityTab";
import { CollaboratorsDialog } from "@/components/dashboard/CollaboratorsDialog";
import { MobileTaskList } from "@/components/mobile/MobileTaskList";
import { MobileBoard } from "@/components/mobile/MobileBoard";

interface MobilePulseViewProps {
  pulse: Pulse | null;
  canEdit: boolean;
  myRole: PulseRole;
  uid: string;
}

type Tab = "tasks" | "team" | "capacity";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "tasks", label: "Tasks", icon: "checklist" },
  { id: "team", label: "Team", icon: "group" },
  { id: "capacity", label: "Capacity", icon: "bar_chart" },
];

export function MobilePulseView({ pulse, canEdit, myRole, uid }: MobilePulseViewProps) {
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

  const selected = features.find((f) => f.id === selectedId) ?? null;

  const handleAdd = async () => {
    const id = await addFeature({ x: todayIndex(), y: 20 });
    if (id) setSelectedId(id);
  };

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "#F7F6F2" }}>
      {/* Header */}
      <header className="flex items-center gap-2 px-3 flex-shrink-0" style={{ height: 52, background: "#123359" }}>
        <Link to="/" className="flex items-center justify-center rounded" style={{ width: 32, height: 32, color: "#F0A875", fontSize: 20 }} title="Back to dashboard"><Icon name="chevron_left" size={24} /></Link>
        <div className="flex-1 overflow-hidden">
          <div className="font-display text-white text-sm font-semibold truncate">{pulse?.name?.trim() || "Untitled Pulse"}</div>
          <div className="mono" style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase" }}>{myRole}</div>
        </div>
        <PresenceBar pulseId={pulse?.id} uid={uid} email={email} dark />
        <NotificationsBell pulseId={pulse?.id} uid={uid} onOpenTask={setSelectedId} dark />
        {canEdit && (
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-1 rounded px-2.5 py-1.5" style={{ background: "#1B3A63", color: "#F0A875", fontSize: 12, fontWeight: 600 }}>
            <Icon name="add" size={13} /> Invite
          </button>
        )}
      </header>

      {/* List/Board switch for the Tasks tab (kept out of the scroll area so it
          stays put above whichever view is scrolling). */}
      {tab === "tasks" && (
        <div className="flex gap-1 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid #E2DFD9", background: "#FFFFFF" }}>
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setTaskView(v)}
              className="text-xs font-semibold rounded-full px-3 py-1 capitalize"
              style={{ background: taskView === v ? "#123359" : "#F4F2EC", color: taskView === v ? "#FFFFFF" : "#64748B" }}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "tasks" &&
          (taskView === "list" ? (
            <MobileTaskList features={features} epics={epics} resources={resources} onSelect={setSelectedId} />
          ) : (
            <MobileBoard features={features} epics={epics} resources={resources} canEdit={canEdit} onSelect={setSelectedId} />
          ))}
        {tab === "team" && <TeamTab canEdit={canEdit} filterResource={null} setFilterResource={() => {}} />}
        {tab === "capacity" && <CapacityTab canEdit={canEdit} />}
      </div>

      {/* Floating add button (Tasks tab, editors only) */}
      {tab === "tasks" && canEdit && (
        <button
          onClick={() => void handleAdd()}
          aria-label="Add task"
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
              <Icon name="chevron_left" size={22} /> Tasks
            </button>
          </header>
          <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <DetailsTab
              feature={selected}
              canEdit={canEdit}
              onClose={() => setSelectedId(null)}
              onDuplicate={async () => {
                const newId = await duplicateFeature(selected.id);
                if (newId) setSelectedId(newId);
              }}
            />
          </div>
        </div>
      )}

      {showInvite && (
        <CollaboratorsDialog
          pulseId={pulse!.id}
          pulseName={pulse?.name?.trim() || "this Pulse"}
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
