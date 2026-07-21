import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { useUndoStore } from "@/stores/undoStore";
import { removeMyPulseEntry } from "@/services/firestore/pulses";
import { CollaboratorsDialog } from "@/components/dashboard/CollaboratorsDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobilePulseView } from "@/components/mobile/MobilePulseView";
import { compactLayout } from "@/domain/layout";
import { BASE_DAY_WIDTH, DENSITY_DAY_PX, type Density } from "@/domain/constants";
import { isWeekend as isWeekendDay, todayIndex } from "@/domain/dateUtils";
import type { FeatureStatus, PulseRole } from "@/types";
import { Toolbar } from "@/components/canvas/Toolbar";
import { CanvasView, TODAY_LEFT_MARGIN_PX, type CanvasViewHandle } from "@/components/canvas/CanvasView";
import { AssignmentPanel } from "@/components/assignmentPanel/AssignmentPanel";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { CapacityTab } from "@/components/leftPanel/CapacityTab";
import { DetailsTab } from "@/components/leftPanel/DetailsTab";

const ROLE_LABEL: Record<PulseRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer · read-only" };

type RightTab = "details" | "team" | "capacity";

export function PulsePage() {
  const { pulseId } = useParams<{ pulseId: string }>();
  const navigate = useNavigate();
  const firebaseUser = useAuthStore((s) => s.firebaseUser);

  const load = usePulseStore((s) => s.load);
  const pulse = usePulseStore((s) => s.pulse);
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const members = usePulseStore((s) => s.members);
  const loading = usePulseStore((s) => s.loading);
  const notFound = usePulseStore((s) => s.notFound);
  const roleOf = usePulseStore((s) => s.roleOf);
  const renamePulse = usePulseStore((s) => s.renamePulse);
  const setGraphConfig = usePulseStore((s) => s.setGraphConfig);
  const patchEpic = usePulseStore((s) => s.patchEpic);
  const patchFeature = usePulseStore((s) => s.patchFeature);
  const duplicateFeature = usePulseStore((s) => s.duplicateFeature);
  const isMobile = useIsMobile();

  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const resetUndo = useUndoStore((s) => s.reset);
  const clearToast = useUndoStore((s) => s.clearToast);
  const canUndo = useUndoStore((s) => s.past.length > 0);
  const canRedo = useUndoStore((s) => s.future.length > 0);
  const toast = useUndoStore((s) => s.toast);

  useEffect(() => {
    if (!pulseId) return;
    return load(pulseId);
  }, [pulseId, load]);

  // Undo history is per-Pulse and in-memory (D2): drop it whenever we open a
  // different Pulse or leave this page.
  useEffect(() => {
    resetUndo(null);
    return () => resetUndo(null);
  }, [pulseId, resetUndo]);

  // Auto-dismiss the undo/redo toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => clearToast(), 2200);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  const uid = firebaseUser?.uid;
  const myRole = uid ? roleOf(uid) : null;
  const canEdit = myRole === "owner" || myRole === "editor";

  // Keyboard: ⌘/Ctrl+Z = undo, ⇧⌘/Ctrl+Z (or Ctrl+Y) = redo. Ignored while a
  // text field owns the caret, and only for editors.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, undo, redo]);

  // Self-heal: this Pulse was deleted, or our membership was revoked —
  // bounce back to the dashboard and drop the stale index entry.
  useEffect(() => {
    if (!loading && uid && pulseId && (notFound || myRole === null)) {
      void removeMyPulseEntry(uid, pulseId);
      navigate("/", { replace: true });
    }
  }, [loading, uid, pulseId, notFound, myRole, navigate]);

  useEffect(() => {
    document.title = pulse?.name?.trim() ? `${pulse.name.trim()} — Pulse` : "Pulse — Visual Project Planning";
  }, [pulse?.name]);

  // Rough initial positioning of today near the left edge (at the default
  // density/scale below) so there's no flash of the wrong era before the
  // canvas mounts and centerOnToday() refines it with the real container
  // width/viewZoom.
  const [offsetX, setOffsetX] = useState(() => TODAY_LEFT_MARGIN_PX - BASE_DAY_WIDTH * DENSITY_DAY_PX.week * todayIndex());
  const [scale, setScale] = useState(1);
  const [viewZoom, setViewZoom] = useState(1);
  const [density, setDensity] = useState<Density>("week");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("team");
  const [filterResource, setFilterResource] = useState<string | null>(null);
  const [featureQuery, setFeatureQuery] = useState("");
  const [featureStatusFilter, setFeatureStatusFilter] = useState<"all" | FeatureStatus>("all");
  const [epicsShrunk, setEpicsShrunk] = useState(false);
  const [showDelays, setShowDelays] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [assignPanelH, setAssignPanelH] = useState(280);
  const [timelineBounds, setTimelineBounds] = useState({ startDay: 0, endDay: 0, dayWidth: BASE_DAY_WIDTH });

  const canvasRef = useRef<CanvasViewHandle>(null);
  const preShrinkRef = useRef<{ epics: { id: string; y0: number; y1: number; manualY0?: number | null; manualY1?: number | null }[]; features: { id: string; y: number }[] } | null>(null);

  // Every time a Pulse is opened, land on today rather than wherever the
  // canvas's fixed epoch (2020-01-01) happens to put the default offset.
  // Deferred a frame so the canvas has measured its real container width
  // first (see CanvasView's ResizeObserver) — the useState initializer
  // above already gets us close, this just refines it precisely.
  //
  // Also re-centers whenever density or scale changes: dayWidth is
  // `BASE_DAY_WIDTH * scale * DENSITY_DAY_PX[density]`, and offsetX is a
  // fixed *pixel* offset, not a day offset — switching density alone can
  // change dayWidth by ~7x (day vs. month), which shifts where "today"
  // lands on screen by thousands of pixels without this, easily pushing
  // the marker (and everything else) outside the visible viewport.
  useEffect(() => {
    const raf = requestAnimationFrame(() => canvasRef.current?.centerOnToday());
    return () => cancelAnimationFrame(raf);
  }, [pulseId, density, scale]);

  useEffect(() => {
    if (!selectedId) setRightTab((t) => (t === "details" ? "team" : t));
  }, [selectedId]);

  const selectedFeature = features.find((f) => f.id === selectedId) ?? null;
  const graph = graphConfigOf(pulse);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setRightTab("details");
  }, []);

  const weekends = useMemo(() => {
    if (density !== "day") return [];
    const out: number[] = [];
    for (let d = timelineBounds.startDay; d <= timelineBounds.endDay; d++) if (isWeekendDay(d)) out.push(d);
    return out;
  }, [density, timelineBounds]);

  // Bulk layout ops write many docs at once; they opt out of per-write undo
  // recording (they aren't individually undoable in v1 — see Undo-Spec.md §10)
  // so a single Compact/Shrink doesn't bury the history under dozens of entries.
  const handleCompact = () => {
    const { epics: newEpics, featureYById } = compactLayout(epics, features, graph, { shrunk: epicsShrunk });
    newEpics.forEach((ep) => void patchEpic(ep.id, { y0: ep.y0, y1: ep.y1, manualY0: null, manualY1: null }, { record: false }));
    Object.entries(featureYById).forEach(([id, y]) => void patchFeature(id, { y }, { record: false }));
  };

  const handleToggleShrinkEpics = () => {
    if (!epicsShrunk) {
      preShrinkRef.current = {
        epics: epics.map((e) => ({ id: e.id, y0: e.y0, y1: e.y1, manualY0: e.manualY0, manualY1: e.manualY1 })),
        features: features.map((f) => ({ id: f.id, y: f.y })),
      };
      setEpicsShrunk(true);
      const { epics: newEpics, featureYById } = compactLayout(epics, features, graph, { shrunk: true });
      newEpics.forEach((ep) => void patchEpic(ep.id, { y0: ep.y0, y1: ep.y1, manualY0: null, manualY1: null }, { record: false }));
      Object.entries(featureYById).forEach(([id, y]) => void patchFeature(id, { y }, { record: false }));
    } else {
      const snap = preShrinkRef.current;
      if (snap) {
        snap.epics.forEach((e) => void patchEpic(e.id, { y0: e.y0, y1: e.y1, manualY0: e.manualY0 ?? null, manualY1: e.manualY1 ?? null }, { record: false }));
        snap.features.forEach((f) => void patchFeature(f.id, { y: f.y }, { record: false }));
      }
      setEpicsShrunk(false);
    }
  };

  const handleAddTask = async () => {
    const id = await canvasRef.current?.addTaskAtCenter();
    if (id) handleSelect(id);
  };
  const handleAddEpic = async () => {
    await canvasRef.current?.addEpicAtCenter();
  };

  if (!pulseId) return null;

  if (loading || myRole === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg">
        <span className="font-display text-sm text-yasdu-muted">Loading Pulse…</span>
      </div>
    );
  }

  // Phones get the dedicated touch UI; the canvas layout below is desktop/tablet.
  if (isMobile) {
    return <MobilePulseView pulse={pulse} canEdit={canEdit} myRole={myRole} uid={uid!} />;
  }

  return (
    <div className="h-screen w-full flex flex-col" style={{ background: "#0A1428" }}>
      <Toolbar
        pulseName={pulse?.name ?? ""}
        onRenamePulse={(name) => void renamePulse(name)}
        onInvite={() => setShowInvite(true)}
        viewZoom={viewZoom}
        setViewZoom={setViewZoom}
        scale={scale}
        setScale={setScale}
        density={density}
        setDensity={setDensity}
        onResetView={() => canvasRef.current?.resetView()}
        onFitRoadmap={() => canvasRef.current?.fitRoadmap()}
        onJumpToToday={() => canvasRef.current?.centerOnToday()}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        canUndo={canUndo}
        canRedo={canRedo}
        featureQuery={featureQuery}
        setFeatureQuery={setFeatureQuery}
        featureStatusFilter={featureStatusFilter}
        setFeatureStatusFilter={(v) => setFeatureStatusFilter(v as "all" | FeatureStatus)}
        showDelays={showDelays}
        setShowDelays={setShowDelays}
        epicsShrunk={epicsShrunk}
        onToggleShrinkEpics={handleToggleShrinkEpics}
        onCompact={handleCompact}
        onAddEpic={() => void handleAddEpic()}
        onAddTask={() => void handleAddTask()}
        graph={graph}
        onSetGraphConfig={(stepPx, workPerStep) => void setGraphConfig(stepPx, workPerStep)}
        canEdit={canEdit}
        roleLabel={ROLE_LABEL[myRole]}
      />

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex overflow-hidden" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid #E2DFD9", background: "#FFFFFF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="flex border-b" style={{ borderColor: "#E2DFD9" }}>
              {(["details", "team", "capacity"] as RightTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setRightTab(t)}
                  className="flex-1 text-xs font-semibold py-2.5 capitalize"
                  style={{ color: rightTab === t ? "#123359" : "#64748B", borderBottom: rightTab === t ? "2px solid #EE7240" : "2px solid transparent" }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {rightTab === "team" ? (
                <TeamTab canEdit={canEdit} filterResource={filterResource} setFilterResource={setFilterResource} />
              ) : rightTab === "capacity" ? (
                <CapacityTab canEdit={canEdit} />
              ) : !selectedFeature ? (
                <div className="p-6 text-center text-sm" style={{ color: "#64748B" }}>Select a box on the canvas to see and edit its details here.</div>
              ) : (
                <DetailsTab
                  feature={selectedFeature}
                  canEdit={canEdit}
                  onClose={() => handleSelect(null)}
                  onDuplicate={async () => {
                    const newId = await duplicateFeature(selectedFeature.id);
                    if (newId) handleSelect(newId);
                  }}
                />
              )}
            </div>
          </div>

          <CanvasView
            ref={canvasRef}
            graph={graph}
            density={density}
            scale={scale}
            viewZoom={viewZoom}
            setViewZoom={setViewZoom}
            offsetX={offsetX}
            setOffsetX={setOffsetX}
            epicsShrunk={epicsShrunk}
            showDelays={showDelays}
            selectedId={selectedId}
            onSelect={handleSelect}
            filterResource={filterResource}
            featureQuery={featureQuery}
            featureStatusFilter={featureStatusFilter}
            canEdit={canEdit}
            onTimelineBoundsChange={setTimelineBounds}
          />
        </div>

        <div
          onPointerDown={(e) => {
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              // ignore
            }
            const startY = e.clientY;
            const startH = assignPanelH;
            const mv = (ev: PointerEvent) => setAssignPanelH(Math.max(90, Math.min(620, startH - (ev.clientY - startY))));
            const up = () => {
              window.removeEventListener("pointermove", mv);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", mv);
            window.addEventListener("pointerup", up);
          }}
          title="Drag to resize the resource panel"
          style={{ height: 10, background: "#EEF2F7", borderTop: "1px solid #E2DFD9", borderBottom: "1px solid #E2DFD9", cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          <div style={{ width: 44, height: 3, borderRadius: 2, background: "#B4BECC" }} />
        </div>

        {toast && (
          <div
            className="mono"
            style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 200, background: "#123359", color: "#F0A875", border: "1px solid #EE7240", padding: "8px 14px", borderRadius: 8, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", pointerEvents: "none" }}
          >
            {toast.text}
          </div>
        )}

        {showInvite && uid && myRole && (
          <CollaboratorsDialog
            pulseId={pulseId}
            pulseName={pulse?.name?.trim() || "this Pulse"}
            members={members}
            currentUid={uid}
            myRole={myRole}
            onClose={() => setShowInvite(false)}
          />
        )}

        <div style={{ height: assignPanelH, flexShrink: 0 }}>
          <AssignmentPanel
            offsetX={offsetX}
            dayWidth={timelineBounds.dayWidth}
            viewZoom={viewZoom}
            density={density}
            startDay={timelineBounds.startDay}
            endDay={timelineBounds.endDay}
            weekends={weekends}
            filterResource={filterResource}
            setFilterResource={setFilterResource}
            selectedFeature={selectedFeature}
          />
        </div>
      </div>
    </div>
  );
}
