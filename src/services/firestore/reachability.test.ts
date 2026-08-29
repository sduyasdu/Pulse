import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The probe's job is to distinguish "we cannot reach the server" from "we have
 * not finished connecting yet", and with `persistentLocalCache` those look
 * identical for the first moments of every page load: the first snapshot of any
 * document is served from disk with `fromCache === true` while the SDK is still
 * opening its channel.
 *
 * Reading that flag straight through is what put the offline indicator on
 * screen on every single load, which is the behaviour these lock down.
 */

type Next = (snap: { metadata: { fromCache: boolean } }) => void;
const captured: { next?: Next; unsub: ReturnType<typeof vi.fn> }[] = [];

vi.mock("firebase/firestore", () => ({
  doc: () => ({}),
  onSnapshot: (_ref: unknown, _opts: unknown, next: Next) => {
    const unsub = vi.fn();
    captured.push({ next, unsub });
    return unsub;
  },
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

const { subscribeServerReachable, REACHABILITY_SETTLE_MS } = await import("./reachability");

const snap = (fromCache: boolean) => ({ metadata: { fromCache } });
const probe = () => captured[captured.length - 1];

/** Typed factory, so the mock satisfies the callback's signature rather than
 * widening to `Procedure` — `tsc -b` rejects the untyped form. */
const makeCb = () => vi.fn((_reachable: boolean) => {});
let cb: ReturnType<typeof makeCb>;
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  captured.length = 0;
  cb = makeCb();
  stop = subscribeServerReachable("u1", cb);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("not calling a connection that is still opening 'unreachable'", () => {
  // The reported bug: the indicator showed disconnected on every page load.
  it("says nothing when the first snapshot is cache-served", () => {
    probe().next?.(snap(true));
    expect(cb).not.toHaveBeenCalled();
  });

  it("stays silent right up to the settle deadline", () => {
    probe().next?.(snap(true));
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS - 1);
    expect(cb).not.toHaveBeenCalled();
  });

  it("reports reachable, and never unreachable, when the server answers in time", () => {
    probe().next?.(snap(true));
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS - 1);
    probe().next?.(snap(false));
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
    // The pending verdict must be cancelled, not merely overtaken.
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS * 2);
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("reporting a connection that really is gone", () => {
  it("reports unreachable once the window elapses", () => {
    probe().next?.(snap(true));
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS);
    expect(cb).toHaveBeenCalledExactlyOnceWith(false);
  });

  // Coming back is reported immediately: the asymmetry is deliberate, since a
  // connection that answers has proved itself and needs no waiting period.
  it("reports recovery with no delay", () => {
    probe().next?.(snap(true));
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS);
    cb.mockClear();
    probe().next?.(snap(false));
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("waits again before calling a second drop unreachable", () => {
    probe().next?.(snap(false));
    cb.mockClear();
    probe().next?.(snap(true));
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS);
    expect(cb).toHaveBeenCalledExactlyOnceWith(false);
  });
});

describe("staying quiet", () => {
  it("does not repeat a verdict it has already given", () => {
    probe().next?.(snap(false));
    probe().next?.(snap(false));
    probe().next?.(snap(false));
    expect(cb).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does not re-arm the timer while already unreachable", () => {
    probe().next?.(snap(true));
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS);
    cb.mockClear();
    probe().next?.(snap(true));
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS * 2);
    expect(cb).not.toHaveBeenCalled();
  });

  // A verdict landing after teardown would set state on an unmounted hook.
  it("cancels a pending verdict when unsubscribed", () => {
    probe().next?.(snap(true));
    stop();
    vi.advanceTimersByTime(REACHABILITY_SETTLE_MS * 2);
    expect(cb).not.toHaveBeenCalled();
  });

  it("tears the listener down when unsubscribed", () => {
    const unsub = probe().unsub;
    stop();
    expect(unsub).toHaveBeenCalled();
  });
});
