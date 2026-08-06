import { describe, it, expect } from "vitest";
import { entitlementsFor, tierOf, editorSeatLimit, delinquency, DELINQUENCY_GRACE_DAYS, TIER_ENTITLEMENTS } from "./entitlements";
import type { BillingDoc } from "@/types";

const billing = (over: Partial<BillingDoc>): BillingDoc => ({ tier: "teams", status: "active", source: "stripe", updatedAt: 0, ...over });

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // fixed clock — no Date.now() in assertions
const delinquentSince = (t: number) => billing({ tier: "teams", status: "past_due", pastDueSince: t, updatedAt: t });

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
    for (const status of ["canceled", "incomplete"] as const) {
      expect(tierOf(billing({ tier: "business", status }))).toBe("pro");
    }
    // past_due is the exception — it gets the grace window below.
    expect(tierOf(billing({ tier: "business", status: "past_due", pastDueSince: T0 }), T0)).toBe("business");
  });

  it("delinquency grace: a past_due org keeps its paid tier for 15 days", () => {
    expect(DELINQUENCY_GRACE_DAYS).toBe(15);
    const doc = delinquentSince(T0);
    expect(tierOf(doc, T0)).toBe("teams"); // the moment the charge fails
    expect(tierOf(doc, T0 + 14 * DAY)).toBe("teams"); // day 14 — still paid
    expect(tierOf(doc, T0 + 15 * DAY - 1)).toBe("teams"); // last millisecond
    expect(tierOf(doc, T0 + 15 * DAY)).toBe("pro"); // window closes
    expect(tierOf(doc, T0 + 40 * DAY)).toBe("pro");
  });

  it("delinquency grace applies to quotas and seats, not just the tier label", () => {
    const doc = delinquentSince(T0);
    expect(entitlementsFor(doc, T0 + DAY)).toEqual(TIER_ENTITLEMENTS.teams);
    expect(entitlementsFor(doc, T0 + 20 * DAY)).toEqual(TIER_ENTITLEMENTS.pro);
    // Seats survive the window, then collapse to the single free Pro seat.
    expect(editorSeatLimit(billing({ tier: "teams", status: "past_due", pastDueSince: T0, seats: 6 }), T0 + DAY)).toBe(6);
    expect(editorSeatLimit(billing({ tier: "teams", status: "past_due", pastDueSince: T0, seats: 6 }), T0 + 20 * DAY)).toBe(1);
  });

  it("the grace clock runs from the first failed charge, not the latest retry", () => {
    // SF3 carries pastDueSince across dunning retries; updatedAt moves with each
    // delivery. Using updatedAt would restart the window on every retry.
    const doc = billing({ tier: "teams", status: "past_due", pastDueSince: T0, updatedAt: T0 + 13 * DAY });
    expect(tierOf(doc, T0 + 16 * DAY)).toBe("pro");
  });

  it("a past_due doc with no pastDueSince falls back to updatedAt (pre-SF3 docs)", () => {
    const legacy = billing({ tier: "teams", status: "past_due", updatedAt: T0 });
    expect(tierOf(legacy, T0 + DAY)).toBe("teams");
    expect(tierOf(legacy, T0 + 16 * DAY)).toBe("pro");
  });

  it("delinquency() reports the warning state during the window", () => {
    const doc = delinquentSince(T0);
    expect(delinquency(doc, T0)).toEqual({ isDelinquent: true, expired: false, daysRemaining: 15, expiresAt: T0 + 15 * DAY });
    expect(delinquency(doc, T0 + 14.5 * DAY).daysRemaining).toBe(1);
    expect(delinquency(doc, T0 + 15 * DAY - 1).daysRemaining).toBe(1); // still "today"
    expect(delinquency(doc, T0 + 15 * DAY)).toEqual({ isDelinquent: true, expired: true, daysRemaining: 0, expiresAt: T0 + 15 * DAY });
    expect(delinquency(doc, T0 + 99 * DAY).daysRemaining).toBe(0); // never negative
  });

  it("delinquency() stays silent for orgs that are not past_due", () => {
    const quiet = { isDelinquent: false, expired: false, daysRemaining: 0, expiresAt: null };
    expect(delinquency(null)).toEqual(quiet); // non-owners read null
    expect(delinquency(billing({ status: "active" }))).toEqual(quiet);
    expect(delinquency(billing({ status: "trialing" }))).toEqual(quiet);
    // A cancelled org is not "delinquent" — there is nothing left to fix.
    expect(delinquency(billing({ status: "canceled" }))).toEqual(quiet);
  });

  it("editor seat limit: Pro fixed at 1; paid tiers bounded by purchased seats", () => {
    expect(editorSeatLimit(null)).toBe(1); // Pro default
    expect(editorSeatLimit(billing({ tier: "pro" }))).toBe(1);
    expect(editorSeatLimit(billing({ tier: "teams", seats: 4 }))).toBe(4);
    expect(editorSeatLimit(billing({ tier: "business", seats: 30 }))).toBe(30);
  });
});
