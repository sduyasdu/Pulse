import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPulseView, isValidView, loadPulseView, pruneViews, savePulseView, type SavedPulseView } from "./pulseView";

const view = (over: Partial<SavedPulseView> = {}): SavedPulseView => ({
  offsetX: -1234, scrollTop: 200, density: "week", viewZoom: 1, at: 1000, ...over,
});

/** jsdom in this project runs without localStorage, so stand one up. */
function installStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
  return map;
}

beforeEach(() => {
  installStorage();
});

describe("remembering where you were", () => {
  it("round-trips a view", () => {
    savePulseView("p1", { offsetX: -900, scrollTop: 120, density: "month", viewZoom: 1.5 });
    expect(loadPulseView("p1")).toMatchObject({ offsetX: -900, scrollTop: 120, density: "month", viewZoom: 1.5 });
  });

  it("keeps Pulses apart", () => {
    savePulseView("p1", { offsetX: -100, scrollTop: 0, density: "day", viewZoom: 1 });
    savePulseView("p2", { offsetX: -200, scrollTop: 0, density: "month", viewZoom: 2 });
    expect(loadPulseView("p1")?.density).toBe("day");
    expect(loadPulseView("p2")?.density).toBe("month");
  });

  it("returns null for a Pulse never visited, and for no Pulse at all", () => {
    expect(loadPulseView("nope")).toBeNull();
    expect(loadPulseView(null)).toBeNull();
    expect(loadPulseView(undefined)).toBeNull();
  });

  it("forgets a deleted Pulse without disturbing the others", () => {
    savePulseView("p1", { offsetX: -100, scrollTop: 0, density: "day", viewZoom: 1 });
    savePulseView("p2", { offsetX: -200, scrollTop: 0, density: "week", viewZoom: 1 });
    forgetPulseView("p1");
    expect(loadPulseView("p1")).toBeNull();
    expect(loadPulseView("p2")).not.toBeNull();
  });
});

// Stored state outlives deploys, so it will be read by code that didn't write
// it. A bad offsetX scrolls the canvas into empty space with no way back short
// of clearing storage by hand, which is not something a user can be asked to do.
describe("refusing views we couldn't act on", () => {
  it("accepts a well-formed one", () => {
    expect(isValidView(view())).toBe(true);
  });

  it.each([
    ["a density that no longer exists", view({ density: "fortnight" as never })],
    ["a non-finite offset", view({ offsetX: Number.NaN })],
    ["an infinite offset", view({ offsetX: Number.POSITIVE_INFINITY })],
    ["a negative scroll", view({ scrollTop: -5 })],
    ["a zero zoom, which would divide by zero", view({ viewZoom: 0 })],
    ["a zoom beyond any the UI offers", view({ viewZoom: 99 })],
    ["a missing timestamp", { ...view(), at: undefined } as unknown],
    ["not an object at all", "week"],
    ["null", null],
  ])("rejects %s", (_label, bad) => {
    expect(isValidView(bad)).toBe(false);
  });

  it("drops a corrupt entry on read rather than returning it", () => {
    localStorage.setItem("pulse.view.v1", JSON.stringify({ p1: { offsetX: "left" }, p2: view() }));
    expect(loadPulseView("p1")).toBeNull();
    expect(loadPulseView("p2")).not.toBeNull();
  });

  it("survives unparseable storage", () => {
    localStorage.setItem("pulse.view.v1", "{not json");
    expect(loadPulseView("p1")).toBeNull();
  });

  it("never writes what it would refuse to read", () => {
    savePulseView("p1", { offsetX: Number.NaN, scrollTop: 0, density: "week", viewZoom: 1 });
    expect(loadPulseView("p1")).toBeNull();
  });
});

describe("pruning", () => {
  it("keeps the most recent and drops the rest", () => {
    const all: Record<string, SavedPulseView> = {};
    for (let i = 0; i < 10; i++) all[`p${i}`] = view({ at: i });
    const kept = pruneViews(all, 3);
    expect(Object.keys(kept).sort()).toEqual(["p7", "p8", "p9"]);
  });

  it("drops invalid entries while pruning, so they can't occupy a slot", () => {
    const kept = pruneViews({ good: view({ at: 2 }), bad: { offsetX: "x" }, alsoGood: view({ at: 1 }) }, 5);
    expect(Object.keys(kept).sort()).toEqual(["alsoGood", "good"]);
  });

  it("tolerates junk where the whole map should be", () => {
    expect(pruneViews("nonsense")).toEqual({});
    expect(pruneViews(null)).toEqual({});
  });

  // Otherwise a long-lived account accumulates an entry per Pulse forever, in a
  // store with a hard size limit shared with everything else on the origin.
  it("bounds what a save can grow the store to", () => {
    for (let i = 0; i < 80; i++) savePulseView(`p${i}`, { offsetX: -i, scrollTop: 0, density: "week", viewZoom: 1 });
    const stored = JSON.parse(localStorage.getItem("pulse.view.v1") ?? "{}");
    expect(Object.keys(stored).length).toBe(50);
    // The one just written must be among the survivors.
    expect(stored.p79).toBeTruthy();
  });
});
