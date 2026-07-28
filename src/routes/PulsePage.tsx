import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { useUndoStore } from "@/stores/undoStore";
import { removeMyPulseEntry } from "@/services/firestore/pulses";
import { syncMyMemberPhoto } from "@/services/firestore/memberships";
import { CollaboratorsDialog } from "@/components/dashboard/CollaboratorsDialog";
import { useIsMobile, useCoarsePointer } from "@/hooks/useIsMobile";
import { MobilePulseView } from "@/components/mobile/MobilePulseView";
import { compactLayout } from "@/domain/layout";
import { BASE_DAY_WIDTH, DENSITY_DAY_PX, statusesOf, type Density } from "@/domain/constants";
import { isWeekend as isWeekendDay, todayIndex } from "@/domain/dateUtils";
import { roleMeta, capsOf } from "@/domain/permissions";
import { useT } from "@/i18n";
import type { Feature } from "@/types";
import { Toolbar } from "@/components/canvas/Toolbar";
import { CanvasView, TODAY_LEFT_MARGIN_PX, type CanvasViewHandle } from "@/components/canvas/CanvasView";
import { KanbanView } from "@/components/kanban/KanbanView";
import { PresenceBar } from "@/components/presence/PresenceBar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { AllCommentsPanel } from "@/components/comments/AllCommentsPanel";
import { Icon } from "@/components/shared/Icon";
import { AssignmentPanel } from "@/components/assignmentPanel/AssignmentPanel";
import { CostPanel } from "@/components/costPanel/CostPanel";
import { HelpDrawer } from "@/components/help/HelpDrawer";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { CapacityTab } from "@/components/leftPanel/CapacityTab";
import { DetailsTab } from "@/components/leftPanel/DetailsTab";
import { ActivityTab } from "@/components/leftPanel/ActivityTab";

type RightTab = "details" | "team" | "capacity" | "activity";

export function PulsePage() {
  const { pulseId } = useParams<{ pulseId: string }>();
  const t = useT();
  const navigate = useNavigate();
  const firebaseUser = useAuthStore((s) => s.firebaseUser);
  const myPhotoURL = useAuthStore((s) => s.userDoc?.photoURL ?? null);

  const load = usePulseStore((s) => s.load);
  const pulse = usePulseStore((s) => s.pulse);
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
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
  const coarsePointer = useCoarsePointer();

  // Pin the app to the actual visible height (px) rather than 100vh/100dvh,
  // which on iPad Safari can mismatch as the address bar shifts and leave a
  // white gap below the layout. Updated on real viewport resizes.
  const [viewportH, setViewportH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 0));
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    onResize();
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

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
  // Capability-based editing: `canEdit` is Pulse-wide edit (editScope 'all' =
  // owner/editor). A Task Lead (editScope 'lead') can't add/config, but can edit
  // the tasks they lead — `canEditFeature` gates those per-feature.
  const myMember = uid ? members.find((m) => m.uid === uid) : undefined;
  const editScope = myMember ? capsOf(myMember).editScope : "none";
  const canEdit = editScope === "all";
  const canEditFeature = useCallback(
    (f: Feature | null | undefined) => !!f && (editScope === "all" || (editScope === "lead" && !!uid && (f.leadUid ?? null) === uid)),
    [editScope, uid],
  );

  // "My Pulse": the resource(s) linked to my account, and the active filter to
  // only tasks I'm involved in (null when off or when I'm not linked).
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const myResourceIds = useMemo(() => (uid ? resources.filter((r) => r.linkedUid === uid).map((r) => r.id) : []), [resources, uid]);
  const myResourceFilter = myTasksOnly && myResourceIds.length > 0 ? myResourceIds : null;

  // Keep my avatar denormalized onto my membership doc so other members can
  // render it (e.g. on a resource linked to my account). Writes only on a
  // real difference, so it converges.
  useEffect(() => {
    if (!uid || !pulseId) return;
    const me = members.find((m) => m.uid === uid);
    if (me && (me.photoURL ?? null) !== myPhotoURL) void syncMyMemberPhoto(pulseId, uid, myPhotoURL);
  }, [uid, pulseId, members, myPhotoURL]);

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
  // Day-scale is fixed now that the toolbar's separate scale control is gone;
  // zoom is handled by viewZoom. Kept as a value so the canvas keeps working.
  const scale = 1;
  const [viewZoom, setViewZoom] = useState(1);
  const [viewMode, setViewMode] = useState<"canvas" | "board">("canvas");
  // The selectable reference date the canvas marker line sits on (defaults to
  // today); picking a date moves the line and centers the view on it.
  const [referenceDay, setReferenceDay] = useState(() => todayIndex());
  const [density, setDensity] = useState<Density>("week");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("team");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [filterResource, setFilterResource] = useState<string | null>(null);
  const [featureQuery, setFeatureQuery] = useState("");
  // Empty set = no filter ("all"). Multi-select, so a set of chosen values.
  const [featureStatusFilter, setFeatureStatusFilter] = useState<Set<string>>(new Set());
  const [epicFilter, setEpicFilter] = useState<Set<string>>(new Set());
  const [compactFilter, setCompactFilter] = useState(true);
  const [epicsShrunk, setEpicsShrunk] = useState(false);
  const [showDelays, setShowDelays] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [assignPanelH, setAssignPanelH] = useState(280);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assignPanelOpen, setAssignPanelOpen] = useState(true);
  // Which view occupies the bottom panel — assignments or costs (Costs-Spec §6).
  const [bottomPanel, setBottomPanel] = useState<"assign" | "cost">("assign");
  // Only one right-edge drawer at a time — two overlapping panels is a layout bug
  // waiting to be filed (Help-Spec §2).
  const [helpOpen, setHelpOpen] = useState(false);
  const [timelineBounds, setTimelineBounds] = useState({ startDay: 0, endDay: 0, dayWidth: BASE_DAY_WIDTH });

  const canvasRef = useRef<CanvasViewHandle>(null);
  const onReferenceDayChange = useCallback((day: number) => {
    setReferenceDay(day);
    canvasRef.current?.centerOnDay(day);
  }, []);
  const preShrinkRef = useRef<{ epics: { id: string; y0: number; y1: number; manualY0?: number | null; manualY1?: number | null }[]; features: { id: string; y: number }[] } | null>(null);

  // Drop any filtered epics that get deleted, so the canvas doesn't silently
  // dim everything against a stale id.
  useEffect(() => {
    setEpicFilter((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set([...prev].filter((id) => epics.some((e) => e.id === id)));
      return valid.size === prev.size ? prev : valid;
    });
  }, [epics]);

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

  // Collapsing the sidebar frees ~290px on the left of the canvas. Shift the
  // canvas content by that (screen) amount so it stays put on screen and the
  // freed space "uncovers" the earlier part of the roadmap, rather than the
  // whole canvas sliding left. Expanding does the reverse.
  const toggleSidebar = () => {
    const delta = (320 - 30) / viewZoom;
    setOffsetX((x) => x + (sidebarOpen ? delta : -delta));
    setSidebarOpen((o) => !o);
  };

  if (!pulseId) return null;

  if (loading || myRole === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg">
        <span className="font-display text-sm text-yasdu-muted">{t("pulse.loading")}</span>
      </div>
    );
  }

  // Phones get the dedicated touch UI; the canvas layout below is desktop/tablet.
  if (isMobile) {
    return <MobilePulseView pulse={pulse} canEdit={canEdit} canEditFeature={canEditFeature} myRole={myRole} uid={uid!} />;
  }

  return (
    <div className="w-full flex flex-col" style={{ background: "#0A1428", height: viewportH ? `${viewportH}px` : "100dvh" }}>
      <Toolbar
        pulseName={pulse?.name ?? ""}
        onRenamePulse={(name) => void renamePulse(name)}
        onInvite={() => setShowInvite(true)}
        commentsOpen={commentsOpen}
        onToggleComments={() => { setCommentsOpen((v) => !v); if (!commentsOpen) setHelpOpen(false); }}
        presence={<PresenceBar pulseId={pulseId} uid={uid} email={firebaseUser?.email ?? ""} dark size={28} />}
        notifications={<NotificationsBell pulseId={pulseId} uid={uid} onOpenTask={handleSelect} dark size={32} />}
        viewMode={viewMode}
        setViewMode={setViewMode}
        viewZoom={viewZoom}
        onZoomIn={() => canvasRef.current?.zoomStep(0.15)}
        onZoomOut={() => canvasRef.current?.zoomStep(-0.15)}
        density={density}
        setDensity={setDensity}
        onResetView={() => canvasRef.current?.resetView()}
        onFitRoadmap={() => canvasRef.current?.fitRoadmap()}
        referenceDay={referenceDay}
        onReferenceDayChange={onReferenceDayChange}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        canUndo={canUndo}
        canRedo={canRedo}
        featureQuery={featureQuery}
        setFeatureQuery={setFeatureQuery}
        featureStatusFilter={featureStatusFilter}
        setFeatureStatusFilter={setFeatureStatusFilter}
        epicFilter={epicFilter}
        setEpicFilter={setEpicFilter}
        compactFilter={compactFilter}
        onToggleCompactFilter={() => setCompactFilter((v) => !v)}
        myPulse={myTasksOnly}
        onToggleMyPulse={() => setMyTasksOnly((v) => !v)}
        canMyPulse={myResourceIds.length > 0}
        epicOptions={epics.map((e) => ({ id: e.id, name: e.name || t("pulse.untitledEpic") }))}
        statusOptions={statusesOf(pulse).map((s) => ({ id: s.id, name: s.label }))}
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
        helpOpen={helpOpen}
        onToggleHelp={() => { setHelpOpen((v) => !v); if (!helpOpen) setCommentsOpen(false); }}
        roleLabel={roleMeta(myRole).label}
      />

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex overflow-hidden relative" style={{ flex: 1, minHeight: 0 }}>
          {!sidebarOpen && (
            <div style={{ width: 30, flexShrink: 0, borderRight: "1px solid #E2DFD9", background: "#FFFFFF", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
              <button onClick={toggleSidebar} title={t("panel.showPanel")} className="no-press" style={{ color: "#64748B", display: "flex", alignItems: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          )}
          <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid #E2DFD9", background: "#FFFFFF", display: sidebarOpen ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>
            <div className="flex items-center border-b" style={{ borderColor: "#E2DFD9" }}>
              <button onClick={toggleSidebar} title={t("panel.collapsePanel")} className="no-press" style={{ color: "#64748B", padding: "0 8px", flexShrink: 0, display: "flex", alignItems: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              {(["details", "team", "capacity", "activity"] as RightTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className="flex-1 text-xs font-semibold py-2.5 capitalize"
                  style={{ color: rightTab === tab ? "#123359" : "#64748B", borderBottom: rightTab === tab ? "2px solid #EE7240" : "2px solid transparent" }}
                >
                  {t(`tab.${tab}`)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {rightTab === "team" ? (
                <TeamTab canEdit={canEdit} filterResource={filterResource} setFilterResource={setFilterResource} />
              ) : rightTab === "capacity" ? (
                <CapacityTab canEdit={canEdit} />
              ) : rightTab === "activity" ? (
                <ActivityTab />
              ) : !selectedFeature ? (
                <div className="p-6 text-center text-sm" style={{ color: "#64748B" }}>{t("panel.selectBox")}</div>
              ) : (
                <DetailsTab
                  feature={selectedFeature}
                  canEdit={canEditFeature(selectedFeature)}
                  hideComments
                  onClose={() => handleSelect(null)}
                  onDuplicate={async () => {
                    const newId = await duplicateFeature(selectedFeature.id);
                    if (newId) handleSelect(newId);
                  }}
                />
              )}
            </div>
          </div>

          {viewMode === "board" ? (
            <KanbanView
              selectedId={selectedId}
              onSelect={handleSelect}
              canEdit={canEdit}
              canEditFeature={canEditFeature}
              featureQuery={featureQuery}
              featureStatusFilter={featureStatusFilter}
              epicFilter={epicFilter}
              filterResource={filterResource}
              myResourceIds={myResourceFilter}
            />
          ) : (
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
              epicFilter={epicFilter}
              compactFilter={compactFilter}
              myResourceIds={myResourceFilter}
              referenceDay={referenceDay}
              canEdit={canEdit}
              canEditFeature={canEditFeature}
              onTimelineBoundsChange={setTimelineBounds}
            />
          )}
        </div>

        {viewMode === "canvas" && (assignPanelOpen ? (
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
            title={t("panel.dragResize")}
            style={{ height: coarsePointer ? 20 : 10, background: "#EEF2F7", borderTop: "1px solid #E2DFD9", borderBottom: "1px solid #E2DFD9", cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, touchAction: "none" }}
          >
            <div style={{ width: coarsePointer ? 56 : 44, height: coarsePointer ? 4 : 3, borderRadius: 2, background: "#B4BECC" }} />
          </div>
        ) : (
          <button
            onClick={() => setAssignPanelOpen(true)}
            title={t("panel.showAssignment")}
            className="mono no-press"
            style={{ height: 30, width: "100%", background: "#EEF2F7", borderTop: "1px solid #E2DFD9", borderBottom: "1px solid #E2DFD9", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 10, fontSize: 11, color: "#64748B" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg> {t("panel.assignmentByResource")}
          </button>
        ))}

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
            pulseName={pulse?.name?.trim() || t("common.thisPulse")}
            members={members}
            currentUid={uid}
            myRole={myRole}
            onClose={() => setShowInvite(false)}
            onLeave={() => navigate("/")}
          />
        )}

        {viewMode === "canvas" && assignPanelOpen && (
        <div style={{ height: assignPanelH, flexShrink: 0 }}>
          {bottomPanel === "assign" ? (
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
              onCollapse={() => setAssignPanelOpen(false)}
              labelWidth={sidebarOpen ? 320 : 30}
              viewSwitch={<BottomPanelSwitch value={bottomPanel} onChange={setBottomPanel} />}
            />
          ) : (
            <CostPanel
              offsetX={offsetX}
              dayWidth={timelineBounds.dayWidth}
              viewZoom={viewZoom}
              density={density}
              startDay={timelineBounds.startDay}
              endDay={timelineBounds.endDay}
              weekends={weekends}
              selectedFeature={selectedFeature}
              onCollapse={() => setAssignPanelOpen(false)}
              labelWidth={sidebarOpen ? 320 : 30}
              viewSwitch={<BottomPanelSwitch value={bottomPanel} onChange={setBottomPanel} />}
            />
          )}
        </div>
        )}

        {/* Comments drawer — overlays the right edge of the whole content area
            (canvas + assignment-by-resource panel) so toggling it doesn't
            reflow anything. Hidden by default. */}
        {helpOpen && <HelpDrawer onClose={() => setHelpOpen(false)} />}

        {commentsOpen && (
          <div className="absolute flex flex-col" style={{ right: 0, top: 0, bottom: 0, width: 360, maxWidth: "92%", background: "#FFFFFF", borderLeft: "1px solid #E2DFD9", boxShadow: "-10px 0 28px rgba(15,23,42,0.10)", zIndex: 40 }}>
            <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "#E2DFD9" }}>
              <span className="font-display text-sm font-semibold" style={{ color: "#1F2330" }}>{t("pulse.comments")}</span>
              <button onClick={() => setCommentsOpen(false)} className="no-press" style={{ color: "#94A3B8", display: "flex" }} title={t("pulse.hideComments")}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="flex-1" style={{ minHeight: 0 }}>
              <AllCommentsPanel
                pulseId={pulseId}
                onSelectTask={handleSelect}
                selectedFeatureId={selectedId}
                selectedResourceId={filterResource}
                onSelectResource={setFilterResource}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Switches the bottom panel between assignments and costs (Costs-Spec §6).
 * Rendered by the page and handed to whichever panel is showing, so the two
 * views share one control instead of each growing their own. */
function BottomPanelSwitch({ value, onChange }: { value: "assign" | "cost"; onChange: (v: "assign" | "cost") => void }) {
  const t = useT();
  const options: { id: "assign" | "cost"; label: string }[] = [
    { id: "assign", label: t("cost.viewAssign") },
    { id: "cost", label: t("cost.view") },
  ];
  return (
    <div className="flex rounded overflow-hidden flex-shrink-0" style={{ border: "1px solid #E2DFD9" }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className="text-xs font-semibold px-2.5 py-1"
          style={{ background: value === o.id ? "#123359" : "#FFFFFF", color: value === o.id ? "#FFFFFF" : "#64748B" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
