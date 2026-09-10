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
import { usePulseStore } from "@/stores/pulseStore";
import { todayIndex } from "@/domain/dateUtils";
import type { Feature, Resource } from "@/types";
import { PulseLockup } from "@/components/shared/Logo";
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
        <PulseLockup variant="dark" size={16} />
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
 * The sign-in page, as the router mounts it. The one page a prospective
 * customer sees before deciding, so a horizontal scrollbar on it is worse than
 * one anywhere else — and it is now a two-column layout with an illustration,
 * which is exactly the shape that overflows.
 */
function LoginScene() {
  return <LoginPage />;
}

const SCENES = { toolbar: ToolbarScene, dashboard: DashboardScene, login: LoginScene, team: TeamScene };
export type SceneName = keyof typeof SCENES;

interface Measurement {
  /** What the page thinks the window is. The driver asserts this matches the
   * width it asked for — a viewport override that silently fails would make
   * every number below a measurement of the wrong thing. */
  clientWidth: number;
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
  return {
    clientWidth: limit,
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
