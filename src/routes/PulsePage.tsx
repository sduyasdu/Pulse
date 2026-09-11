import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { usePulseStore, graphConfigOf } from "@/stores/pulseStore";
import { useUndoStore } from "@/stores/undoStore";
import { ensureMyPulseEntry, getPulse, removeMyPulseEntry, setPulseArchived, updateMyPulseArchivedAt } from "@/services/firestore/pulses";
import { logDirectActivity } from "@/domain/activityRecorder";
import { backfillMyOwnerEmail, fetchMembership, syncMyMemberPhoto } from "@/services/firestore/memberships";
import { CollaboratorsDialog } from "@/components/dashboard/CollaboratorsDialog";
import { ConnectionStatus } from "@/components/shared/ConnectionStatus";
import { useIsMobile, useCoarsePointer } from "@/hooks/useIsMobile";
import { MobilePulseView } from "@/components/mobile/MobilePulseView";
import { compactLayout, newEpicSpan } from "@/domain/layout";
import { overLimitCount } from "@/domain/assignments";
import { BASE_DAY_WIDTH, DENSITY_DAY_PX, statusMetaOf, statusesOf, type Density } from "@/domain/constants";
import { isWeekend as isWeekendDay, todayIndex } from "@/domain/dateUtils";
import { useJustAdded, filterSignatureOf } from "@/hooks/useJustAdded";
import { loadPulseView, savePulseView } from "@/domain/pulseView";
import { roleMeta, capsOf } from "@/domain/permissions";
import { effectiveEditScope, pulseLock } from "@/domain/pulseLock";
import { useT } from "@/i18n";
import type { Feature } from "@/types";
import { ArchivedBanner } from "@/components/shared/ArchivedBanner";
import { Toolbar } from "@/components/canvas/Toolbar";
import { CanvasView, todayMarginFor, type CanvasViewHandle } from "@/components/canvas/CanvasView";
import { KanbanView } from "@/components/kanban/KanbanView";
import { PresenceBar } from "@/components/presence/PresenceBar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { AllCommentsPanel } from "@/components/comments/AllCommentsPanel";
import { Icon } from "@/components/shared/Icon";
import { Spinner } from "@/components/shared/Spinner";
import { AssignmentPanel } from "@/components/assignmentPanel/AssignmentPanel";
import { CostPanel } from "@/components/costPanel/CostPanel";
import { COSTS_ENABLED } from "@/domain/flags";
import { HelpDrawer } from "@/components/help/HelpDrawer";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { EpicsTab } from "@/components/leftPanel/EpicsTab";
import { DetailsTab } from "@/components/leftPanel/DetailsTab";
import { ActivityTab } from "@/components/leftPanel/ActivityTab";

type RightTab = "epics" | "details" | "team" | "activity";

export function PulsePage() {
  const { pulseId } = useParams<{ pulseId: string }>();
  const t = useT();
  const navigate = useNavigate();
  const firebaseUser = useAuthStore((s) => s.firebaseUser);
  const myPhotoURL = useAuthStore((s) => s.userDoc?.photoURL ?? null);
  const myEmail = useAuthStore((s) => s.firebaseUser?.email ?? null);

  const load = usePulseStore((s) => s.load);
  const pulse = usePulseStore((s) => s.pulse);
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
  const members = usePulseStore((s) => s.members);
  const loading = usePulseStore((s) => s.loading);
  const notFound = usePulseStore((s) => s.notFound);
  const contentError = usePulseStore((s) => s.contentError);
  const roleOf = usePulseStore((s) => s.roleOf);
  const renamePulse = usePulseStore((s) => s.renamePulse);
  const setGraphConfig = usePulseStore((s) => s.setGraphConfig);
  const addEpic = usePulseStore((s) => s.addEpic);
  const patchEpic = usePulseStore((s) => s.patchEpic);
  const patchFeature = usePulseStore((s) => s.patchFeature);
  const duplicateFeature = usePulseStore((s) => s.duplicateFeature);
  const isMobile = useIsMobile();
  const coarsePointer = useCoarsePointer();
  const statuses = statusesOf(pulse);

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
  // An archived Pulse is read-only for everyone, owners included. Folding that
  // in HERE — the one place edit rights are derived — freezes every disabled
  // state, drag guard, hidden control and keyboard shortcut at once
  // (Hide-and-Archive-Spec §5.1). Nothing downstream needs to know why.
  // PL4's over-limit lock (Plans-Spec §5.1) isn't built yet, and can't be from
  // here: it needs the org's Pulses ordered by `createdAt`, and there is no
  // `list` rule on the top-level `pulses` collection to fetch them (the one in
  // Collaboration-Spec §4 arrives with Teams). So this is always false today.
  // When PL4 lands, pass the derived value — pulseLock() already resolves the
  // precedence (archived wins, Hide-and-Archive-Spec §5.6) and is unit-tested
  // for both, so this is the only line that changes.
  const planLocked = false;
  const lock = pulseLock(pulse, planLocked);
  const editScope = effectiveEditScope(myMember ? capsOf(myMember).editScope : "none", lock);
  const canEdit = editScope === "all";
  const archived = lock === "archived";
  /**
   * "N people are over their own limit", raised on the bell rather than printed
   * in the Team tab.
   *
   * It used to sit in the Capacity tab's overview, which meant the one number
   * worth interrupting someone about was only visible if they happened to open
   * a tab and expand a collapsed box. The bell is where this Pulse's standing
   * facts already live.
   *
   * Keyed on the PULSE, not on the count — deliberately unlike the dashboard's
   * quota notice, which keys on the limit. A plan limit changes when you
   * upgrade; this number moves with every drag, so keying on it would resurface
   * the warning mid-edit, which is the opposite of dismissing it.
   */
  const overLimit = useMemo(() => overLimitCount(features, resources), [features, resources]);
  const overLimitAlert = useMemo(
    () =>
      overLimit > 0
        ? {
            text: overLimit === 1 ? t("team.overLimitAlertOne") : t("team.overLimitAlert", { n: overLimit }),
            dismissKey: `pulse.overLimitNotice.${pulseId ?? "none"}`,
          }
        : null,
    [overLimit, pulseId, t],
  );

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
    // Same shape, different field: Pulses created before the fix stored the
    // owner's email as "". Only an owner may repair it (the rule pins email
    // against self-edits), which is exactly who is affected.
    if (me && me.role === "owner" && !me.email) void backfillMyOwnerEmail(pulseId, uid, myEmail);
  }, [uid, pulseId, members, myPhotoURL, myEmail]);

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

  const indexCheckedFor = useRef<string | null>(null);

  // Self-heal the dashboard index, BOTH ways (Collaboration-Spec §1.6, D14).
  //
  // Removal: this Pulse was deleted, or our membership was revoked — drop the
  // stale entry and bounce to the dashboard. But the listeners are NOT evidence
  // of that on their own: `notFound` and an empty roster can equally come from a
  // cache-served snapshot (offline, flaky reconnect, a listener torn down by an
  // error), and neither subscribePulse nor subscribePulseMembers inspects
  // `metadata.fromCache`. They do now report refusals — that is what
  // `contentError` is — but a refusal is only one of the ways to arrive here,
  // so this still confirms with direct reads first — both throw when the client is offline, and the caller's own
  // pulseMembers doc is always self-readable — and delete only on a definitive
  // "gone". A false positive here is unrecoverable (see ensureMyPulseEntry).
  //
  // Restoration: the confirmed-good case writes the entry back if it's missing,
  // so a Pulse that already fell out of a dashboard returns the next time its
  // member opens it.
  useEffect(() => {
    if (loading || !uid || !pulseId) return;
    let cancelled = false;
    void (async () => {
      try {
        if (notFound || myRole === null) {
          const [livePulse, membership] = await Promise.all([getPulse(pulseId), fetchMembership(pulseId, uid)]);
          if (cancelled) return;
          // Confirmed present after all — the listeners were stale, not the
          // data. Leave the index alone; they'll deliver the real snapshot.
          if (livePulse !== null && membership !== null) return;
          await removeMyPulseEntry(uid, pulseId);
          navigate("/", { replace: true });
        } else if (myMember && pulse && indexCheckedFor.current !== pulseId) {
          // `pulse`/`myMember` are fresh objects on every snapshot, so pin the
          // check to one read per Pulse load rather than one per edit. Marked
          // done only on success, so an offline attempt still retries; the
          // write itself is idempotent, so an overlapping run costs nothing.
          await ensureMyPulseEntry(uid, {
            pulseId,
            name: pulse.name ?? "",
            workspaceId: pulse.workspaceId ?? "",
            role: myMember.role,
            joinedAt: myMember.joinedAt,
            archivedAt: pulse.archivedAt ?? null,
          });
          indexCheckedFor.current = pulseId;
        }
      } catch {
        // Transient / offline — change nothing; a later load retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, uid, pulseId, notFound, myRole, myMember, pulse, navigate]);

  useEffect(() => {
    document.title = pulse?.name?.trim() ? `${pulse.name.trim()} — Beats` : "Beats — Visual Project Planning";
  }, [pulse?.name]);

  // Rough initial positioning of today near the left edge (at the default
  // density/scale below) so there's no flash of the wrong era before the
  // canvas mounts and centerOnToday() refines it with the real container
  // width/viewZoom.
  // Estimated from the window minus the left panel, because the canvas hasn't
  // measured itself yet. Close enough that the exact centring on mount is
  // imperceptible; using the 80px fallback here would show a visible jump now
  // that the real margin is a third of the width.
  const [offsetX, setOffsetX] = useState(() =>
    todayMarginFor(typeof window === "undefined" ? 0 : Math.max(0, window.innerWidth - 320)) -
    BASE_DAY_WIDTH * DENSITY_DAY_PX.week * todayIndex());
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
  // Which epic the Epics tab highlights. Set when one is created, so the
  // tab opens on it rather than leaving the reader to find it in the list.
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [filterResource, setFilterResource] = useState<string | null>(null);
  const [featureQuery, setFeatureQuery] = useState("");
  // Empty set = no filter ("all"). Multi-select, so a set of chosen values.
  const [featureStatusFilter, setFeatureStatusFilter] = useState<Set<string>>(new Set());
  const [epicFilter, setEpicFilter] = useState<Set<string>>(new Set());
  const [compactFilter, setCompactFilter] = useState(true);

  // A task you just created stays visible even when the filters exclude it —
  // see the hook for why, and for when the exemption ends.
  const filterSignature = filterSignatureOf({ query: featureQuery, statuses: featureStatusFilter, epics: epicFilter, resource: filterResource, mineOnly: myTasksOnly });
  const { justAddedIds, markAdded } = useJustAdded(filterSignature);
  // Epics get their own exemption on the same terms. A new epic is empty, so
  // under "hide + compact" it has no visible features and is dropped from the
  // layout — adding one while filtered looked like the button doing nothing.
  const { justAddedIds: justAddedEpicIds, markAdded: markEpicAdded } = useJustAdded(filterSignature);
  const [epicsShrunk, setEpicsShrunk] = useState(false);
  const [showDelays, setShowDelays] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [assignPanelH, setAssignPanelH] = useState(280);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assignPanelOpen, setAssignPanelOpen] = useState(true);
  // Which view occupies the bottom panel — assignments or costs (Costs-Spec §6).
  // Pinned to "assign" while costing is parked (CO21) — with the switch gone
  // there is no way back from "cost", so it must never start there.
  const [bottomPanel, setBottomPanel] = useState<"assign" | "cost">("assign");
  // Only one right-edge drawer at a time — two overlapping panels is a layout bug
  // waiting to be filed (Help-Spec §2).
  const [helpOpen, setHelpOpen] = useState(false);
  const [timelineBounds, setTimelineBounds] = useState({ startDay: 0, endDay: 0, dayWidth: BASE_DAY_WIDTH });

  const canvasRef = useRef<CanvasViewHandle>(null);
  // The page renders a spinner until `loading` clears, so the canvas mounts
  // several renders after the effects that want to drive it. A plain ref gives
  // those effects `null` and they quietly do nothing — which is why the initial
  // centring never ran. This flips when the canvas is really there, and the
  // effects below depend on it.
  const [canvasReady, setCanvasReady] = useState(false);
  const attachCanvas = useCallback((node: CanvasViewHandle | null) => {
    canvasRef.current = node;
    setCanvasReady(!!node);
  }, []);
  const onReferenceDayChange = useCallback((day: number) => {
    setReferenceDay(day);
    canvasRef.current?.centerOnDay(day);
  }, []);
  /** Jump back to today. Needs to be its own control: the marker-date input was
   * the only way there, and an `<input type="date">` fires no change event when
   * you pick the date it already holds — so "go to today" did nothing in the
   * exact case you would want it, having scrolled away while the marker stayed
   * on today. */
  const goToToday = useCallback(() => {
    const day = todayIndex();
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
  //
  // Unless a saved view says otherwise (below): coming back to where you left
  // off is the whole point of remembering it, and centring on today would
  // undo it a frame later.
  const restored = useRef<{ pulseId: string; density: Density; scale: number } | null>(null);

  // Restore first, so the flag is set before the centring effect below reads
  // it — effects run in declaration order.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pulseId || !canvasReady) return;
    // Once per Pulse. `canvasReady` also flips when switching to the board and
    // back, and re-restoring then would throw away wherever the reader had
    // panned to since.
    if (restoredFor.current === pulseId) return;
    restoredFor.current = pulseId;
    const saved = loadPulseView(pulseId);
    if (!saved) {
      restored.current = null;
      return;
    }
    // Recorded as a triple rather than a boolean, because setting `density`
    // here re-fires the centring effect: it has to recognise "this is still the
    // view I restored" and skip, while a density the *user* changes later no
    // longer matches and re-centres as it always did.
    restored.current = { pulseId, density: saved.density, scale };
    setDensity(saved.density);
    setViewZoom(saved.viewZoom);
    setOffsetX(saved.offsetX);
    const raf = requestAnimationFrame(() => canvasRef.current?.restoreScrollTop(saved.scrollTop));
    return () => cancelAnimationFrame(raf);
  }, [pulseId, canvasReady, scale]);

  useEffect(() => {
    const r = restored.current;
    if (r && r.pulseId === pulseId && r.density === density && r.scale === scale) return;
    if (!canvasReady) return;
    const raf = requestAnimationFrame(() => canvasRef.current?.centerOnToday());
    return () => cancelAnimationFrame(raf);
  }, [pulseId, density, scale, canvasReady]);

  // Persist the viewport. Debounced because panning fires continuously, and
  // repeated on unmount because the last 400ms of movement — which includes
  // every "scroll somewhere, then leave" — would otherwise be the part that
  // never got written.
  //
  // `scrollTop` is read from the canvas rather than tracked as state: it isn't
  // one, and making it one would re-render the canvas on every wheel event.
  // The cost is that a purely vertical scroll is only saved on the way out,
  // which is exactly when it was asked to be.
  const viewRef = useRef({ offsetX, viewZoom, density });
  viewRef.current = { offsetX, viewZoom, density };

  const writeView = useCallback(() => {
    if (!pulseId) return;
    savePulseView(pulseId, { ...viewRef.current, scrollTop: canvasRef.current?.getScrollTop() ?? 0 });
  }, [pulseId]);

  // Debounced while panning. The cleanup only cancels — writing here too would
  // fire on every offsetX change and there would be no debounce left.
  useEffect(() => {
    const timer = setTimeout(writeView, 400);
    return () => clearTimeout(timer);
  }, [writeView, offsetX, viewZoom, density]);

  // And once on the way out, keyed on pulseId alone so its cleanup runs only
  // when the Pulse is actually being left. This is the write that catches the
  // last 400ms of movement, and the only one that catches a vertical scroll.
  useEffect(() => () => writeView(), [writeView]);

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
    if (!id) return;
    markAdded(id);
    handleSelect(id);
    // Being un-filtered is not the same as being on screen: a new task lands on
    // today's column whatever the canvas is scrolled to, so if today is out of
    // view it is still nowhere to be seen. Only scrolls when it has to.
    const today = todayIndex();
    if (today < timelineBounds.startDay || today > timelineBounds.endDay) {
      canvasRef.current?.centerOnDay(today);
    }
  };
  const handleAddEpic = async () => {
    // The canvas places the epic where the reader is looking, so prefer it. But
    // the Epics tab is reachable from the BOARD too, where the canvas is
    // unmounted and `canvasRef.current` is null — without this fallback the
    // button would quietly do nothing there, which is the same failure the
    // toolbar's today button already shipped once.
    const id =
      (await canvasRef.current?.addEpicAtCenter()) ??
      (await addEpic(
        // Below the existing bands rather than on top of them: there is no
        // viewport to centre on, and stacking a new epic over an old one is
        // indistinguishable from nothing having happened.
        Math.max(10, ...epics.map((e) => e.y1 + 24)),
        newEpicSpan(referenceDay, BASE_DAY_WIDTH * DENSITY_DAY_PX[density]),
      ));
    if (!id) return;
    markEpicAdded(id);
    // Open the tab on the new epic. Creating one is a two-step act — make it,
    // then say what it is — and the second step lives here, in a list, not on
    // the band, which may be behind a task box or off-screen entirely.
    setSelectedEpicId(id);
    setRightTab("epics");
  };

  // Unarchive from the banner. Owner-only (the button only renders for owners,
  // and the rule re-checks). The Pulse doc is a live subscription, so every
  // member's controls come back without a reload.
  const handleUnarchive = async () => {
    if (!pulseId || !uid) return;
    await setPulseArchived(pulseId, uid, false);
    await updateMyPulseArchivedAt(uid, pulseId, null);
    logDirectActivity(pulseId, {
      entityKind: "pulse", entityId: pulseId, entityName: pulse?.name ?? "", verb: "unarchive",
      summary: "unarchived the Beat",
    });
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

  // Before the spinner, because a refused listener stops `loading` without ever
  // delivering a role — otherwise this is the branch that spins forever.
  if (contentError) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg px-4">
        <div className="w-full max-w-sm rounded-2xl border bg-yasdu-card p-7 text-center shadow-sm" style={{ borderColor: "#E2DFD9" }}>
          <div className="font-display mb-2 text-base font-semibold text-yasdu-fg">{t("pulse.loadFailed")}</div>
          <p className="mb-4 text-sm text-yasdu-muted">{t("pulse.loadFailedDetail")}</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-yasdu-primary-fg"
              style={{ background: "#D85A28" }}
            >
              {t("common.retry")}
            </button>
            <button onClick={() => navigate("/")} className="text-xs text-yasdu-muted hover:underline">
              {t("join.goToDashboard")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || myRole === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-yasdu-bg">
        <Spinner size={24} label={t("pulse.loading")} />
        {/* The spinner holds until every first-paint listener has reported (see
            pulseStore.load), which puts a bad connection squarely inside it —
            and this branch has no toolbar to carry the indicator, so it gets
            its own. */}
        <ConnectionStatus uid={uid} />
      </div>
    );
  }

  // Phones get the dedicated touch UI; the canvas layout below is desktop/tablet.
  // It carries the connection indicator in its own header, as the toolbar does
  // below — a Pulse opened on a phone is the likeliest of all to be on a
  // connection worth knowing about.
  if (isMobile) {
    return (
      <MobilePulseView pulse={pulse} canEdit={canEdit} canEditFeature={canEditFeature} myRole={myRole} uid={uid!} onUnarchive={() => void handleUnarchive()} />
    );
  }

  return (
    <div className="w-full flex flex-col" style={{ background: "#0A1428", height: viewportH ? `${viewportH}px` : "100dvh" }}>
      <Toolbar
        pulseName={pulse?.name ?? ""}
        onRenamePulse={(name) => void renamePulse(name)}
        uid={uid}
        onInvite={() => setShowInvite(true)}
        commentsOpen={commentsOpen}
        onToggleComments={() => { setCommentsOpen((v) => !v); if (!commentsOpen) setHelpOpen(false); }}
        presence={<PresenceBar pulseId={pulseId} uid={uid} email={firebaseUser?.email ?? ""} dark size={28} />}
        notifications={<NotificationsBell pulseId={pulseId} uid={uid} onOpenTask={handleSelect} dark size={32} alert={overLimitAlert} />}
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
        onGoToday={goToToday}
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
        epicOptions={epics.map((e) => ({ id: e.id, name: e.name || t("pulse.untitledEpic"), color: e.color }))}
        statusOptions={statuses.map((s) => ({ id: s.id, name: s.label, color: statusMetaOf(s.id, statuses).border }))}
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
        archived={archived}
      />

      {archived && <ArchivedBanner isOwner={myRole === "owner"} onUnarchive={() => void handleUnarchive()} />}

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
              {(["epics", "details", "team", "activity"] as RightTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className="min-w-0 flex-1 truncate px-1 text-xs font-semibold py-2.5 capitalize"
                  title={t(`tab.${tab}`)}
                  style={{ color: rightTab === tab ? "#123359" : "#64748B", borderBottom: rightTab === tab ? "2px solid #EE7240" : "2px solid transparent" }}
                >
                  {t(`tab.${tab}`)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {rightTab === "team" ? (
                <TeamTab canEdit={canEdit} filterResource={filterResource} setFilterResource={setFilterResource} />
              ) : rightTab === "epics" ? (
                <EpicsTab
                  canEdit={canEdit}
                  epicFilter={epicFilter}
                  setEpicFilter={setEpicFilter}
                  onAddEpic={() => void handleAddEpic()}
                  selectedEpicId={selectedEpicId}
                  onSelectEpic={setSelectedEpicId}
                />
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
              alwaysShowIds={justAddedIds}
              onTaskCreated={markAdded}
            />
          ) : (
            <CanvasView
              ref={attachCanvas}
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
              alwaysShowIds={justAddedIds}
              alwaysShowEpicIds={justAddedEpicIds}
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
          {bottomPanel === "assign" || !COSTS_ENABLED ? (
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
              viewSwitch={COSTS_ENABLED ? <BottomPanelSwitch value={bottomPanel} onChange={setBottomPanel} /> : null}
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
                myBeat={myTasksOnly}
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
