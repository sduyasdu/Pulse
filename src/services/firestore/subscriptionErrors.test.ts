import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A refused live read must not arrive as an empty result.
 *
 * These subscriptions used to pass `() => cb([])` as their error handler, which
 * made "you may not read this" and "there is nothing here" the same value. The
 * consequence was a Pulse that opened normally with every task missing: no
 * error, nothing to retry, indistinguishable from data loss. Two features have
 * now shipped that way — the Connected assistants dialog listing zero of three
 * live connections, and this.
 *
 * So the assertion is not merely "onError is called". It is that the success
 * path is NOT invoked on failure, which is the half that actually caused the
 * damage and the half a well-meaning refactor would put back.
 */

/** Captures the arguments handed to onSnapshot, so each subscription's error
 * wiring can be driven directly. */
const captured: { onNext?: (snap: unknown) => void; onError?: (err: Error) => void }[] = [];

vi.mock("firebase/firestore", () => ({
  onSnapshot: (_q: unknown, onNext: (s: unknown) => void, onError?: (e: Error) => void) => {
    captured.push({ onNext, onError });
    return () => {};
  },
  collection: () => ({}),
  doc: () => ({}),
  query: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  getDoc: () => Promise.resolve({ exists: () => false }),
  getDocs: () => Promise.resolve({ docs: [], empty: true }),
  setDoc: () => Promise.resolve(),
  updateDoc: () => Promise.resolve(),
  deleteDoc: () => Promise.resolve(),
  writeBatch: () => ({ set: () => {}, delete: () => {}, commit: () => Promise.resolve() }),
  serverTimestamp: () => ({}),
  increment: (n: number) => n,
  arrayUnion: () => ({}),
  arrayRemove: () => ({}),
  deleteField: () => ({}),
  getCountFromServer: () => Promise.resolve({ data: () => ({ count: 0 }) }),
}));

vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {} }));

const { subscribeFeatures } = await import("./features");
const { subscribeEpics } = await import("./epics");
const { subscribeResources } = await import("./resources");
const { subscribePulse, subscribeMyPulses } = await import("./pulses");
const { subscribeAllComments, subscribeCommentsFor } = await import("./comments");
const { subscribeActivity, subscribeFeatureActivity } = await import("./activity");
const { subscribeCosts } = await import("./costs");
const { subscribeWorkspace, subscribeWorkspaceMembers } = await import("./workspaces");
const { subscribeMyNotifications } = await import("./notifications");

beforeEach(() => {
  captured.length = 0;
});

const CASES: [string, (onData: (v: unknown) => void, onErr: (m: string) => void) => void][] = [
  ["features", (d, e) => subscribeFeatures("p1", d as () => void, undefined, e)],
  ["epics", (d, e) => subscribeEpics("p1", d as () => void, e)],
  ["resources", (d, e) => subscribeResources("p1", d as () => void, e)],
  ["pulse", (d, e) => subscribePulse("p1", d as () => void, e)],
  ["myPulses", (d, e) => subscribeMyPulses("u1", d as () => void, e)],
  ["allComments", (d, e) => subscribeAllComments("p1", d as () => void, e)],
  ["commentsFor", (d, e) => subscribeCommentsFor("p1", "t1", d as () => void, e)],
  ["activity", (d, e) => subscribeActivity("p1", d as () => void, undefined, e)],
  ["featureActivity", (d, e) => subscribeFeatureActivity("p1", "f1", d as () => void, undefined, e)],
  ["costs", (d, e) => subscribeCosts("p1", d as () => void, undefined, e)],
  ["workspace", (d, e) => subscribeWorkspace("w1", d as () => void, e)],
  ["workspaceMembers", (d, e) => subscribeWorkspaceMembers("w1", d as () => void, e)],
  ["myNotifications", (d, e) => subscribeMyNotifications("p1", "u1", d as () => void, e)],
];

describe.each(CASES)("subscribe%s", (name, subscribe) => {
  it(`reports a refusal instead of calling back empty (${name})`, () => {
    const onData = vi.fn();
    const onErr = vi.fn();
    subscribe(onData, onErr);

    captured[0].onError?.(new Error("Missing or insufficient permissions."));

    expect(onErr).toHaveBeenCalledWith("Missing or insufficient permissions.");
    // The half that matters: nothing was delivered as data.
    expect(onData).not.toHaveBeenCalled();
  });

  it(`still delivers real results (${name})`, () => {
    const onData = vi.fn();
    subscribe(onData, vi.fn());
    captured[0].onNext?.({ docs: [], exists: () => false });
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it(`registers an error handler at all (${name})`, () => {
    subscribe(vi.fn(), vi.fn());
    expect(captured[0].onError).toBeTypeOf("function");
  });
});

// The two that keep their empty-on-failure, so nobody "fixes" them back.
describe("the deliberate exceptions", () => {
  it("documents why rates and billing are not in the list above", () => {
    // rates: a non-admin's listener is MEANT to be rejected, and the empty
    // result is how the feature works rather than a swallowed error — its own
    // comment in pulseStore says so.
    //
    // billing: refusal falls back to the Free plan. Degrading to least
    // privilege on an unreadable entitlement is a decision, not an accident.
    //
    // presence: ephemeral and decorative; an empty presence bar on a dropped
    // listener is an acceptable degradation that self-heals on reconnect.
    //
    // This test exists so the reasoning is discoverable from the test file that
    // would otherwise look like it had simply missed them.
    expect(CASES.map((c) => c[0])).not.toContain("rates");
    expect(CASES.map((c) => c[0])).not.toContain("billing");
  });
});
