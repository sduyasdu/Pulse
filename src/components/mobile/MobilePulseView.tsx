import { useState } from "react";
import { Link } from "react-router-dom";
import { usePulseStore } from "@/stores/pulseStore";
import { todayIndex } from "@/domain/dateUtils";
import type { Pulse, PulseRole } from "@/types";
import { DetailsTab } from "@/components/leftPanel/DetailsTab";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { CapacityTab } from "@/components/leftPanel/CapacityTab";
import { CollaboratorsDialog } from "@/components/dashboard/CollaboratorsDialog";
import { MobileTaskList } from "@/components/mobile/MobileTaskList";

interface MobilePulseViewProps {
  pulse: Pulse | null;
  canEdit: boolean;
  myRole: PulseRole;
  uid: string;
}

type Tab = "tasks" | "team" | "capacity";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "tasks", label: "Tasks", icon: "📋" },
  { id: "team", label: "Team", icon: "👥" },
  { id: "capacity", label: "Capacity", icon: "📊" },
];

export function MobilePulseView({ pulse, canEdit, myRole, uid }: MobilePulseViewProps) {
  const features = usePulseStore((s) => s.features);
  const epics = usePulseStore((s) => s.epics);
  const resources = usePulseStore((s) => s.resources);
  const addFeature = usePulseStore((s) => s.addFeature);
  const duplicateFeature = usePulseStore((s) => s.duplicateFeature);

  const [tab, setTab] = useState<Tab>("tasks");
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
        <Link to="/" className="flex items-center justify-center rounded" style={{ width: 32, height: 32, color: "#F0A875", fontSize: 20 }} title="Back to dashboard">‹</Link>
        <div className="flex-1 overflow-hidden">
          <div className="font-display text-white text-sm font-semibold truncate">{pulse?.name?.trim() || "Untitled Pulse"}</div>
          <div className="mono" style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase" }}>{myRole}</div>
        </div>
        {canEdit && (
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-1 rounded px-2.5 py-1.5" style={{ background: "#1B3A63", color: "#F0A875", fontSize: 12, fontWeight: 600 }}>
            ＋ Invite
          </button>
        )}
      </header>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "tasks" && <MobileTaskList features={features} epics={epics} resources={resources} onSelect={setSelectedId} />}
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
            <span style={{ fontSize: 18, filter: tab === t.id ? "none" : "grayscale(1) opacity(0.7)" }}>{t.icon}</span>
            <span className="mono" style={{ fontSize: 10, fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Full-screen task editor */}
      {selected && (
        <div className="fixed inset-0 flex flex-col" style={{ background: "#FFFFFF", zIndex: 50 }}>
          <header className="flex items-center gap-2 px-3 flex-shrink-0 border-b" style={{ height: 52, borderColor: "#E2DFD9", background: "#FFFFFF" }}>
            <button onClick={() => setSelectedId(null)} className="flex items-center gap-1" style={{ color: "#123359", fontSize: 14, fontWeight: 600 }}>
              <span style={{ fontSize: 20 }}>‹</span> Tasks
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
        />
      )}
    </div>
  );
}
