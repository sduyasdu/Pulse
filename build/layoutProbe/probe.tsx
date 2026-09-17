/**
 * Layout probe — does the page fit the display it is rendered on?
 *
 * `tsc`, the unit tests and the build all pass while a page runs wider than the
 * screen: the unit tests run on jsdom, which has no layout engine, so every
 * `clientWidth` is 0 and an assertion that something fits passes against
 * anything at all.
 *
 * So this renders REAL components — the ones the app mounts, not copies of
 * their markup — and `measure.mjs` drives Chrome through a range of viewport
 * widths, asking after each one: is the document wider than the window?
 *
 * Real viewport resizes, not fixed-width boxes. The first version of this probe
 * used fixed-width containers, which is fine for the toolbar (inline styles, no
 * media queries) but silently wrong for anything using Tailwind's `sm:`/`lg:`
 * breakpoints — those match on the VIEWPORT, so a 1400px box inside an 800px
 * window still lays out at the 800px breakpoint. The dashboard grid is exactly
 * that case, and it is the one that overflows.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Toolbar } from "@/components/canvas/Toolbar";
import { PulseCard } from "@/components/dashboard/PulseCard";
import { LoginPage } from "@/routes/LoginPage";
import { TeamTab } from "@/components/leftPanel/TeamTab";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { buildCycleBoard } from "@/domain/cycleBoard";
import { statusMetaOf, qualificationOf } from "@/domain/constants";
import type { Cycle, Epic } from "@/types";
import { usePulseStore } from "@/stores/pulseStore";
import { todayIndex } from "@/domain/dateUtils";
import type { Feature, Resource } from "@/types";
import { BeatsLockup } from "@/components/shared/Logo";
import { Icon } from "@/components/shared/Icon";
import { useI18nStore } from "@/stores/i18nStore";
import { ensureDict } from "@/i18n/dictionaries";
import { SUPPORTED_LANGS, type Lang } from "@/i18n/langs";
import type { MyPulseIndexEntry } from "@/types";
import "@/index.css";

const noop = () => {};

/**
 * Pulse names to probe.
 *
 * `unbroken` is the point of the exercise, not an exotic edge case: a grid item
 * has `min-width: auto`, which resolves to its MIN-CONTENT width — the longest
 * word that cannot be broken. A name with no spaces therefore sets a floor on
 * its column, on the grid, and so on the page. People name Pulses like this
 * routinely, and nothing in the product stops them.
 */
const NAMES = [
  { label: "short", value: "Roadmap" },
  { label: "typical", value: "Q3 Platform Roadmap" },
  { label: "long", value: "Q3 Platform Roadmap — Payments, Billing and Identity" },
  { label: "unbroken", value: "Q3-Platform-Roadmap-Payments-Billing-Identity-Migration" },
];

const entryFor = (name: string, i: number): MyPulseIndexEntry =>
  ({ pulseId: `p${i}`, name, workspaceId: "w1", role: "owner", joinedAt: null, createdAt: Date.UTC(2026, 6, 2) }) as unknown as MyPulseIndexEntry;

/** The Pulse toolbar, as PulsePage mounts it for an owner on the canvas. */
function ToolbarScene({ pulseName }: { pulseName: string }) {
  return (
    <Toolbar
      pulseName={pulseName}
      onRenamePulse={noop}
      onInvite={noop}
      commentsOpen={false}
      onToggleComments={noop}
      presence={<div style={{ width: 84, height: 28 }} />}
      notifications={<div style={{ width: 32, height: 32 }} />}
      viewMode="canvas"
      setViewMode={noop}
      viewZoom={1}
      onZoomIn={noop}
      onZoomOut={noop}
      density="week"
      setDensity={noop}
      onResetView={noop}
      onFitRoadmap={noop}
      referenceDay={20000}
      onGoToday={noop}
      onReferenceDayChange={noop}
      onUndo={noop}
      onRedo={noop}
      canUndo
      canRedo
      featureQuery=""
      setFeatureQuery={noop}
      featureStatusFilter={new Set()}
      setFeatureStatusFilter={noop}
      epicFilter={new Set()}
      setEpicFilter={noop}
      compactFilter
      onToggleCompactFilter={noop}
      myPulse={false}
      onToggleMyPulse={noop}
      canMyPulse
      cycleFilter={new Set()}
      setCycleFilter={noop}
      // Two cycles, so the CY13 control actually renders and gets measured: it
      // hides itself on a single-cycle Beat, and a control the probe cannot see
      // is a control the probe cannot clear.
      cycleOptions={[{ id: "std", name: "Standard" }, { id: "rev", name: "Design review" }]}
      epicOptions={[{ id: "e1", name: "Platform foundations", color: "#8B5CF6" }]}
      statusOptions={[{ id: "s1", name: "Planned", color: "#8B5CF6" }]}
      showDelays={false}
      setShowDelays={noop}
      epicsShrunk={false}
      onToggleShrinkEpics={noop}
      onCompact={noop}
      onAddEpic={noop}
      onAddTask={noop}
      graph={{ stepPx: 24, workPerStep: 1 }}
      onSetGraphConfig={noop}
      canEdit
      roleLabel="Owner"
      helpOpen={false}
      onToggleHelp={noop}
    />
  );
}

/** The dashboard, with the same header and grid classes DashboardPage uses. */
function DashboardScene({ pulseName }: { pulseName: string }) {
  return (
    <div className="min-h-screen bg-yasdu-bg">
      <header className="flex items-center gap-3 border-b px-6 py-3" style={{ borderColor: "#E2DFD9", background: "#123359" }}>
        <BeatsLockup variant="dark" size={16} />
        <div className="flex-1" />
        <span data-right-edge className="flex items-center justify-center rounded" style={{ width: 30, height: 30, color: "#EE7240" }}>
          <Icon name="help" size={18} />
        </span>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <PulseCard
              key={i}
              entry={entryFor(pulseName, i)}
              onRenameClick={noop}
              onInviteClick={noop}
              onDuplicateClick={noop}
              onHide={noop}
              onUnhide={noop}
              onArchive={noop}
              onUnarchive={noop}
              onDelete={noop}
              onLeave={noop}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * The Team tab, in the 320px column the Pulse page gives it.
 *
 * A fixed-width box is faithful here in a way it is not for the dashboard: this
 * panel is 320px at every viewport, and the tab is inline styles and
 * unprefixed utilities with no `@media` rules of its own. The document-level
 * overflow check cannot see inside a 320px panel on a 1440px page, so what this
 * scene is really for is the screenshot.
 */
function TeamScene() {
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    const person = (id: string, name: string, over: Partial<Resource> = {}): Resource =>
      ({ id, name, initials: name.slice(0, 2).toUpperCase(), capacity: 100, ...over }) as Resource;
    const task = (id: string, rid: string, x: number, duration: number, pct: number): Feature =>
      ({ id, title: id, x, duration, y: 0, work: 1, status: "planned", resources: [rid], alloc: { [rid]: pct } }) as unknown as Feature;
    // The app's own day index, not a hand-rolled one — a different epoch put
    // every seeded task outside the load windows and drew three 0% bars, which
    // looks exactly like the bars being broken.
    const today = todayIndex();
    usePulseStore.setState({
      pulse: { id: "p1", name: "Q3", workspaceId: "w1", resourceTypes: ["Backend", "Design"] } as never,
      resources: [
        person("r1", "Ada Lovelace", { type: "Backend", role: "Engineer", linkedUid: "u9", linkedEmail: "ada@example.com" }),
        person("r2", "Grace Hopper", { type: "Design", capacity: 50, linkedEmail: "grace@example.com" }),
        person("r3", "Alan Turing"),
      ],
      features: [
        task("t1", "r1", today, 30, 160),
        task("t2", "r2", today, 20, 40),
      ],
      members: [{ uid: "u9", email: "ada@example.com", role: "editor", joinedAt: 0 } as never],
      rates: [],
    });
  }
  return (
    <div style={{ display: "flex", height: "100vh", background: "#F4F2EC" }}>
      <div style={{ width: 320, flexShrink: 0, background: "#FFFFFF", borderRight: "1px solid #E2DFD9", overflowY: "auto" }} data-team-panel>
        <TeamTab canEdit filterResource={null} setFilterResource={noop} />
      </div>
    </div>
  );
}


/**
 * PROTOTYPE — the board grouped by cycle (Cycles-Spec §8 q3).
 *
 * Renders `buildCycleBoard` output in the board's visual language, so the open
 * question can be looked at rather than argued about. Deliberately not wired
 * into KanbanView: the point is to see whether the arrangement reads, before
 * anyone pays for the integration.
 */
const PROTO_DONE = { id: "done", label: "Done", color: "#12A594" };
const PROTO_CYCLES: Cycle[] = [
  { id: "std", name: "Standard", statuses: [
    { id: "planned", label: "Planned", color: "#64748B" },
    { id: "in-progress", label: "In progress", color: "#F5A524" },
    { id: "blocked", label: "Blocked", color: "#E5484D" }, PROTO_DONE] },
  { id: "rev", name: "Design review", statuses: [
    { id: "planned", label: "Planned", color: "#64748B" },
    { id: "in-review", label: "In review", color: "#6366F1", qualifies: "ongoing" }, PROTO_DONE] },
  { id: "sup", name: "Support", statuses: [
    { id: "triage", label: "Triage", color: "#EC4899", qualifies: "planned" },
    { id: "in-progress", label: "Working", color: "#F5A524", qualifies: "ongoing" }, PROTO_DONE] },
  { id: "res", name: "Research", statuses: [
    { id: "planned", label: "Proposed", color: "#64748B" },
    { id: "in-progress", label: "Running", color: "#0EA5E9" }, PROTO_DONE] },
  { id: "ops", name: "Operations", statuses: [
    { id: "planned", label: "Queued", color: "#64748B" },
    { id: "in-progress", label: "Executing", color: "#22C55E" },
    { id: "blocked", label: "Waiting", color: "#E5484D", qualifies: "stalled" }, PROTO_DONE] },
];
const PROTO_EPICS: Epic[] = [
  { id: "e1", name: "Billing", color: "#8B5CF6", y0: 0, y1: 100 } as Epic,
  { id: "e2", name: "Onboarding", color: "#0EA5E9", y0: 0, y1: 100 } as Epic,
];
const protoTask = (id: string, title: string, status: string, cycleId: string, epicId: string, x = 0): Feature =>
  ({ id, title, status, cycleId, epicId, x, y: 0, duration: 4, work: 1, resources: [], ai: false }) as Feature;

const PROTO_TASKS: Feature[] = [
  protoTask("t1", "Migrate the rates model", "in-progress", "std", "e1", 1),
  protoTask("t2", "Invoice PDF layout", "planned", "std", "e1", 2),
  protoTask("t3", "Dunning emails", "blocked", "std", "e1", 3),
  protoTask("t4", "Seat counting", "done", "std", "e1", 0),
  protoTask("t5", "Welcome flow copy", "planned", "std", "e2", 4),
  protoTask("t6", "Empty-state illustrations", "in-review", "rev", "e2", 1),
  protoTask("t7", "Pricing page hero", "in-review", "rev", "e1", 2),
  protoTask("t8", "Icon set audit", "planned", "rev", "e2", 3),
  protoTask("t9", "Export fails on Safari", "triage", "sup", "e1", 1),
  protoTask("t10", "Slow board on 500 tasks", "in-progress", "sup", "e2", 2),
  protoTask("t11", "Pricing sensitivity study", "in-progress", "res", "e1", 1),
  protoTask("t12", "Churn interviews", "planned", "res", "e2", 2),
  protoTask("t13", "Quarterly access review", "blocked", "ops", "e1", 1),
  protoTask("t14", "Backup restore drill", "planned", "ops", "e2", 2),
];

function CycleBoardScene() {
  const board = buildCycleBoard(PROTO_TASKS, PROTO_EPICS, PROTO_CYCLES, false);
  const COL_W = 210;
  return (
    // The page is the viewport; the sections scroll inside it. Five cycles do
    // not fit, and the answer is to let them run below rather than to shrink
    // them — a section is only legible at one size.
    <div style={{ background: "#FDFCF8", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* The filter sits above the board and stays put while it scrolls, so
          what is being filtered is visible at the same time as the filter.
          It lists only the cycles the board is actually showing — a chip for a
          cycle with nothing in it filters to an empty board. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
        borderBottom: "1px solid #E2DFD9", background: "#FDFCF8", flexShrink: 0 }}>
        <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>CYCLE</span>
        {board.sections.map((sec, i) => (
          <span key={sec.cycleId} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999,
            border: "1px solid " + (i === 1 ? "#EE7240" : "#E2DFD9"),
            background: i === 1 ? "#FFF7F1" : "#FFFFFF", color: i === 1 ? "#D85A28" : "#64748B",
            fontWeight: i === 1 ? 600 : 400, whiteSpace: "nowrap" }}>
            {sec.name} <span className="mono" style={{ fontSize: 9, opacity: 0.7 }}>{sec.count}</span>
          </span>
        ))}
        <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>— empty means all</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {board.sections.map((section) => (
          <div key={section.cycleId} style={{ marginBottom: 20 }}>
            {board.grouped && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px 8px" }}>
                <span className="font-display" style={{ fontSize: 13, fontWeight: 700, color: "#1F2330" }}>{section.name}</span>
                <span className="mono" style={{ fontSize: 10, color: "#94A3B8" }}>{section.count} tasks</span>
                <div style={{ flex: 1, height: 1, background: "#E2DFD9" }} />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${board.slots}, ${COL_W}px)`, gap: 10, alignItems: "start" }}>
              {section.columns.map((col, i) => {
                const meta = statusMetaOf(col.status, PROTO_CYCLES.find((c) => c.id === section.cycleId)?.statuses);
                const terminal = col.status === "done";
                return (
                  <div key={col.status} style={{
                    gridColumn: terminal ? board.slots : i + 1,
                    borderRadius: 10, border: "1px solid #E2DFD9",
                    background: terminal ? "#FAFAF8" : "#FFFFFF", opacity: terminal ? 0.75 : 1, padding: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: meta.border, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{col.label}</span>
                      <span className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{col.count}</span>
                      <div style={{ flex: 1 }} />
                      {/* What this stage counts as when something summarises
                          across cycles. The label is the cycle's; this is the
                          meaning underneath it. */}
                      {!terminal && (
                        <span className="mono" style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.04em",
                          padding: "1px 4px", borderRadius: 3, background: "#F1F5F9", color: "#94A3B8" }}>
                          {qualificationOf(col.status, PROTO_CYCLES.find((c) => c.id === section.cycleId)?.statuses ?? [])}
                        </span>
                      )}
                    </div>
                    {col.groups.map((g) => (
                      <div key={String(g.epicId)} style={{ marginBottom: 6 }}>
                        <div className="mono" style={{ fontSize: 9, color: "#94A3B8", padding: "2px 0",
                          borderLeft: "2px solid " + (g.color ?? "#CBD5E1"), paddingLeft: 5 }}>{g.name}</div>
                        {g.tasks.map((t) => (
                          <div key={t.id} style={{ marginTop: 4, padding: "5px 7px", borderRadius: 6, background: meta.bg,
                            border: "1px solid " + meta.border + "44", fontSize: 11, color: "#1F2330",
                            textDecoration: terminal ? "line-through" : "none" }}>{t.title}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The notifications bell, open, with an alert and a message.
 *
 * The dropdown is 300px wide and its rows are text buttons, which the app's
 * global `button:hover { transform: scale(1.12) }` grows without reflowing —
 * so words spill past the panel. `shots.mjs` forces `:hover` on one to catch it,
 * because no static render and no jsdom test can.
 */
function BellScene() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", padding: 24, background: "#123359", height: "100vh" }}>
      <div data-bell>
        <NotificationsBell
          pulseId="p1"
          uid="u1"
          onOpenTask={noop}
          dark
          size={32}
          alert={{ text: "3 people are assigned past their own limit.", dismissKey: "probe.alert" }}
        />
      </div>
    </div>
  );
}

/**
 * The sign-in page, as the router mounts it. The one page a prospective
 * customer sees before deciding, so a horizontal scrollbar on it is worse than
 * one anywhere else — and it is now a two-column layout with an illustration,
 * which is exactly the shape that overflows.
 */
function LoginScene() {
  return <LoginPage />;
}

const SCENES = { toolbar: ToolbarScene, dashboard: DashboardScene, login: LoginScene, team: TeamScene, bell: BellScene, cycleBoard: CycleBoardScene };
export type SceneName = keyof typeof SCENES;

interface Measurement {
  /** What the page thinks the window is. The driver asserts this matches the
   * width it asked for — a viewport override that silently fails would make
   * every number below a measurement of the wrong thing. */
  clientWidth: number;
  /** Did the scene put anything on the page?
   *
   * An empty document fits every window, so a scene that threw during render
   * measures as a clean pass — the probe's own version of the bug it exists to
   * catch. `build/` is outside the type-checked project, so a required prop
   * added in `src` empties a scene here with nothing going red anywhere. */
  rendered: boolean;
  documentOverflow: number;
  offenders: { tag: string; cls: string; right: number; text: string; path: string }[];
}

/**
 * How far the document runs past the window, and what is doing it.
 *
 * The document-level number is the user's actual symptom — a horizontal
 * scrollbar on the window. The offender list is what makes it fixable: the
 * deepest elements whose right edge is past the window, which is the element
 * that set the floor rather than every ancestor stretched by it.
 */
function measure(): Measurement {
  const limit = document.documentElement.clientWidth;
  const offenders: Measurement["offenders"] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    const right = el.getBoundingClientRect().right;
    if (right <= limit + 1) continue;
    // Only the deepest: an ancestor is wide because its child is.
    if (Array.from(el.children).some((c) => (c as HTMLElement).getBoundingClientRect().right > limit + 1)) continue;
    // An unnamed <div class=""> tells you nothing on its own, and the widest
    // offenders are usually exactly that. The ancestor chain is what makes the
    // element findable in the source.
    const chain: string[] = [];
    for (let p = el.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) {
      const c = (p.className + "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      chain.unshift(p.tagName.toLowerCase() + (c ? "." + c : ""));
    }
    offenders.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className + "").slice(0, 40) || (el.getAttribute("style") ?? "").slice(0, 40),
      right: Math.round(right),
      text: (el.textContent ?? "").trim().slice(0, 24),
      path: chain.join(" > ").slice(0, 150),
    });
  }
  const root = document.getElementById("root");
  return {
    clientWidth: limit,
    // Deliberately a low bar — "the scene drew something" — rather than an
    // assertion about what. Anything tighter would be a second copy of each
    // scene's expected output, maintained in the driver.
    rendered: (root?.querySelectorAll("*").length ?? 0) > 5,
    documentOverflow: Math.round(document.documentElement.scrollWidth - limit),
    // Widest first, not first-in-document. Taking them in DOM order reported
    // elements a few pixels over while the one setting the page's real width
    // sat further down the list, unmentioned.
    offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 5),
  };
}

declare global {
  interface Window {
    __probe?: {
      ready: boolean;
      show: (scene: SceneName, lang: Lang, name: string) => void;
      measure: () => Measurement;
    };
  }
}

function Probe() {
  const [scene, setScene] = useState<SceneName>("toolbar");
  const [pulseName, setPulseName] = useState(NAMES[0].value);
  const [ready, setReady] = useState(false);
  useI18nStore((s) => s.dictVersion); // re-render when a dictionary lands

  useEffect(() => {
    void Promise.all(SUPPORTED_LANGS.map((l) => ensureDict(l))).then(() => setReady(true));
  }, []);

  useEffect(() => {
    window.__probe = {
      ready,
      show: (s, lang, name) => {
        useI18nStore.getState().setLang(lang);
        setScene(s);
        setPulseName(name);
      },
      measure,
    };
  }, [ready]);

  const Scene = SCENES[scene];
  return <Scene pulseName={pulseName} />;
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Probe />
  </MemoryRouter>,
);

export { NAMES };
