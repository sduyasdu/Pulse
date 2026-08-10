import { describe, it, expect } from "vitest";
import { planNotice, URGENT_AT_DAYS } from "./planNotice";
import { DELINQUENCY_GRACE_DAYS } from "./entitlements";
import type { BillingDoc } from "@/types";

const DAY = 24 * 60 * 60 * 1000;
// A fixed local-noon clock: dayStamp() uses local calendar parts, so anchoring
// at noon keeps the assertions stable regardless of the runner's timezone.
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime();
const WS = "ws1";

const billing = (over: Partial<BillingDoc>): BillingDoc => ({ tier: "pro", status: "active", source: "stripe", updatedAt: T0, ...over });
const pastDue = (over: Partial<BillingDoc> = {}) => billing({ status: "past_due", pastDueSince: T0, ...over });

describe("planNotice (delinquency banner)", () => {
  it("says nothing for a healthy org", () => {
    expect(planNotice(billing({ status: "active" }), WS, T0)).toBeNull();
    expect(planNotice(billing({ status: "trialing" }), WS, T0)).toBeNull();
  });

  it("says nothing when there is no billing doc — non-owners read null", () => {
    expect(planNotice(null, WS, T0)).toBeNull();
    expect(planNotice(undefined, WS, T0)).toBeNull();
  });

  it("says nothing without a workspace (signed out / bootstrapping)", () => {
    expect(planNotice(pastDue(), null, T0)).toBeNull();
  });

  it("says nothing for a cancelled org — there is no window left to warn about", () => {
    expect(planNotice(billing({ status: "canceled" }), WS, T0)).toBeNull();
  });

  it("counts down the days, staying calm until the end is near", () => {
    const doc = pastDue();
    const day1 = planNotice(doc, WS, T0)!;
    expect(day1.messageKey).toBe("plan.pastDue");
    expect(day1.params).toEqual({ days: DELINQUENCY_GRACE_DAYS, tier: "Pro" });
    expect(day1.urgent).toBe(false);

    // Calm right up to the urgency threshold, then warmer.
    expect(planNotice(doc, WS, T0 + (DELINQUENCY_GRACE_DAYS - URGENT_AT_DAYS - 1) * DAY)!.urgent).toBe(false);
    expect(planNotice(doc, WS, T0 + (DELINQUENCY_GRACE_DAYS - URGENT_AT_DAYS) * DAY)!.urgent).toBe(true);
  });

  it("switches to the today-only wording on the final day", () => {
    const doc = pastDue();
    const last = planNotice(doc, WS, T0 + (DELINQUENCY_GRACE_DAYS - 1) * DAY)!;
    expect(last.messageKey).toBe("plan.pastDueToday");
    expect(last.params).toEqual({ days: 1, tier: "Pro" });
    expect(last.urgent).toBe(true);
  });

  it("reports the expired state once the window closes", () => {
    const expired = planNotice(pastDue(), WS, T0 + DELINQUENCY_GRACE_DAYS * DAY)!;
    expect(expired.messageKey).toBe("plan.pastDueExpired");
    expect(expired.params).toEqual({ days: DELINQUENCY_GRACE_DAYS });
    expect(expired.urgent).toBe(true);
  });

  it("capitalizes the tier as a product term", () => {
    expect(planNotice(pastDue({ tier: "business" }), WS, T0)!.params.tier).toBe("Business");
  });

  it("scopes a dismissal to one day while the window is open", () => {
    const doc = pastDue();
    const today = planNotice(doc, WS, T0)!.dismissKey;
    const sameDay = planNotice(doc, WS, T0 + 60_000)!.dismissKey;
    const tomorrow = planNotice(doc, WS, T0 + DAY)!.dismissKey;
    expect(sameDay).toBe(today); // dismissing quiets it for the rest of today
    expect(tomorrow).not.toBe(today); // …and it returns tomorrow, one day closer
  });

  it("makes an expired dismissal permanent — no clock left to run", () => {
    const doc = pastDue();
    const first = planNotice(doc, WS, T0 + DELINQUENCY_GRACE_DAYS * DAY)!.dismissKey;
    const muchLater = planNotice(doc, WS, T0 + 90 * DAY)!.dismissKey;
    expect(muchLater).toBe(first);
    expect(first).toContain("expired");
  });

  it("scopes dismissals per workspace", () => {
    const doc = pastDue();
    expect(planNotice(doc, "wsA", T0)!.dismissKey).not.toBe(planNotice(doc, "wsB", T0)!.dismissKey);
  });
});
