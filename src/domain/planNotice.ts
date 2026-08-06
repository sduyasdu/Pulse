import type { BillingDoc } from "@/types";
import { delinquency, DELINQUENCY_GRACE_DAYS } from "./entitlements";

// What the delinquency banner should say, and when it should stay quiet
// (Plans-Spec §5.1). Pure and React-free so the rules — which message, which
// palette, how long a dismissal lasts — are unit-testable; PlanBanner.tsx is
// then just presentation.

/** Days left at which the notice switches to the urgent palette. */
export const URGENT_AT_DAYS = 3;

const KEY_PREFIX = "pulse.planNotice";

export interface PlanNotice {
  /** i18n key for the message. */
  messageKey: "plan.pastDue" | "plan.pastDueToday" | "plan.pastDueExpired";
  /** Interpolation params for `messageKey`. */
  params: { days: number; tier?: string };
  /** Warmer palette — the consequence is imminent, or has already landed. */
  urgent: boolean;
  /**
   * localStorage key recording a dismissal. Scoped so a dismissal can never
   * hide something still actionable: **per calendar day** while the window is
   * open (it returns tomorrow, one day closer), and **permanent** once expired,
   * since there is no clock left to run.
   */
  dismissKey: string;
}

/** Local calendar day, so "dismissed for today" matches the user's day. */
function dayStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The notice to show a given org, or `null` for "say nothing" — which covers
 * every healthy org, and also every non-owner, whose billing read resolves to
 * null (only owners may read `billing/{orgId}`).
 */
export function planNotice(
  billing: BillingDoc | null | undefined,
  workspaceId: string | null | undefined,
  now: number = Date.now(),
): PlanNotice | null {
  if (!billing || !workspaceId) return null;
  const state = delinquency(billing, now);
  if (!state.isDelinquent) return null;

  // Tier names (Pro, Teams, Business) are product terms — left untranslated,
  // like Pulse and Epic (see i18n/en.ts).
  const tier = billing.tier.charAt(0).toUpperCase() + billing.tier.slice(1);

  if (state.expired) {
    return {
      messageKey: "plan.pastDueExpired",
      params: { days: DELINQUENCY_GRACE_DAYS },
      urgent: true,
      dismissKey: `${KEY_PREFIX}.${workspaceId}.expired`,
    };
  }
  return {
    messageKey: state.daysRemaining <= 1 ? "plan.pastDueToday" : "plan.pastDue",
    params: { days: state.daysRemaining, tier },
    urgent: state.daysRemaining <= URGENT_AT_DAYS,
    dismissKey: `${KEY_PREFIX}.${workspaceId}.${dayStamp(now)}`,
  };
}
