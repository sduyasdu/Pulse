import { describe, expect, it } from "vitest";
import { effectiveEditScope, isArchived, pulseLock } from "./pulseLock";
import { hiddenOf, type MyPulseIndexEntry, type Pulse } from "@/types";

const pulse = (archivedAt: number | null): Pulse =>
  ({ id: "p1", workspaceId: "w1", name: "P", createdBy: "u1", createdAt: 0, updatedAt: 0,
     graphConfig: { stepPx: 16, workPerStep: 1 }, resourceTypes: [], archivedAt }) as Pulse;

const entry = (e: Partial<MyPulseIndexEntry>): MyPulseIndexEntry =>
  ({ pulseId: "p1", name: "P", workspaceId: "w1", role: "owner", joinedAt: 0, ...e });

describe("pulseLock", () => {
  it("reports archived when the shared flag is set", () => {
    expect(pulseLock(pulse(1699999999999), false)).toBe("archived");
    expect(pulseLock(pulse(null), false)).toBe(null);
  });

  it("prefers archived over the plan lock — it's the one a person here can clear", () => {
    expect(pulseLock(pulse(1699999999999), true)).toBe("archived");
  });

  it("falls through to the plan lock when the Pulse is active", () => {
    expect(pulseLock(pulse(null), true)).toBe("plan");
  });

  it("treats a missing Pulse as unlocked (nothing to freeze yet)", () => {
    expect(pulseLock(null, false)).toBe(null);
    expect(pulseLock(undefined, true)).toBe("plan");
  });

  it("isArchived matches the lock's own reading of the flag", () => {
    expect(isArchived(pulse(1))).toBe(true);
    expect(isArchived(pulse(null))).toBe(false);
    expect(isArchived(null)).toBe(false);
  });
});

describe("effectiveEditScope", () => {
  it("collapses every scope to none under a lock", () => {
    for (const lock of ["archived", "plan"] as const) {
      expect(effectiveEditScope("all", lock)).toBe("none");
      expect(effectiveEditScope("lead", lock)).toBe("none");
      expect(effectiveEditScope("none", lock)).toBe("none");
    }
  });

  it("passes the scope through untouched when nothing is locked", () => {
    expect(effectiveEditScope("all", null)).toBe("all");
    expect(effectiveEditScope("lead", null)).toBe("lead");
    expect(effectiveEditScope("none", null)).toBe("none");
  });
});

describe("hiddenOf (pre-split migration read)", () => {
  it("prefers the new field, falls back to the old one, defaults to false", () => {
    expect(hiddenOf(entry({ hidden: true }))).toBe(true);
    expect(hiddenOf(entry({ hidden: false, archived: true }))).toBe(false);
    expect(hiddenOf(entry({ archived: true }))).toBe(true);
    expect(hiddenOf(entry({}))).toBe(false);
  });

  it("keeps hidden and archived independent — the per-user flag never implies the shared one", () => {
    expect(hiddenOf(entry({ hidden: true, archivedAt: null }))).toBe(true);
    expect(hiddenOf(entry({ hidden: false, archivedAt: 123 }))).toBe(false);
  });
});
