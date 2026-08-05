import { describe, it, expect } from "vitest";
import { entitlementsFor, tierOf, TIER_ENTITLEMENTS } from "./entitlements";
import type { BillingDoc } from "@/types";

const billing = (over: Partial<BillingDoc>): BillingDoc => ({ tier: "pro", status: "active", source: "stripe", updatedAt: 0, ...over });

describe("entitlements", () => {
  it("absent billing doc resolves to Free", () => {
    expect(tierOf(null)).toBe("free");
    expect(tierOf(undefined)).toBe("free");
    expect(entitlementsFor(null)).toEqual(TIER_ENTITLEMENTS.free);
    expect(entitlementsFor(null).scopedRoles).toBe(false);
  });

  it("an active paid tier grants its entitlements", () => {
    expect(entitlementsFor(billing({ tier: "pro", status: "active" })).scopedRoles).toBe(true);
    expect(entitlementsFor(billing({ tier: "team", status: "active" })).teams).toBe(true);
    expect(entitlementsFor(billing({ tier: "team", status: "trialing" })).teams).toBe(true);
  });

  it("a non-active status falls back to Free (conservative until PL4)", () => {
    for (const status of ["canceled", "past_due", "incomplete"] as const) {
      expect(tierOf(billing({ tier: "pro", status }))).toBe("free");
      expect(entitlementsFor(billing({ tier: "team", status })).teams).toBe(false);
    }
  });

  it("quotas: null means unlimited, Free is capped", () => {
    expect(TIER_ENTITLEMENTS.free.maxPulses).toBe(3);
    expect(TIER_ENTITLEMENTS.pro.maxPulses).toBeNull();
    expect(TIER_ENTITLEMENTS.team.maxMembersPerPulse).toBeNull();
  });
});
