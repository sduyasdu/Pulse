/**
 * Layout probe — does a header actually FIT at a given viewport width?
 *
 * `tsc`, the unit tests and the build all pass while a toolbar overflows its
 * viewport: nothing in this project lays anything out. jsdom has no layout
 * engine, so `clientWidth` is 0 everywhere and a test asserting "it fits" would
 * pass against a toolbar three times too wide.
 *
 * So this renders the REAL `Toolbar` — the same component the Pulse page
 * mounts, not a copy of its markup — into a series of fixed-width containers,
 * and measures `scrollWidth` against `clientWidth` for each row. Chrome runs it
 * headless and `measure.mjs` reads the report out of the DOM.
 *
 * Fixed-width containers rather than real viewport resizes, deliberately: the
 * toolbar's layout is inline styles and unprefixed Tailwind utilities with no
 * `@media` rules of its own, so a 900px-wide box lays out exactly as a 900px
 * viewport would. The one thing that IS viewport-driven — the 767px mobile
 * cutoff in `useIsMobile` — is a JS media query that swaps the whole page for
 * `MobilePulseView`, so widths below it never render this toolbar at all and
 * are not probed.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Toolbar } from "@/components/canvas/Toolbar";
import { useI18nStore } from "@/stores/i18nStore";
import { ensureDict } from "@/i18n/dictionaries";
import { SUPPORTED_LANGS, type Lang } from "@/i18n/langs";
import "@/index.css";

/** The desktop range: the mobile cutoff is 767px, so 768 is the narrowest
 * viewport that ever renders this toolbar. The rest are common laptop and
 * monitor widths, plus a window docked to half of each. */
const WIDTHS = [768, 900, 1024, 1152, 1280, 1440, 1512, 1680, 1920, 2560];

/**
 * Pulse names to probe. The name input's width is computed from the character
 * count with no cap, and it sits in the row that cannot wrap — so the name is
 * an input to whether the toolbar fits, not decoration.
 */
const NAMES = [
  { label: "short", value: "Roadmap" },
  { label: "typical", value: "Q3 Platform Roadmap" },
  { label: "long", value: "Q3 Platform Roadmap — Payments, Billing and Identity" },
];

const noop = () => {};

const OPTIONS = [
  { id: "e1", name: "Platform foundations", color: "#8B5CF6" },
  { id: "e2", name: "Billing", color: "#3B82F6" },
];

/** An owner on the canvas — every control present, which is the case that has
 * to fit. */
function probeToolbar(archived: boolean, pulseName: string) {
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
      epicOptions={OPTIONS}
      statusOptions={OPTIONS}
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
      archived={archived}
      helpOpen={false}
      onToggleHelp={noop}
    />
  );
}

interface RowResult {
  width: number;
  lang: string;
  name: string;
  rows: { row: number; overflow: number }[];
}

/**
 * How far past its container the row's content actually reaches.
 *
 * `scrollWidth - clientWidth` is NOT enough on its own. A flex row whose items
 * overflow does not always grow its own scrollable area the way a block does,
 * and reading only that reported "fits" for every width — including ones that
 * visibly did not. So this also walks the row's children and takes the furthest
 * right edge, which is what a reader actually sees running off the screen.
 */
function overflowOf(row: HTMLElement): number {
  const box = row.getBoundingClientRect();
  let furthest = box.right;
  for (const child of Array.from(row.children)) {
    furthest = Math.max(furthest, (child as HTMLElement).getBoundingClientRect().right);
  }
  return Math.round(Math.max(row.scrollWidth - row.clientWidth, furthest - box.right));
}

function Probe() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const results = useRef<RowResult[]>([]);
  const dictVersion = useI18nStore((s) => s.dictVersion);

  // Load every dictionary up front, then walk the languages one at a time. The
  // non-English dictionaries are dynamically imported, so measuring before one
  // has landed would measure English strings under a German label.
  useEffect(() => {
    void Promise.all(SUPPORTED_LANGS.map((l) => ensureDict(l))).then(() => setReady(true));
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !ready || done) return;
    for (const box of Array.from(host.querySelectorAll<HTMLElement>("[data-probe-width]"))) {
      const root = box.firstElementChild as HTMLElement | null;
      if (!root) continue;
      results.current.push({
        width: Number(box.dataset.probeWidth),
        lang,
        name: box.dataset.probeName ?? "",
        rows: Array.from(root.children).map((el, i) => ({ row: i + 1, overflow: overflowOf(el as HTMLElement) })),
      });
    }
    // Self-check: a row that provably cannot fit, measured by the same code.
    // Without it "fits" is unfalsifiable — the first version of this probe
    // reported "fits" for every width and language, and it was measuring
    // nothing at all. Overflow inside the toolbar is only believable as an
    // absence once this is present.
    const control = host.parentElement?.querySelector<HTMLElement>("[data-probe-control] > *");
    if (control && !results.current.some((r) => r.name === "CONTROL")) {
      results.current.push({ width: 768, lang: "--", name: "CONTROL", rows: [{ row: 1, overflow: overflowOf(control) }] });
    }

    const next = SUPPORTED_LANGS[SUPPORTED_LANGS.indexOf(lang) + 1];
    if (next) {
      useI18nStore.getState().setLang(next);
      setLang(next);
      return;
    }
    const el = document.getElementById("report");
    if (el) el.textContent = JSON.stringify(results.current);
    setDone(true);
  }, [ready, lang, done, dictVersion]);

  return (
    <>
      <pre id="report" data-done={done ? "1" : "0"} />
      {/* The self-check's subject: one flex row, 768px wide, holding an item
          that refuses to shrink and is far too wide for it. Outside `hostRef`
          so it is never mistaken for a toolbar measurement. */}
      <div data-probe-control style={{ width: 768, overflow: "visible" }}>
        <div style={{ display: "flex" }}>
          <div style={{ width: 2000, flexShrink: 0, height: 1 }} />
        </div>
      </div>
      <div ref={hostRef}>
        {NAMES.map((n) =>
          WIDTHS.map((w) => (
            <div
              key={`${n.label}-${w}`}
              data-probe-width={w}
              data-probe-name={n.label}
              // `overflow: visible` on purpose: clipping would hide the very
              // thing being measured.
              style={{ width: w, overflow: "visible", marginBottom: 8 }}
            >
              {probeToolbar(false, n.value)}
            </div>
          )),
        )}
      </div>
    </>
  );
}

// No StrictMode: its deliberate double-invocation would run the measuring
// layout effect twice per language and double every row in the report.
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Probe />
  </MemoryRouter>,
);
