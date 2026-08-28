import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PulseMember } from "@/types";

/**
 * Two properties of `pulseStore.load()`, which are really the same property
 * seen twice: nothing may be painted from a read that hasn't answered yet.
 *
 * 1. The first-paint gate. `loading` decides whether the canvas may paint, and
 *    the canvas draws "This Pulse is empty / add a task" from
 *    `epics.length === 0 && features.length === 0` — which is also what those
 *    arrays hold before their listeners have said anything. Clearing `loading`
 *    early doesn't show a half-drawn Pulse, it shows a confident wrong answer:
 *    open a Pulse full of work and it invites you to create the first task.
 *    That shipped, because the gate counted the pulse doc and the roster only.
 *
 * 2. The read scope. Features and costs must carry the `array-contains`
 *    constraint for a My-Beat Viewer or the rules refuse the query outright, so
 *    they cannot subscribe until the caller's role is known. Reading it from
 *    the roster snapshot (rather than a separate getDoc) removes a server round
 *    trip from in front of the first paint, at the price of a possibly stale
 *    cached role — which is why the scope is re-applied on every roster
 *    snapshot instead of resolved once.
 *
 * These drive the real `load()` rather than a helper, because neither bug was
 * ever in the arithmetic — they were in which listeners were counted, and in
 * when the query shape was decided.
 */

type Cb = (v: unknown) => void;
type ErrCb = (m: string) => void;

const cbs: Record<string, Cb> = {};
const errs: Record<string, ErrCb | undefined> = {};
/** Every subscribeFeatures call, in order, with the scope it was given. */
const featureSubs: { beatUid: string | undefined; unsub: () => void; live: boolean }[] = [];

const capture = (name: string) => (_pulseId: string, cb: Cb, onErr?: ErrCb) => {
  cbs[name] = cb;
  errs[name] = onErr;
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
  // Note the shape: beatUid sits between the callback and onError, which is the
  // whole point of this suite.
  subscribeFeatures: (_p: string, cb: Cb, beatUid: string | undefined, onErr?: ErrCb) => {
    const entry = { beatUid, live: true, unsub: () => { entry.live = false; } };
    featureSubs.push(entry);
    cbs.features = cb;
    errs.features = onErr;
    return entry.unsub;
  },
  createFeature: vi.fn(), updateFeature: vi.fn(), deleteFeature: vi.fn(), newFeatureId: () => "f1",
}));
const fetchMembership = vi.fn(() => Promise.resolve(null));
vi.mock("@/services/firestore/memberships", () => ({
  subscribePulseMembers: capture("members"),
  fetchMembership,
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

const member = (uid: string, role: PulseMember["role"]) => ({ uid, role }) as PulseMember;
const ME_EDITOR = [member("u1", "editor"), member("u2", "owner")];
const ME_BEAT = [member("u1", "myBeatViewer"), member("u2", "owner")];

const state = () => usePulseStore.getState();
const loading = () => state().loading;
const latestSub = () => featureSubs[featureSubs.length - 1];

let stop: () => void = () => {};

beforeEach(() => {
  stop();
  for (const k of Object.keys(cbs)) delete cbs[k];
  for (const k of Object.keys(errs)) delete errs[k];
  featureSubs.length = 0;
  fetchMembership.mockClear();
  stop = state().load("p1");
});

/** The four listeners that exist from the first tick. Features is deliberately
 * excluded — it does not exist until the roster names our read scope. */
const deliverUnscoped = () => {
  cbs.pulse?.({ id: "p1" });
  cbs.epics?.([]);
  cbs.resources?.([]);
};

describe("the first-paint gate", () => {
  it("starts loading", () => {
    expect(loading()).toBe(true);
  });

  it.each(["pulse", "epics", "resources"])("still loads while %s has not reported", (missing) => {
    for (const s of ["pulse", "epics", "resources"]) if (s !== missing) cbs[s]?.(s === "pulse" ? { id: "p1" } : []);
    cbs.members?.(ME_EDITOR);
    cbs.features?.([]);
    expect(loading()).toBe(true);
  });

  it("still loads while the roster has not reported", () => {
    deliverUnscoped();
    expect(loading()).toBe(true);
  });

  // The exact production ordering: the pulse doc and the roster come back from
  // cache first, features can only follow the roster. This is the sequence that
  // used to paint the empty placeholder.
  it("does not clear before features has reported", () => {
    deliverUnscoped();
    cbs.members?.(ME_EDITOR);
    expect(loading()).toBe(true);
    cbs.features?.([]);
    expect(loading()).toBe(false);
  });

  // An empty Pulse is a real answer; the gate must not confuse "nothing here"
  // with "nothing yet" in the other direction either.
  it("clears for a genuinely empty Pulse", () => {
    deliverUnscoped();
    cbs.members?.(ME_EDITOR);
    cbs.features?.([]);
    expect(loading()).toBe(false);
    expect(state().features).toEqual([]);
    expect(state().epics).toEqual([]);
  });

  it("is not held open by a source reporting twice", () => {
    cbs.pulse?.({ id: "p1" });
    cbs.pulse?.({ id: "p1" });
    cbs.members?.(ME_EDITOR);
    cbs.epics?.([]);
    expect(loading()).toBe(true);
    cbs.resources?.([]);
    cbs.features?.([]);
    expect(loading()).toBe(false);
  });

  // Every listener eventually reports or fails, so the spinner cannot outlive a
  // refusal — PulsePage renders the error screen from `contentError`.
  it("clears on a refusal so the error screen can take over", () => {
    errs.epics?.("permission-denied");
    expect(loading()).toBe(false);
    expect(state().contentError).toBe("permission-denied");
  });
});

describe("read scope from the roster", () => {
  it("does not spend a getDoc resolving what the roster already carries", () => {
    deliverUnscoped();
    cbs.members?.(ME_BEAT);
    expect(fetchMembership).not.toHaveBeenCalled();
  });

  it("waits for the roster before subscribing at all", () => {
    deliverUnscoped();
    expect(featureSubs).toHaveLength(0);
  });

  it("subscribes unconstrained for a full reader", () => {
    cbs.members?.(ME_EDITOR);
    expect(featureSubs).toHaveLength(1);
    expect(latestSub().beatUid).toBeUndefined();
  });

  it("subscribes scoped for a My-Beat Viewer", () => {
    cbs.members?.(ME_BEAT);
    expect(featureSubs).toHaveLength(1);
    expect(latestSub().beatUid).toBe("u1");
  });

  // Not in the roster is very nearly unreachable, but it must still subscribe:
  // the gate would otherwise never resolve, and PulsePage's self-heal (which
  // bounces a removed member to the dashboard) only runs once `loading` clears.
  it("still subscribes when the roster does not name us", () => {
    cbs.members?.([member("u2", "owner")]);
    expect(featureSubs).toHaveLength(1);
    expect(latestSub().beatUid).toBeUndefined();
  });
});

describe("resubscribing when the scope changes", () => {
  // The case the getDoc was paying for: a cached roster can carry a role the
  // server has since changed.
  it("tears the stale listener down and reopens it with the right shape", () => {
    cbs.members?.(ME_EDITOR); // cached roster, stale
    expect(latestSub().beatUid).toBeUndefined();
    const stale = latestSub();

    cbs.members?.(ME_BEAT); // server roster, authoritative
    expect(stale.live).toBe(false);
    expect(featureSubs).toHaveLength(2);
    expect(latestSub().beatUid).toBe("u1");
    expect(latestSub().live).toBe(true);
  });

  // Rosters change for reasons that have nothing to do with us. Churning the
  // listener on every one would refetch the whole collection each time someone
  // is invited.
  it("leaves the listener alone when our own scope is unchanged", () => {
    cbs.members?.(ME_EDITOR);
    cbs.members?.([...ME_EDITOR, member("u3", "taskLead")]);
    cbs.members?.([...ME_EDITOR, member("u3", "taskLead"), member("u4", "fullViewer")]);
    expect(featureSubs).toHaveLength(1);
    expect(latestSub().live).toBe(true);
  });

  // Roles that differ but share a read scope are the same query. fullViewer and
  // taskLead both read everything.
  it("does not resubscribe for a role change that keeps the same scope", () => {
    cbs.members?.([member("u1", "editor")]);
    cbs.members?.([member("u1", "taskLead")]);
    expect(featureSubs).toHaveLength(1);
  });

  it("resubscribes when a live demotion arrives mid-session", () => {
    deliverUnscoped();
    cbs.members?.(ME_EDITOR);
    cbs.features?.([{ id: "f1" }]);
    expect(loading()).toBe(false);

    cbs.members?.(ME_BEAT);
    expect(latestSub().beatUid).toBe("u1");
    // Already painted once, so the gate stays shut behind us — no spinner.
    expect(loading()).toBe(false);
  });
});

describe("recovering from a refusal caused by the wrong scope", () => {
  it("clears the error and returns to the spinner when the scope corrects", () => {
    deliverUnscoped();
    cbs.members?.(ME_EDITOR); // stale: we are really a My-Beat Viewer
    errs.features?.("permission-denied"); // the unconstrained query is refused
    expect(state().contentError).toBe("permission-denied");
    expect(loading()).toBe(false);

    cbs.members?.(ME_BEAT); // the truth arrives
    expect(state().contentError).toBeNull();
    // Features never delivered, so there is still nothing to paint.
    expect(loading()).toBe(true);

    cbs.features?.([{ id: "f1" }]);
    expect(loading()).toBe(false);
    expect(state().contentError).toBeNull();
  });

  it("does not reopen the spinner if features had already delivered", () => {
    deliverUnscoped();
    cbs.members?.(ME_EDITOR);
    cbs.features?.([{ id: "f1" }]);
    errs.features?.("permission-denied");
    expect(loading()).toBe(false);

    cbs.members?.(ME_BEAT);
    expect(state().contentError).toBeNull();
    expect(loading()).toBe(false);
  });

  // A refused epics listener is a real fault: resubscribing features says
  // nothing about it, and clearing it would hide a Pulse we genuinely cannot
  // read behind a working-looking canvas.
  it("leaves an unscoped listener's refusal standing", () => {
    cbs.members?.(ME_EDITOR);
    errs.epics?.("epics denied");
    cbs.members?.(ME_BEAT);
    expect(state().contentError).toBe("epics denied");
  });

  // First refusal wins, so a later scoped refusal is not the one on screen and
  // must not be treated as the recoverable one.
  it("leaves the standing refusal alone when a scoped one lost the race", () => {
    cbs.members?.(ME_EDITOR);
    errs.epics?.("epics denied");
    errs.features?.("features denied");
    expect(state().contentError).toBe("epics denied");
    cbs.members?.(ME_BEAT);
    expect(state().contentError).toBe("epics denied");
  });
});
