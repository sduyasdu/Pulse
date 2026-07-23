import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Epic, Feature, GraphConfig } from "@/types";
import { usePulseStore } from "@/stores/pulseStore";
import { boxHeight, staffingColor, workOf, estimateEffort, assignedEffort, allocOf, clamp as clampEffort } from "@/domain/graphEffort";
import { epicAtBox, epicBandsFor } from "@/domain/layout";
import { businessInSpan, dateForDay, isWeekend as isWeekendDay, todayIndex } from "@/domain/dateUtils";
import { buildTimeline } from "@/domain/timeline";
import { BASE_DAY_WIDTH, CONTENT_MIN_HEIGHT, DENSITY_DAY_PX, colorForName, hexA, statusesOf, statusMetaOf, type Density } from "@/domain/constants";
import { useDebouncedText } from "@/hooks/useDebouncedText";
import { useCoarsePointer } from "@/hooks/useIsMobile";
import { recordSingle, patchOp } from "@/stores/undoStore";
import { confirmAt } from "@/stores/confirmStore";

function EpicNameInput({ name, color, disabled, onCommit }: { name: string; color: string; disabled: boolean; onCommit: (name: string) => void }) {
  const [local, onChange] = useDebouncedText(name, onCommit);
  return (
    <input
      value={local}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled}
      className="mono bg-transparent"
      style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.02em", border: "none", outline: "none", width: Math.max(80, local.length * 7) }}
    />
  );
}

const clamp = clampEffort;

// Screen-space (post-viewZoom) distance from the left edge where "today"
// lands when opening a Pulse or jumping back to today — near the left
// rather than dead-center, so there's room to see what's coming up.
export const TODAY_LEFT_MARGIN_PX = 80;

export interface CanvasViewHandle {
  fitRoadmap: () => void;
  zoomStep: (delta: number) => void;
  resetView: () => void;
  centerOnToday: () => void;
  addTaskAtCenter: () => Promise<string>;
  addEpicAtCenter: () => Promise<string>;
}

interface CanvasViewProps {
  graph: GraphConfig;
  density: Density;
  scale: number;
  viewZoom: number;
  setViewZoom: React.Dispatch<React.SetStateAction<number>>;
  offsetX: number;
  setOffsetX: React.Dispatch<React.SetStateAction<number>>;
  epicsShrunk: boolean;
  showDelays: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filterResource: string | null;
  featureQuery: string;
  featureStatusFilter: Set<string>;
  epicFilter: Set<string>;
  canEdit: boolean;
  onTimelineBoundsChange?: (bounds: { startDay: number; endDay: number; dayWidth: number }) => void;
}

type DragKind = "move" | "resize-left" | "resize-right" | "resize-effort";

export const CanvasView = forwardRef<CanvasViewHandle, CanvasViewProps>(function CanvasView(
  { graph, density, scale, viewZoom, setViewZoom, offsetX, setOffsetX, epicsShrunk, showDelays, selectedId, onSelect, filterResource, featureQuery, featureStatusFilter, epicFilter, canEdit, onTimelineBoundsChange },
  ref,
) {
  const coarse = useCoarsePointer();
  const epics = usePulseStore((s) => s.epics);
  const features = usePulseStore((s) => s.features);
  const resources = usePulseStore((s) => s.resources);
  const statuses = statusesOf(usePulseStore((s) => s.pulse));
  const patchFeature = usePulseStore((s) => s.patchFeature);
  const patchEpic = usePulseStore((s) => s.patchEpic);
  const addFeature = usePulseStore((s) => s.addFeature);
  const addEpic = usePulseStore((s) => s.addEpic);
  const removeEpic = usePulseStore((s) => s.removeEpic);
  // Resource docs use an opaque id as the canonical key (see types/index.ts
  // — unlike the prototype, where the 2-3 letter initials WERE the id);
  // anywhere we show a resource inline on the canvas, look up its initials
  // rather than rendering the raw id.
  const resourceById = useMemo(() => Object.fromEntries(resources.map((r) => [r.id, r])), [resources]);

  // Tracked live via actual key events (not a single pointerdown event's
  // ctrlKey/metaKey, which can be unreliable — e.g. macOS may reinterpret
  // Ctrl+click as a simulated right-click before a drag-start handler
  // sees it). Holding Ctrl/Cmd during a move-drag is what makes it a
  // deliberate epic-reassignment gesture — see handleDragMove.
  const ctrlHeldRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") ctrlHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") ctrlHeldRef.current = false;
    };
    const onBlur = () => {
      ctrlHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  // Non-null while a two-finger pinch (Safari gesture) is in progress; also
  // makes single-finger drag/pan bail so the pinch isn't misread as a drag.
  const gestureRef = useRef<{ startZoom: number } | null>(null);
  const [dimHint, setDimHint] = useState<{ x: number; y: number; text: string } | null>(null);
  // Full-detail popover shown on hover for boxes too small to display
  // everything (thin/short tasks) — see the collapsed feature-box body.
  const [hoverCard, setHoverCard] = useState<{ x: number; y: number; box: Feature } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panArmed, setPanArmed] = useState(false);
  const [dragOverBoxId, setDragOverBoxId] = useState<string | null>(null);

  // "Drag overlay" — optimistic local render state during an active
  // box/epic drag, committed to Firestore on pointerup (+ a periodic
  // safety-net write for long drags) instead of on every pointermove.
  const [dragOverlay, setDragOverlay] = useState<{ id: string; patch: Partial<Feature> } | null>(null);
  const [epicOverlay, setEpicOverlay] = useState<{ id: string; patch: Partial<Epic> } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const dayWidth = BASE_DAY_WIDTH * scale * DENSITY_DAY_PX[density];
  const xForDay = useCallback((day: number) => offsetX + day * dayWidth, [offsetX, dayWidth]);

  const startDay = Math.floor(-offsetX / dayWidth) - 2;
  const endDay = Math.ceil((containerWidth / viewZoom - offsetX) / dayWidth) + 2;

  useEffect(() => {
    onTimelineBoundsChange?.({ startDay, endDay, dayWidth });
  }, [startDay, endDay, dayWidth, onTimelineBoundsChange]);

  // Kept fresh on every render but deliberately NOT depended on by the
  // useCallbacks/effects that read it below (handleDragMove, the
  // filter-jump effect) — reading via a ref means those don't need to be
  // recreated (and window listeners re-attached) every time features/
  // epics/pan-zoom change, while still never seeing stale values, even
  // mid-drag after a periodic Firestore sync updates `features`.
  const latestViewRef = useRef({ startDay, endDay, dayWidth, viewZoom, features, filterResource, epics, graph, epicsShrunk });
  latestViewRef.current = { startDay, endDay, dayWidth, viewZoom, features, filterResource, epics, graph, epicsShrunk };

  // When the feature search/status filter narrows the results, jump to the
  // first (earliest-starting) match if it isn't already on screen — a
  // dimmed-but-hidden-off-canvas match is as good as invisible. Debounced
  // so typing a search term doesn't yank the view on every keystroke.
  useEffect(() => {
    const q = featureQuery.trim().toLowerCase();
    if (!q && featureStatusFilter.size === 0 && epicFilter.size === 0) return;
    const handle = setTimeout(() => {
      const { startDay: sd, endDay: ed, dayWidth: dw, viewZoom: vz, features: fs, filterResource: fr } = latestViewRef.current;
      const matching = fs.filter((box) => {
        const matchesRes = !fr || (box.resources || []).includes(fr) || (box.children || []).some((c) => (c.resources || []).includes(fr));
        const matchesQuery = !q || (box.title || "").toLowerCase().includes(q) || (box.children || []).some((c) => (c.title || "").toLowerCase().includes(q));
        const matchesStatus = featureStatusFilter.size === 0 || featureStatusFilter.has(box.status);
        const matchesEpic = epicFilter.size === 0 || (box.epicId != null && epicFilter.has(box.epicId));
        return matchesRes && matchesQuery && matchesStatus && matchesEpic;
      });
      if (matching.length === 0) return;
      const first = matching.reduce((a, b) => (a.x < b.x ? a : b));
      if (first.x < sd || first.x > ed) {
        setOffsetX(TODAY_LEFT_MARGIN_PX / vz - dw * first.x);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [featureQuery, featureStatusFilter, epicFilter, setOffsetX]);

  const weekends = useMemo(() => {
    if (density !== "day") return [];
    const out: number[] = [];
    for (let d = startDay; d <= endDay; d++) if (isWeekendDay(d)) out.push(d);
    return out;
  }, [density, startDay, endDay]);

  const timeline = useMemo(() => buildTimeline(density, startDay, endDay), [density, startDay, endDay]);

  const displayFeatures = useMemo(
    () => (dragOverlay ? features.map((f) => (f.id === dragOverlay.id ? { ...f, ...dragOverlay.patch } : f)) : features),
    [features, dragOverlay],
  );
  const displayEpics = useMemo(
    () => (epicOverlay ? epics.map((e) => (e.id === epicOverlay.id ? { ...e, ...epicOverlay.patch } : e)) : epics),
    [epics, epicOverlay],
  );

  const contentHeight = useMemo(
    () =>
      Math.max(
        CONTENT_MIN_HEIGHT,
        Math.max(0, ...displayFeatures.map((f) => f.y + boxHeight(f, graph))) + 260,
        Math.max(0, ...displayEpics.map((e) => e.y1)) + 120,
      ),
    [displayFeatures, displayEpics, graph],
  );

  // Auto-fit over ALL features, including the one being dragged: a plain
  // drag is meant to EXTEND the box's current epic to keep containing it,
  // never to reassign it. Epic reassignment happens only on an explicit
  // Ctrl/Cmd-drag, which computes its own one-off band set (excluding the
  // dragged box) in handleDragMove below.
  const epicBands = useMemo(
    () => epicBandsFor(displayEpics, displayFeatures, graph, { shrunk: epicsShrunk }),
    [displayEpics, displayFeatures, graph, epicsShrunk],
  );
  const epicBandsRef = useRef(epicBands);
  useEffect(() => {
    epicBandsRef.current = epicBands;
  }, [epicBands]);

  // ---- panning ----
  const panRef = useRef<{ startX: number; startY: number; origOffset: number; active: boolean; scroller: HTMLDivElement | null; origScroll: number; viewZoom: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePanMove = useCallback((e: PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    if (gestureRef.current) return; // pinch in progress — don't pan
    if (!p.active) {
      if (Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY) < 4) return;
      p.active = true;
      setIsPanning(true);
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
    setOffsetX(p.origOffset + (e.clientX - p.startX) / (p.viewZoom || 1));
    if (p.scroller) p.scroller.scrollTop = p.origScroll - (e.clientY - p.startY);
  }, [setOffsetX]);

  const endPan = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
    setPanArmed(false);
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    window.removeEventListener("pointermove", handlePanMove);
    window.removeEventListener("pointerup", endPan);
  }, [handlePanMove]);

  const handlePanPointerDown = (e: React.PointerEvent) => {
    onSelect(null);
    setHoverCard(null); // tapping empty canvas dismisses any open info card
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origOffset: offsetX,
      active: false,
      scroller: containerRef.current,
      origScroll: containerRef.current ? containerRef.current.scrollTop : 0,
      viewZoom,
    };
    longPressTimer.current = setTimeout(() => setPanArmed(true), 250);
    window.addEventListener("pointermove", handlePanMove);
    window.addEventListener("pointerup", endPan);
  };

  const offsetXRef = useRef(offsetX);
  useEffect(() => {
    offsetXRef.current = offsetX;
  }, [offsetX]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const cont = containerRef.current;
      if (!cont) return;
      const rect = cont.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + cont.scrollLeft;
      setViewZoom((zPrev) => {
        const worldX = mouseX / zPrev - offsetXRef.current;
        const factor = Math.exp(-e.deltaY * 0.01);
        const next = clamp(Math.round(zPrev * factor * 100) / 100, 0.3, 2);
        setOffsetX(mouseX / next - worldX);
        return next;
      });
    },
    [setViewZoom, setOffsetX],
  );

  // Safari (iPad) pinch-zoom: gesturechange carries a cumulative `scale`
  // relative to gesturestart. Zoom viewZoom around the pinch centre, matching
  // the wheel zoom's keep-the-point-under-the-cursor math.
  const handleGestureStart = useCallback((e: Event) => {
    e.preventDefault();
    gestureRef.current = { startZoom: latestViewRef.current.viewZoom };
  }, []);
  const handleGestureChange = useCallback(
    (e: Event) => {
      e.preventDefault();
      const g = gestureRef.current;
      const cont = containerRef.current;
      if (!g || !cont) return;
      const ge = e as unknown as { scale: number; clientX: number };
      const rect = cont.getBoundingClientRect();
      const mouseX = ge.clientX - rect.left + cont.scrollLeft;
      const next = clamp(Math.round(g.startZoom * ge.scale * 100) / 100, 0.3, 2);
      setViewZoom((zPrev) => {
        const worldX = mouseX / zPrev - offsetXRef.current;
        setOffsetX(mouseX / next - worldX);
        return next;
      });
    },
    [setViewZoom, setOffsetX],
  );
  const handleGestureEnd = useCallback((e: Event) => {
    e.preventDefault();
    gestureRef.current = null;
  }, []);

  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const wheelOpt: AddEventListenerOptions = { passive: false };
    cont.addEventListener("wheel", handleWheel, wheelOpt);
    cont.addEventListener("gesturestart", handleGestureStart, wheelOpt);
    cont.addEventListener("gesturechange", handleGestureChange, wheelOpt);
    cont.addEventListener("gestureend", handleGestureEnd, wheelOpt);
    return () => {
      cont.removeEventListener("wheel", handleWheel, wheelOpt);
      cont.removeEventListener("gesturestart", handleGestureStart, wheelOpt);
      cont.removeEventListener("gesturechange", handleGestureChange, wheelOpt);
      cont.removeEventListener("gestureend", handleGestureEnd, wheelOpt);
    };
  }, [handleWheel, handleGestureStart, handleGestureChange, handleGestureEnd]);

  // ---- box drag/resize ----
  const dragRef = useRef<{ kind: DragKind; id: string; startX: number; startY: number; orig: Feature; dayWidth: number; viewZoom: number; lastWrite: number } | null>(null);
  const latestPatchRef = useRef<Partial<Feature> | null>(null);

  const fmtDate = useCallback(
    (day: number) => dateForDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    [],
  );

  const handleDragMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (gestureRef.current) return; // pinch in progress — don't move the box
      const vz = d.viewZoom || 1;
      const dx = (e.clientX - d.startX) / vz;
      const dy = (e.clientY - d.startY) / vz;
      const deltaDays = Math.round(dx / d.dayWidth);
      let patch: Partial<Feature> = {};

      if (d.kind === "move") {
        const nx = d.orig.x + deltaDays;
        const ny = Math.max(6, d.orig.y + dy);
        const span = `${fmtDate(nx)} → ${fmtDate(nx + d.orig.duration)}`;
        // Re-home the box into whichever epic it's dropped inside when the
        // user asks for it with Ctrl/Cmd — or when the box has no epic at
        // all, since then there's no current epic for a plain drag to
        // "extend" and dropping it into one can only mean joining it.
        const reassign = ctrlHeldRef.current || d.orig.epicId == null;
        if (reassign) {
          // Excluding the box from the band computation matters: otherwise
          // its own epic's band just stretches along with it and it can
          // never test as being anywhere else.
          const { epics: latestEpics, features: latestFeatures, graph: latestGraph, epicsShrunk: latestShrunk } = latestViewRef.current;
          const bandsExcludingThis = epicBandsFor(latestEpics, latestFeatures.filter((f) => f.id !== d.id), latestGraph, { shrunk: latestShrunk });
          const epicId = epicAtBox(bandsExcludingThis, nx + d.orig.duration / 2, ny + boxHeight(d.orig, latestGraph) / 2);
          patch = { x: nx, y: ny, epicId };
          const epName = epicId ? (bandsExcludingThis.find((ep) => ep.id === epicId)?.name ?? "") : "no epic";
          setDimHint({ x: e.clientX, y: e.clientY, text: `${span} · → ${epName}` });
        } else {
          // Plain drag of a box that already has an epic: leave epicId
          // untouched and let that epic's band auto-fit-extend to keep
          // containing it.
          patch = { x: nx, y: ny };
          const epName = epicBandsRef.current.find((ep) => ep.id === d.orig.epicId)?.name ?? "";
          setDimHint({ x: e.clientX, y: e.clientY, text: `${span} · ${epName} · ⌃ to re-assign` });
        }
      } else if (d.kind === "resize-right") {
        const nd = Math.max(1, d.orig.duration + deltaDays);
        const wdNew = d.orig.useWeekends ? nd : businessInSpan(d.orig.x, nd);
        patch = { duration: nd };
        setDimHint({ x: e.clientX, y: e.clientY, text: `⟷ elapsed ${wdNew}wd` });
      } else if (d.kind === "resize-left") {
        let nx = d.orig.x + deltaDays;
        let nd = d.orig.duration - deltaDays;
        if (nd < 1) {
          nd = 1;
          nx = d.orig.x + d.orig.duration - 1;
        }
        const wdNew = d.orig.useWeekends ? nd : businessInSpan(nx, nd);
        patch = { x: nx, duration: nd };
        setDimHint({ x: e.clientX, y: e.clientY, text: `⟷ elapsed ${wdNew}wd` });
      } else if (d.kind === "resize-effort") {
        const workOld = d.orig.work != null ? d.orig.work : 1;
        const stepsDelta = Math.round(dy / graph.stepPx);
        const nw = Math.max(graph.workPerStep, workOld + stepsDelta * graph.workPerStep);
        patch = { work: nw };
        setDimHint({ x: e.clientX, y: e.clientY, text: `↕ work ${nw}` });
      }

      latestPatchRef.current = patch;
      setDragOverlay({ id: d.id, patch });

      const now = performance.now();
      if (now - d.lastWrite > 500) {
        d.lastWrite = now;
        // Intermediate frames don't record — the whole gesture becomes one
        // undo entry, captured on pointer-up from the pre-drag `orig`.
        void patchFeature(d.id, patch, { record: false });
      }
    },
    [fmtDate, graph, patchFeature],
  );

  const handleDragUp = useCallback(() => {
    const d = dragRef.current;
    const finalPatch = latestPatchRef.current;
    if (d && finalPatch) {
      void patchFeature(d.id, finalPatch, { record: false });
      // Coalesce the drag into a single undo entry: before = pre-drag state,
      // after = the final committed patch (see Undo-Spec.md §5).
      const label = d.kind === "move" ? "Move task" : d.kind === "resize-effort" ? "Change work" : "Resize task";
      const pid = usePulseStore.getState().pulseId;
      if (pid) recordSingle(label, pid, patchOp("feature", d.id, d.orig as unknown as Record<string, unknown>, finalPatch));
    }
    dragRef.current = null;
    latestPatchRef.current = null;
    setDragId(null);
    setDimHint(null);
    setDragOverlay(null);
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragUp);
  }, [handleDragMove, patchFeature]);

  const startDrag = (kind: DragKind, box: Feature, e: React.PointerEvent) => {
    // Selection must happen for everyone (viewers included) and must stop the
    // event before it bubbles to the canvas's deselect handler — do both first,
    // then gate the actual drag. A viewer or a locked/done task can be selected
    // (to inspect / reopen) but not moved or resized.
    e.stopPropagation();
    onSelect(box.id);
    if (!canEdit || box.status === "done") return;
    setDragId(box.id);
    dragRef.current = { kind, id: box.id, startX: e.clientX, startY: e.clientY, orig: box, dayWidth, viewZoom, lastWrite: performance.now() };
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragUp);
  };

  // Touch gesture on a task box: a quick tap shows the info card, a long-press
  // selects it (opens the details panel), and a drag past a small threshold
  // moves it. On mouse, fall back to the normal press-to-select/drag.
  const startBoxInteraction = (box: Feature, e: React.PointerEvent) => {
    if (!coarse) {
      startDrag("move", box, e);
      return;
    }
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let resolved = false;
    let timer = 0;
    const remove = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearTimeout(timer);
    };
    function onMove(ev: PointerEvent) {
      if (resolved) return;
      if (gestureRef.current) { resolved = true; remove(); return; } // pinch — cancel tap/drag
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) <= 8) return;
      resolved = true;
      remove();
      setHoverCard(null);
      // Drag = move the task (locked/done tasks and viewers can't move).
      if (canEdit && box.status !== "done") {
        onSelect(box.id);
        setDragId(box.id);
        dragRef.current = { kind: "move", id: box.id, startX, startY, orig: box, dayWidth, viewZoom, lastWrite: performance.now() };
        window.addEventListener("pointermove", handleDragMove);
        window.addEventListener("pointerup", handleDragUp);
      }
    }
    function onUp() {
      if (!resolved) {
        resolved = true;
        // tap -> toggle the info card (tapping the same task again dismisses it)
        setHoverCard((h) => (h && h.box.id === box.id ? null : { x: startX, y: startY, box }));
      }
      remove();
    }
    timer = window.setTimeout(() => {
      if (resolved) return;
      resolved = true;
      remove();
      setHoverCard(null);
      onSelect(selectedId === box.id ? null : box.id); // long-press -> toggle select
    }, 500);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleCollapsed = (feature: Feature, e: React.MouseEvent) => {
    e.stopPropagation();
    void patchFeature(feature.id, { collapsed: !feature.collapsed });
  };

  // ---- epic resize ----
  const epicResizeRef = useRef<{ edge: string; id: string; startX: number; startY: number; band: { y0: number; y1: number; minX?: number; maxX?: number }; dayWidth: number; viewZoom: number } | null>(null);
  const epicLatestPatchRef = useRef<Partial<Epic> | null>(null);

  const onEpicResizeMove = useCallback(
    (e: PointerEvent) => {
      const r = epicResizeRef.current;
      if (!r) return;
      const vz = r.viewZoom || 1;
      const dy = (e.clientY - r.startY) / vz;
      const dDays = Math.round(((e.clientX - r.startX) / vz) / r.dayWidth);
      const patch: Partial<Epic> = {};
      if (r.edge.includes("top")) patch.manualY0 = Math.round(r.band.y0 + dy);
      if (r.edge.includes("bottom")) patch.manualY1 = Math.round(r.band.y1 + dy);
      if (r.edge.includes("left")) patch.manualMinX = (r.band.minX ?? 0) + dDays;
      if (r.edge.includes("right")) patch.manualMaxX = (r.band.maxX ?? 0) + dDays;
      epicLatestPatchRef.current = patch;
      setEpicOverlay({ id: r.id, patch });
    },
    [],
  );

  const onEpicResizeUp = useCallback(() => {
    const r = epicResizeRef.current;
    if (r && epicLatestPatchRef.current) void patchEpic(r.id, epicLatestPatchRef.current);
    epicResizeRef.current = null;
    epicLatestPatchRef.current = null;
    setEpicOverlay(null);
    window.removeEventListener("pointermove", onEpicResizeMove);
    window.removeEventListener("pointerup", onEpicResizeUp);
  }, [onEpicResizeMove, patchEpic]);

  const startEpicResize = (edge: string, band: { id: string; y0: number; y1: number; minX?: number; maxX?: number }, e: React.PointerEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    epicResizeRef.current = { edge, id: band.id, startX: e.clientX, startY: e.clientY, band, dayWidth, viewZoom };
    window.addEventListener("pointermove", onEpicResizeMove);
    window.addEventListener("pointerup", onEpicResizeUp);
  };

  // ---- imperative handle for the toolbar ----
  useImperativeHandle(ref, () => ({
    fitRoadmap: () => {
      // Horizontal extent across BOTH tasks and epic bands (a manually-widened
      // epic can reach past its tasks).
      const bands = epicBands.filter((b) => b.minX != null && b.maxX != null);
      const starts = [...displayFeatures.map((f) => f.x), ...bands.map((b) => b.minX as number)];
      const ends = [...displayFeatures.map((f) => f.x + f.duration), ...bands.map((b) => b.maxX as number)];
      const cont = containerRef.current;
      const width = cont?.clientWidth ?? containerWidth;
      const height = cont?.clientHeight ?? 400;
      if (starts.length === 0) {
        setViewZoom(1);
        setOffsetX(TODAY_LEFT_MARGIN_PX - dayWidth * todayIndex());
        return;
      }
      const minDay = Math.min(...starts);
      const maxDay = Math.max(...ends);
      // The canvas scales in BOTH axes, so fit to whichever is the binding
      // constraint — otherwise tall roadmaps stay cut off after a "fit".
      const yMax = Math.max(1, ...displayFeatures.map((f) => f.y + boxHeight(f, graph)), ...epicBands.map((b) => b.y1));
      const marginX = 32;
      const marginY = 24;
      const zX = Math.max(120, width - marginX * 2) / Math.max(1, (maxDay - minDay) * dayWidth);
      const zY = Math.max(80, height - marginY * 2) / yMax;
      const z = clamp(Math.round(Math.min(zX, zY) * 100) / 100, 0.1, 1);
      setViewZoom(z);
      setOffsetX(marginX / z - minDay * dayWidth);
      if (cont) cont.scrollTop = 0;
    },
    // Zoom in/out by a step, anchored at the CENTRE of the visible viewport —
    // whatever is in front of you stays fixed and the roadmap scales around it
    // (the same "keep the point in place" the trackpad pinch does at the
    // cursor, minus the cursor).
    zoomStep: (delta: number) => {
      const anchor = (containerRef.current?.clientWidth ?? containerWidth) / 2;
      setViewZoom((zPrev) => {
        const next = clamp(Math.round((zPrev + delta) * 100) / 100, 0.2, 2);
        const worldX = anchor / zPrev - offsetXRef.current;
        setOffsetX(anchor / next - worldX);
        return next;
      });
    },
    resetView: () => {
      setViewZoom(1);
      setOffsetX(TODAY_LEFT_MARGIN_PX / 1 - dayWidth * todayIndex());
    },
    centerOnToday: () => {
      setOffsetX(TODAY_LEFT_MARGIN_PX / viewZoom - dayWidth * todayIndex());
    },
    addTaskAtCenter: async () => {
      const cont = containerRef.current;
      const scrollTop = cont ? cont.scrollTop : 0;
      const visH = cont ? cont.clientHeight : 400;
      const y = Math.max(10, Math.round((scrollTop + visH / 2) / viewZoom) - 40);
      // New tasks always start at today's date, regardless of where the
      // canvas is currently scrolled horizontally.
      return addFeature({ x: todayIndex(), y, duration: 8, work: 2, status: "planned", resources: [] });
    },
    addEpicAtCenter: async () => {
      const cont = containerRef.current;
      const scrollTop = cont ? cont.scrollTop : 0;
      const visH = cont ? cont.clientHeight : 400;
      const y0 = Math.max(10, Math.round((scrollTop + visH / 2) / viewZoom) - 60);
      return addEpic(y0);
    },
  }));

  const q = featureQuery.trim().toLowerCase();

  return (
    <div className="flex flex-1 flex-col overflow-hidden no-select" style={{ background: "#FDFCF8" }}>
      {/* Ruler */}
      <div className="flex flex-shrink-0" style={{ height: 46, background: "#FFFFFF", borderBottom: "1px solid #E2DFD9" }}>
        <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scaleX(${viewZoom})`, transformOrigin: "left top" }}>
            {weekends.map((d) => (
              <div key={`wr${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, bottom: 0, width: dayWidth, background: "rgba(100,116,139,0.10)" }} />
            ))}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 20, borderBottom: "1px solid #F1F5F9" }}>
              {timeline.primary.map((seg) => (
                <div key={seg.label + seg.left} style={{ position: "absolute", left: xForDay(seg.left), width: (seg.right - seg.left) * dayWidth, top: 0, height: 20, borderRight: "1px solid #F1F5F9", paddingLeft: 6, display: "flex", alignItems: "center", overflow: "hidden" }}>
                  <span className="mono text-xs font-medium truncate" style={{ color: "#64748B", transform: `scaleX(${1 / viewZoom})`, transformOrigin: "left" }}>{seg.label}</span>
                </div>
              ))}
            </div>
            {timeline.secondary.map((t, i) => {
              const nextDay = timeline.secondary[i + 1]?.day ?? t.day + (density === "day" ? 1 : density === "week" ? 7 : 30);
              return (
                <div key={t.day} style={{ position: "absolute", left: xForDay(t.day), width: (nextDay - t.day) * dayWidth, top: 20, bottom: 0, borderLeft: "1px solid #D9DEE6", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  <span className="mono text-xs" style={{ color: "#64748B", transform: `scaleX(${1 / viewZoom})` }}>{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative"
        style={{ flex: "1 1 60%", overflowX: "hidden", overflowY: "auto", cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={handlePanPointerDown}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) setViewZoom(1);
        }}
      >
        {epics.length === 0 && features.length === 0 && (
          <div className="absolute z-30 flex flex-col items-center gap-2 text-center" style={{ left: "50%", top: 140, transform: "translateX(-50%)", width: 320, pointerEvents: "none" }}>
            <span className="font-display text-sm font-medium" style={{ color: "#334155" }}>This Pulse is empty</span>
            <span className="text-xs" style={{ color: "#94A3B8" }}>
              {canEdit ? "Add an epic to start a swimlane, or add a task to place your first box on the timeline." : "Nothing has been planned here yet."}
            </span>
          </div>
        )}

        <div style={{ position: "relative", height: contentHeight * viewZoom, width: "100%" }}>
          <div style={{ position: "absolute", left: 0, top: 0, minHeight: contentHeight, right: 0, transform: `scale(${viewZoom})`, transformOrigin: "left top" }}>
            <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, #E2E5E4 1px, transparent 1px)", backgroundSize: "24px 24px", backgroundPosition: `${offsetX % 24}px 0px`, pointerEvents: "none" }} />
            {weekends.map((d) => (
              <div key={`we${d}`} style={{ position: "absolute", left: xForDay(d), top: 0, height: contentHeight, width: dayWidth, background: "rgba(100,116,139,0.10)", pointerEvents: "none" }} />
            ))}
            {timeline.secondary.map((t) => (
              <div key={t.day} style={{ position: "absolute", left: xForDay(t.day), top: 0, height: contentHeight, width: 1, background: "#F1F3F5", pointerEvents: "none" }} />
            ))}
            <div style={{ position: "absolute", left: xForDay(todayIndex()), top: 0, height: contentHeight, width: 2, background: "#EE7240", opacity: 0.7, pointerEvents: "none" }}>
              <span className="mono" style={{ position: "absolute", top: 4, left: 6, fontSize: 10, color: "#D85A28", background: "#F7E8DA", padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>today</span>
            </div>

            {panArmed && (
              <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 40, pointerEvents: "none" }} className="mono text-xs px-2 py-1 rounded">
                <span style={{ background: "#123359", color: "#F0A875", padding: "3px 8px", borderRadius: 4 }}>✋ panning the timeline</span>
              </div>
            )}

            {/* Epic bands */}
            {epicBands.map((ep) => {
              const hasFeats = ep.count > 0;
              const bandLeft = hasFeats ? xForDay(ep.minX ?? 0) - 8 : 8;
              const bandWidth = hasFeats ? ((ep.maxX ?? 0) - (ep.minX ?? 0)) * dayWidth + 16 : 220;
              return (
                <div key={ep.id} style={{ position: "absolute", left: bandLeft, top: ep.y0, width: bandWidth, height: ep.y1 - ep.y0, background: hexA(ep.color, 0.05), border: `1px dashed ${hexA(ep.color, 0.5)}`, borderRadius: 10, pointerEvents: "none", zIndex: 1 }}>
                  <div style={{ position: "absolute", top: 6, left: 8, display: "flex", alignItems: "center", gap: 6, pointerEvents: "auto" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: ep.color, flexShrink: 0 }} />
                    <EpicNameInput
                      name={ep.name}
                      color={ep.color}
                      disabled={!canEdit}
                      onCommit={(name) => void patchEpic(ep.id, { name })}
                    />
                    <span className="mono" style={{ fontSize: 9, color: "#64748B" }}>{ep.count} feat{ep.count === 1 ? "" : "s"}</span>
                    {canEdit && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={async (e) => {
                          if (await confirmAt(e, { message: `Delete epic "${ep.name}"?`, detail: "Its features stay but become unassigned." })) void removeEpic(ep.id);
                        }}
                        title="Delete epic"
                        style={{ fontSize: 11, color: hexA(ep.color, 0.7) }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {canEdit && (
                    <>
                      <div onPointerDown={(e) => startEpicResize("top", ep, e)} title="Resize top" style={{ position: "absolute", top: -4, left: 12, right: 12, height: 8, cursor: "ns-resize", pointerEvents: "auto" }} />
                      <div onPointerDown={(e) => startEpicResize("bottom", ep, e)} title="Resize bottom" style={{ position: "absolute", bottom: -4, left: 12, right: 12, height: 8, cursor: "ns-resize", pointerEvents: "auto" }} />
                      <div onPointerDown={(e) => startEpicResize("left", ep, e)} title="Resize left" style={{ position: "absolute", left: -4, top: 12, bottom: 12, width: 8, cursor: "ew-resize", pointerEvents: "auto" }} />
                      <div onPointerDown={(e) => startEpicResize("right", ep, e)} title="Resize right" style={{ position: "absolute", right: -4, top: 12, bottom: 12, width: 8, cursor: "ew-resize", pointerEvents: "auto" }} />
                      <div onPointerDown={(e) => startEpicResize("bottom right", ep, e)} title="Resize" style={{ position: "absolute", right: -5, bottom: -5, width: 12, height: 12, cursor: "nwse-resize", pointerEvents: "auto", background: hexA(ep.color, 0.5), borderRadius: 3 }} />
                    </>
                  )}
                </div>
              );
            })}

            {/* Delay lines */}
            {showDelays &&
              displayFeatures
                .filter((b) => b.plannedX != null && b.plannedDuration != null)
                .map((b) => {
                  const pStart = b.plannedX as number;
                  const pEnd = pStart + (b.plannedDuration as number);
                  const aStart = b.x;
                  const aEnd = b.x + b.duration;
                  const planLeft = xForDay(pStart);
                  const planW = Math.max(2, (pEnd - pStart) * dayWidth);
                  const boxBottom = b.y + (epicsShrunk ? 26 : boxHeight(b, graph));
                  const lineY = boxBottom + 10;
                  const dStart = aStart - pStart;
                  const dEnd = aEnd - pEnd;
                  const startColor = dStart > 0 ? "#E5484D" : dStart < 0 ? "#0F6B5C" : "#64748B";
                  const endColor = dEnd > 0 ? "#E5484D" : "#0F6B5C";
                  const aStartX = xForDay(aStart);
                  const aEndX = xForDay(aEnd);
                  return (
                    <div key={`dl${b.id}`} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 4 }}>
                      <div style={{ position: "absolute", left: planLeft, top: lineY - 1.5, width: planW, height: 3, background: "repeating-linear-gradient(90deg,#94A3B8 0,#94A3B8 5px,transparent 5px,transparent 9px)" }} />
                      <span className="mono" style={{ position: "absolute", left: planLeft + 3, top: lineY + 4, fontSize: 8, color: "#64748B", whiteSpace: "nowrap" }}>plan</span>
                      <div style={{ position: "absolute", left: planLeft - 1, top: lineY - 6, width: 2, height: 12, background: "#94A3B8" }} />
                      <div style={{ position: "absolute", left: planLeft + planW - 1, top: lineY - 6, width: 2, height: 12, background: "#94A3B8" }} />
                      <div style={{ position: "absolute", left: Math.min(planLeft, aStartX), top: lineY - 6, width: Math.abs(aStartX - planLeft), height: 0, borderTop: `2px dotted ${startColor}` }} />
                      <div style={{ position: "absolute", left: Math.min(planLeft + planW, aEndX), top: lineY - 6, width: Math.abs(aEndX - (planLeft + planW)), height: 0, borderTop: `2px dotted ${endColor}` }} />
                      {dStart !== 0 && <span className="mono" style={{ position: "absolute", left: Math.min(planLeft, aStartX) + 2, top: lineY - 20, fontSize: 9, fontWeight: 700, color: startColor, whiteSpace: "nowrap", background: "rgba(255,255,255,0.85)", padding: "0 3px", borderRadius: 2 }}>start {dStart > 0 ? `+${dStart}d` : `${dStart}d`}</span>}
                      {dEnd !== 0 && <span className="mono" style={{ position: "absolute", left: Math.min(planLeft + planW, aEndX) + 2, top: lineY - 20, fontSize: 9, fontWeight: 700, color: endColor, whiteSpace: "nowrap", background: "rgba(255,255,255,0.85)", padding: "0 3px", borderRadius: 2 }}>end {dEnd > 0 ? `+${dEnd}d` : `${dEnd}d`}</span>}
                      {dStart > 0 && dEnd < dStart && <span className="mono" style={{ position: "absolute", left: aEndX + 4, top: lineY - 6, fontSize: 8, fontWeight: 700, color: "#0F6B5C", whiteSpace: "nowrap" }}>▲ {dStart - dEnd}d recovered</span>}
                    </div>
                  );
                })}

            {/* Feature boxes */}
            {displayFeatures.map((box) => {
              const meta = statusMetaOf(box.status, statuses);
              const left = xForDay(box.x);
              const width = Math.max(box.duration * dayWidth, 34);
              const top = box.y;
              const hasChildren = Array.isArray(box.children) && box.children.length > 0;
              const expanded = hasChildren && !box.collapsed && !epicsShrunk;
              const bodyHeight = 18 + clamp(workOf(box, graph) / graph.workPerStep, 1, 24) * graph.stepPx;
              const height = epicsShrunk ? 26 : boxHeight(box, graph);
              const unassigned = !box.resources || box.resources.length === 0;
              const selected = selectedId === box.id;
              const dragOver = dragOverBoxId === box.id;
              const matchesRes = !filterResource || (box.resources || []).includes(filterResource) || (box.children || []).some((c) => (c.resources || []).includes(filterResource));
              const matchesQuery = !q || (box.title || "").toLowerCase().includes(q) || (box.children || []).some((c) => (c.title || "").toLowerCase().includes(q));
              const matchesStatus = featureStatusFilter.size === 0 || featureStatusFilter.has(box.status);
              const matchesEpic = epicFilter.size === 0 || (box.epicId != null && epicFilter.has(box.epicId));
              const matches = matchesRes && matchesQuery && matchesStatus && matchesEpic;
              const est = estimateEffort(box, graph);
              const assigned = assignedEffort(box);
              const coverage = Math.round((assigned / Math.max(0.1, est)) * 100);
              // Every leaf/collapsed box gets the full-detail hover card, so the
              // behaviour is consistent regardless of the box's size and the
              // md/allocation figures are always reachable. Expanded boxes are
              // excluded — they already list their subtasks and assignees inline.
              const showHover = !expanded;

              return (
                <div
                  key={box.id}
                  onPointerDown={(e) => startBoxInteraction(box, e)}
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerEnter={(e) => { if (!coarse && showHover && !dragId && !isPanning) setHoverCard({ x: e.clientX, y: e.clientY, box }); }}
                  onPointerLeave={() => { if (!coarse) setHoverCard((h) => (h && h.box.id === box.id ? null : h)); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverBoxId(box.id);
                  }}
                  onDragLeave={() => setDragOverBoxId((id) => (id === box.id ? null : id))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const rid = e.dataTransfer.getData("text/plain");
                    if (rid && canEdit && box.status !== "done") void usePulseStore.getState().assignResource(box.id, rid);
                    setDragOverBoxId(null);
                    // Deliberately doesn't call onSelect() here — assigning
                    // a resource by drag-and-drop shouldn't switch the left
                    // panel away from the Team tab the user is dragging
                    // from, especially mid-assigning several people.
                  }}
                  style={{
                    position: "absolute",
                    left,
                    top,
                    width,
                    height,
                    background: meta.bg,
                    border: `2px ${unassigned ? "dashed" : "solid"} ${dragOver ? "#EE7240" : meta.border}`,
                    borderRadius: 8,
                    boxShadow: dragOver ? "0 0 0 3px rgba(34,211,238,0.35)" : selected ? "0 0 0 2px #EE7240, 0 6px 14px rgba(15,23,42,.15)" : "0 1px 3px rgba(15,23,42,.08)",
                    cursor: dragId === box.id ? "grabbing" : "grab",
                    zIndex: dragId === box.id ? 30 : selected ? 20 : 10,
                    userSelect: "none",
                    overflow: "hidden",
                    touchAction: "none",
                    opacity: matches ? 1 : 0.22,
                    filter: matches ? "none" : "grayscale(0.4)",
                    transition: "opacity .15s",
                  }}
                >
                  {filterResource && matches && !unassigned && (
                    <div
                      title={resourceById[filterResource]?.name}
                      style={{ position: "absolute", top: 0, right: 0, background: colorForName(filterResource), color: "#fff", fontSize: 8, fontWeight: 700, padding: "1px 4px", borderBottomLeftRadius: 5 }}
                      className="mono"
                    >
                      {resourceById[filterResource]?.initials ?? filterResource}
                    </div>
                  )}
                  {unassigned && <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(135deg, rgba(148,163,184,0.18) 0 6px, transparent 6px 12px)", pointerEvents: "none" }} />}
                  {box.labelColor && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, background: box.labelColor, pointerEvents: "none" }} />}
                  <div className="flex items-center justify-between px-2" style={{ height: 28, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
                    <div className="flex items-center gap-1 overflow-hidden">
                      {hasChildren && (
                        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => toggleCollapsed(box, e)} className="flex-shrink-0 flex items-center justify-center" title={expanded ? "Collapse subtasks" : "Expand subtasks"} style={{ width: 22, height: 22, borderRadius: 5, background: hexA(meta.border, 0.15), marginRight: 2 }}>
                          <span style={{ fontSize: 17, color: meta.border, lineHeight: 1 }}>{expanded ? "▾" : "▸"}</span>
                        </button>
                      )}
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: staffingColor(box, graph), flexShrink: 0, border: "1px solid rgba(255,255,255,0.7)", boxShadow: "0 0 0 1px rgba(15,23,42,0.1)" }} />
                      {box.labelColor && <span style={{ width: 10, height: 10, borderRadius: 2, background: box.labelColor, flexShrink: 0 }} />}
                      <span className="text-xs font-semibold truncate" title={box.title} style={{ color: "#1F2330" }}>{box.title}</span>
                    </div>
                    {box.plannedX != null && <span className="flex-shrink-0" title="Baseline plan set" style={{ fontSize: 10 }}>📌</span>}
                    {(box.attachments || []).length > 0 && <span className="mono flex-shrink-0" style={{ fontSize: 9, color: "#D85A28" }}>📎{box.attachments!.length}</span>}
                    {box.ai && <span style={{ fontSize: 12, color: "#8B5CF6" }} className="flex-shrink-0">✨</span>}
                    {box.status === "done" && <span className="flex-shrink-0" title="Done — locked. Change its status to edit." style={{ fontSize: 11 }}>🔒</span>}
                  </div>
                  {epicsShrunk ? null : !expanded ? (
                    <div className="px-2 py-1.5 flex flex-col justify-end" style={{ height: bodyHeight, position: "relative" }}>
                      <div className="mono" style={{ position: "absolute", top: 2, right: 4, fontSize: 9, fontWeight: 700, color: meta.text, opacity: 0.6, pointerEvents: "none" }}>{Math.round(workOf(box, graph) * 10) / 10}/d</div>
                      {/* Bottom line: assignee badges on the left, assignment %
                          (assigned effort ÷ estimate) on the right. Thin/short
                          boxes that can't fit both clip here and reveal the full
                          detail via the hover card (see hoverCard render below). */}
                      <div className="flex items-center justify-between gap-1" style={{ position: "relative", zIndex: 1 }}>
                        <div className="flex items-center gap-1" style={{ overflow: "hidden", minWidth: 0 }}>
                          {(box.resources || []).map((r) => {
                            const lead = box.lead === r;
                            return (
                              <span
                                key={r}
                                title={resourceById[r]?.name}
                                className="mono"
                                style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: colorForName(r), width: 17, height: 17, borderRadius: lead ? 4 : "50%", border: lead ? "2px solid #F5A524" : "none", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                              >
                                {resourceById[r]?.initials ?? r}
                              </span>
                            );
                          })}
                        </div>
                        <span className="mono flex-shrink-0" title={`${assigned}md assigned of ${est}md estimated`} style={{ fontSize: 9, fontWeight: 700, color: meta.text, opacity: 0.8 }}>{coverage}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="px-2 py-1" style={{ overflow: "hidden" }}>
                      {box.children!.map((c) => {
                        const cm = statusMetaOf(c.status, statuses);
                        const resp = c.resources?.[0] ? resourceById[c.resources[0]] : null;
                        return (
                          <div key={c.id} className="flex items-center gap-1.5" style={{ height: 27, borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: cm.border, flexShrink: 0 }} />
                            <span className="text-xs truncate flex-1" title={c.title} style={{ color: "#334155" }}>{c.title}</span>
                            {resp ? (
                              <span className="mono" title={resp.name} style={{ fontSize: 8, fontWeight: 700, color: "#fff", background: colorForName(resp.id), width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{resp.initials}</span>
                            ) : (
                              <span className="mono" style={{ fontSize: 9, color: "#9F1D23", flexShrink: 0 }}>—</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {canEdit && box.status !== "done" && (
                    <>
                      <div onPointerDown={(e) => startDrag("resize-left", box, e)} style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize" }} />
                      <div onPointerDown={(e) => startDrag("resize-right", box, e)} style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 7, cursor: "col-resize" }} />
                      {!expanded && (
                        <div onPointerDown={(e) => startDrag("resize-effort", box, e)} title="Drag to change work (height)" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 12, cursor: "ns-resize", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 1 }}>
                          <div style={{ width: 26, height: 3, borderRadius: 2, background: meta.border, opacity: 0.5 }} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {dimHint && (
        <div className="mono fixed pointer-events-none px-2 py-1 rounded text-xs font-semibold" style={{ left: dimHint.x + 14, top: dimHint.y + 14, background: "#123359", color: "#F0A875", border: "1px solid #EE7240", zIndex: 100 }}>
          {dimHint.text}
        </div>
      )}

      {hoverCard && !dimHint && (() => {
        const hb = hoverCard.box;
        const hm = statusMetaOf(hb.status, statuses);
        const hEst = estimateEffort(hb, graph);
        const hAssigned = assignedEffort(hb);
        const hCov = Math.round((hAssigned / Math.max(0.1, hEst)) * 100);
        const hRes = hb.resources || [];
        return (
          <div className="fixed pointer-events-none rounded-lg" style={{ left: hoverCard.x + 14, top: hoverCard.y + 14, maxWidth: 260, background: "#123359", border: "1px solid #EE7240", padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", zIndex: 100 }}>
            <div className="text-xs font-semibold" style={{ color: "#F7F6F2", marginBottom: 3 }}>{hb.title}</div>
            <div className="mono" style={{ fontSize: 9, color: hm.border, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>{hm.label}</div>
            <div className="mono" style={{ fontSize: 10, color: "#F0A875", marginBottom: hRes.length ? 6 : 0 }}>{hEst}md est · {hAssigned}md assigned · {hCov}%</div>
            {hRes.length === 0 ? (
              <div className="mono" style={{ fontSize: 10, color: "#9FB3C8" }}>No one assigned</div>
            ) : (
              <div className="flex flex-col gap-1">
                {hRes.map((r) => {
                  const lead = hb.lead === r;
                  return (
                    <div key={r} className="flex items-center gap-1.5">
                      <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: colorForName(r), width: 16, height: 16, borderRadius: lead ? 4 : "50%", border: lead ? "2px solid #F5A524" : "none", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {resourceById[r]?.initials ?? r}
                      </span>
                      <span className="text-xs" style={{ color: "#E2E8F0" }}>{resourceById[r]?.name ?? r}</span>
                      <span className="mono flex-shrink-0" style={{ fontSize: 9, color: "#94A3B8", marginLeft: "auto" }}>{allocOf(hb.alloc, r)}%</span>
                      {lead && <span className="mono flex-shrink-0" style={{ fontSize: 8, color: "#F5A524" }}>lead</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
});
