import type { Density } from "@/domain/constants";

/**
 * Where you were last looking in a Pulse, so re-opening it puts you back
 * rather than at today with the default period.
 *
 * Per-device by design, hence localStorage rather than the user doc: which
 * fortnight you had scrolled to on your laptop is not a fact about you, and
 * syncing it would make two open machines fight over the viewport — and cost a
 * Firestore write on every pan.
 */
export interface SavedPulseView {
  /** Canvas-pixel offset, pre-zoom — the same units `offsetX` uses. */
  offsetX: number;
  /** Vertical scroll of the canvas container, in screen pixels. */
  scrollTop: number;
  density: Density;
  viewZoom: number;
  /**
   * Cycles collapsed to their header on the board, by cycle id.
   *
   * **Optional, and it has to stay that way.** `isValidView` is an all-or-
   * nothing gate: every entry already in someone's storage was written without
   * this field, so requiring it would fail them all and quietly throw away the
   * viewport of every user who has ever opened a Beat. Absent means "nothing
   * collapsed", which is also what a first-time reader should see.
   *
   * Ids of cycles that no longer exist are harmless — they match nothing — and
   * are left alone rather than swept, because pruning them would need the
   * Beat's cycles at a point where this module only has storage.
   */
  collapsedCycles?: string[];
  /** For pruning; also lets a stale entry be recognised later if that ever
   * matters. */
  at: number;
}

const KEY = "pulse.view.v1";
/** Enough that returning to anything you have touched recently works, small
 * enough that the entry never becomes a storage problem for someone with a
 * long history of Pulses. */
const MAX_ENTRIES = 50;

const DENSITIES: Density[] = ["day", "week", "month"];

/**
 * Reject anything that isn't a view we could act on.
 *
 * Stored view state is the one input here that survives a deploy, so it will
 * eventually be read by code that didn't write it: a renamed density, a zoom
 * range that changed, a half-written entry from a killed tab. A bad `offsetX`
 * would scroll the canvas into empty space with no way back except clearing
 * storage by hand, so anything unrecognisable is dropped rather than coerced.
 */
export function isValidView(v: unknown): v is SavedPulseView {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.offsetX === "number" && Number.isFinite(o.offsetX) &&
    typeof o.scrollTop === "number" && Number.isFinite(o.scrollTop) && o.scrollTop >= 0 &&
    typeof o.viewZoom === "number" && Number.isFinite(o.viewZoom) && o.viewZoom > 0 && o.viewZoom <= 8 &&
    typeof o.density === "string" && DENSITIES.includes(o.density as Density) &&
    typeof o.at === "number" && Number.isFinite(o.at) &&
    // Optional: absent is valid and means nothing is collapsed. Present and
    // malformed is not — a non-array here would reach `new Set(...)` and throw
    // on the render that restores it.
    (o.collapsedCycles === undefined ||
      (Array.isArray(o.collapsedCycles) && o.collapsedCycles.every((c) => typeof c === "string")))
  );
}

/** Drop invalid entries and keep only the most recent `MAX_ENTRIES`. Exported
 * for the tests; callers go through load/save. */
export function pruneViews(raw: unknown, max = MAX_ENTRIES): Record<string, SavedPulseView> {
  if (!raw || typeof raw !== "object") return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(([, v]) => isValidView(v)) as [string, SavedPulseView][];
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, max));
}

function readAll(): Record<string, SavedPulseView> {
  try {
    return pruneViews(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    // Unparseable, or storage unavailable (private windows, storage disabled).
    // Losing a viewport is not worth an error path — the caller falls back to
    // today, which is where it always used to land.
    return {};
  }
}

export function loadPulseView(pulseId: string | null | undefined): SavedPulseView | null {
  if (!pulseId) return null;
  return readAll()[pulseId] ?? null;
}

export function savePulseView(pulseId: string | null | undefined, view: Omit<SavedPulseView, "at">): void {
  if (!pulseId) return;
  const next: SavedPulseView = { ...view, at: Date.now() };
  if (!isValidView(next)) return; // never write what we would refuse to read
  try {
    const all = readAll();
    all[pulseId] = next;
    localStorage.setItem(KEY, JSON.stringify(pruneViews(all)));
  } catch {
    // Quota exceeded or storage unavailable — the viewport is not worth
    // failing an interaction over.
  }
}

/** Forget one Pulse's view — used when a Pulse is deleted, so its entry doesn't
 * sit in storage forever holding a slot. */
export function forgetPulseView(pulseId: string): void {
  try {
    const all = readAll();
    if (!(pulseId in all)) return;
    delete all[pulseId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
}
