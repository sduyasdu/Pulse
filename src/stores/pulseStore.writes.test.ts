import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A write that fails has to say so.
 *
 * Every mutation in this store awaited its write and did nothing with a
 * rejection, so a refusal — lost access, an oversized document, a dropped
 * connection — produced an unhandled promise rejection and a change that simply
 * never appeared. The user saw nothing at all: not an error, not the change.
 *
 * This is the same fault CLAUDE.md records for the read paths ("a swallowed
 * onSnapshot error looks exactly like an empty collection"), on the other side
 * of the wire, and it is pinned the same way — by driving the failure and
 * asserting the success path did NOT run.
 */
const updateFeature = vi.fn();
vi.mock("@/lib/firebase", () => ({ db: {}, auth: {}, googleProvider: {}, functions: {} }));
vi.mock("@/services/firestore/pulses", () => ({
  subscribePulse: () => () => {}, updatePulse: vi.fn(), renamePulse: vi.fn(),
  updateGraphConfig: vi.fn(), updateResourceTypes: vi.fn(), updateStatuses: vi.fn(),
}));
vi.mock("@/services/firestore/epics", () => ({
  subscribeEpics: () => () => {}, createEpic: vi.fn(), updateEpic: vi.fn(),
  deleteEpic: vi.fn(), newEpicId: () => "e1",
}));
vi.mock("@/services/firestore/resources", () => ({
  subscribeResources: () => () => {}, createResource: vi.fn(), updateResource: vi.fn(),
  deleteResource: vi.fn(), newResourceId: () => "r1", uniqueInitials: () => "AB",
}));
vi.mock("@/services/firestore/features", () => ({
  subscribeFeatures: () => () => {},
  createFeature: vi.fn(), deleteFeature: vi.fn(), newFeatureId: () => "f1",
  updateFeature: (...a: unknown[]) => updateFeature(...a),
}));
vi.mock("@/services/firestore/memberships", () => ({ subscribeMembers: () => () => {} }));
vi.mock("@/services/firestore/costs", () => ({
  subscribeCosts: () => () => {}, createCost: vi.fn(), updateCost: vi.fn(),
  deleteCost: vi.fn(), newCostId: () => "c1",
}));
vi.mock("@/services/firestore/rates", () => ({ subscribeRates: () => () => {}, setRate: vi.fn(), clearRate: vi.fn() }));
vi.mock("@/services/firestore/activity", () => ({ subscribeActivity: () => () => {}, recordActivity: vi.fn() }));

const { usePulseStore } = await import("./pulseStore");

const FEATURE = { id: "f1", title: "T", duration: 8, work: 1, status: "planned", resources: [], ai: false, x: 0, y: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  updateFeature.mockResolvedValue(undefined);
  usePulseStore.setState({ pulseId: "p1", features: [FEATURE as never], writeError: null });
});

describe("when a write is refused", () => {
  it("surfaces it instead of failing silently", async () => {
    updateFeature.mockRejectedValue(new Error("PERMISSION_DENIED"));
    await usePulseStore.getState().patchFeature("f1", { title: "New" });
    expect(usePulseStore.getState().writeError?.key).toBe("write.failed");
  });

  it("does not reject, so the caller's `void patch(...)` cannot go unhandled", async () => {
    updateFeature.mockRejectedValue(new Error("nope"));
    await expect(usePulseStore.getState().patchFeature("f1", { title: "New" })).resolves.toBeUndefined();
  });

  it("leaves nothing behind on a successful write", async () => {
    await usePulseStore.getState().patchFeature("f1", { title: "New" });
    expect(usePulseStore.getState().writeError).toBeNull();
  });

  it("can be dismissed", async () => {
    updateFeature.mockRejectedValue(new Error("nope"));
    await usePulseStore.getState().patchFeature("f1", { title: "New" });
    usePulseStore.getState().clearWriteError();
    expect(usePulseStore.getState().writeError).toBeNull();
  });
});

describe("the attachment cap", () => {
  it("refuses a pasted file without attempting the write", async () => {
    await usePulseStore.getState().addAttachment("f1", "photo", "data:image/png;base64," + "A".repeat(5000));
    expect(usePulseStore.getState().writeError?.key).toBe("attach.file-not-link");
    // The point of checking before writing: a megabyte never reaches a document
    // every member of the Beat streams.
    expect(updateFeature).not.toHaveBeenCalled();
  });

  it("still stores an ordinary link", async () => {
    await usePulseStore.getState().addAttachment("f1", "Doc", "example.com/spec");
    expect(updateFeature).toHaveBeenCalledTimes(1);
    expect(usePulseStore.getState().writeError).toBeNull();
  });
});
