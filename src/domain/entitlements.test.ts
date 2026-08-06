import { describe, it, expect } from "vitest";
import { entitlementsFor, tierOf, editorSeatLimit, TIER_ENTITLEMENTS } from "./entitlements";
import type { BillingDoc } from "@/types";

const billing = (over: Partial<BillingDoc>): BillingDoc => ({ tier: "teams", status: "active", source: "stripe", updatedAt: 0, ...over });

describe("entitlements (quota-only)", () => {
  it("absent billing doc resolves to Pro (the free default)", () => {
    expect(tierOf(null)).toBe("pro");
    expect(tierOf(undefined)).toBe("pro");
    expect(entitlementsFor(null)).toEqual(TIER_ENTITLEMENTS.pro);
    expect(entitlementsFor(null).maxPulses).toBe(3);
  });

  it("each tier exposes its quantity limits", () => {
    expect(entitlementsFor(billing({ tier: "pro" }))).toEqual({ maxEditors: 1, maxPulses: 3, maxCollaborators: 10, maxResourcesPerPulse: 20 });
    expect(entitlementsFor(billing({ tier: "teams" }))).toEqual({ maxEditors: null, maxPulses: 5, maxCollaborators: 20, maxResourcesPerPulse: 40 });
    expect(entitlementsFor(billing({ tier: "business" })).maxPulses).toBeNull();
  });

  it("a non-active status falls back to Pro (conservative, per PL4)", () => {
    for (const status of ["canceled", "past_due", "incomplete"] as const) {
      expect(tierOf(billing({ tier: "business", status }))).toBe("pro");
    }
  });

  it("editor seat limit: Pro fixed at 1; paid tiers bounded by purchased seats", () => {
    expect(editorSeatLimit(null)).toBe(1); // Pro default
    expect(editorSeatLimit(billing({ tier: "pro" }))).toBe(1);
    expect(editorSeatLimit(billing({ tier: "teams", seats: 4 }))).toBe(4);
    expect(editorSeatLimit(billing({ tier: "business", seats: 30 }))).toBe(30);
  });
});
