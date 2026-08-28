import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loading` is the gate that decides whether the canvas may paint, and the
 * canvas draws "This Pulse is empty / add a task" from `epics.length === 0 &&
 * features.length === 0` — which is also what those arrays hold before their
 * listeners have said anything.
 *
 * So clearing `loading` early doesn't show a half-drawn Pulse, it shows a
 * confident wrong answer: open a Pulse full of work and it invites you to
 * create the first task. That shipped, because the gate was the pulse doc and
 * the roster only, and `features` subscribes a whole server round trip behind
 * them (`fetchMembership` resolves the read scope first).
 *
 * These drive the real `load()` rather than a helper, because the bug was never
 * in the counting — it was in which listeners were counted.
 */

type Cb = (v: unknown) => void;
const cbs: Record<string, Cb> = {};
const capture = (name: string) => (_pulseId: string, cb: Cb) => {
  cbs[name] = cb;
  return () => {};
};

vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {} }));
vi.mock("@/services/firestore/pulses", () => ({
  subscribePulse: capture("pulse"),
  renamePulse: vi.fn(), updateGraphConfig: vi.fn(), updateResourceTypes: vi.fn(), updatePulseStatuses: vi.fn(),
}));
vi.mock("@/services/firestore/epics", () => ({
  subscribeEpics: capture("epics"),
  createEpic: vi.fn(), updateEpic: vi.fn(), deleteEpic: vi.fn(), newEpicId: () => "e1",
}));
vi.mock("@/services/firestore/resources", () => ({
  subscribeResources: capture("resources"),
  createResource: vi.fn(), updateResource: vi.fn(), deleteResource: vi.fn(), newResourceId: () => "r1",
  makeInitials: () => "AB",
}));
vi.mock("@/services/firestore/features", () => ({
  // Note the different shape: beatUid sits between the callback and onError.
  subscribeFeatures: (_p: string, cb: Cb) => { cbs.features = cb; return () => {}; },
  createFeature: vi.fn(), updateFeature: vi.fn(), deleteFeature: vi.fn(), newFeatureId: () => "f1",
}));
vi.mock("@/services/firestore/memberships", () => ({
  subscribePulseMembers: capture("members"),
  // Resolves on a later microtask, as the real server read does — that gap is
  // the whole bug.
  fetchMembership: () => Promise.resolve(null),
}));
vi.mock("@/services/firestore/costs", () => ({
  subscribeCosts: capture("costs"),
  createCost: vi.fn(), updateCost: vi.fn(), deleteCost: vi.fn(), newCostId: () => "c1",
}));
vi.mock("@/services/firestore/rates", () => ({
  subscribeRates: capture("rates"), setResourceRate: vi.fn(), deleteResourceRate: vi.fn(),
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: { getState: () => ({ firebaseUser: { uid: "u1" } }) },
}));

const { usePulseStore } = await import("./pulseStore");

/** Let the async read-scope resolution inside `load()` settle so the features
 * listener actually exists. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

const REQUIRED = ["pulse", "members", "epics", "resources", "features"] as const;

/** Deliver a first snapshot for every source except the named one. */
function deliverAllBut(skip: string) {
  for (const s of REQUIRED) if (s !== skip) cbs[s]?.(s === "pulse" ? { id: "p1" } : []);
}

let stop: () => void = () => {};

beforeEach(async () => {
  stop();
  for (const k of Object.keys(cbs)) delete cbs[k];
  stop = usePulseStore.getState().load("p1");
  await settle();
});

const loading = () => usePulseStore.getState().loading;

describe("the first-paint gate", () => {
  it("starts loading", () => {
    expect(loading()).toBe(true);
  });

  // One case per source, so adding a listener to the gate without wiring its
  // callback fails here rather than in production.
  it.each(REQUIRED)("still loads while %s has not reported", (missing) => {
    deliverAllBut(missing);
    expect(loading()).toBe(true);
  });

  it("clears once every source has reported", () => {
    deliverAllBut("");
    expect(loading()).toBe(false);
  });

  // The exact production ordering: the roster and the pulse doc come back from
  // cache immediately, features trails a server round trip behind. This is the
  // sequence that used to paint the empty placeholder.
  it("does not clear on pulse + members alone", () => {
    cbs.pulse?.({ id: "p1" });
    cbs.members?.([]);
    expect(loading()).toBe(true);
    cbs.epics?.([]);
    cbs.resources?.([]);
    expect(loading()).toBe(true);
    cbs.features?.([]);
    expect(loading()).toBe(false);
  });

  // An empty Pulse is a real answer; the gate must not confuse "nothing here"
  // with "nothing yet" in the other direction either.
  it("clears for a genuinely empty Pulse", () => {
    deliverAllBut("");
    expect(loading()).toBe(false);
    expect(usePulseStore.getState().features).toEqual([]);
    expect(usePulseStore.getState().epics).toEqual([]);
  });

  it("is not held open by a source reporting twice", () => {
    cbs.pulse?.({ id: "p1" });
    cbs.pulse?.({ id: "p1" });
    cbs.members?.([]);
    cbs.epics?.([]);
    cbs.resources?.([]);
    expect(loading()).toBe(true);
    cbs.features?.([]);
    expect(loading()).toBe(false);
  });
});
