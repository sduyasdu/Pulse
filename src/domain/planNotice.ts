import type { BillingDoc } from "@/types";
import { delinquency, graceDaysFor } from "./entitlements";
import { formatMinorUnits } from "./money";

// What the plan banner should say, and when it should stay quiet (Plans-Spec
// §5.1, Trials-and-Referrals-Spec TR4/TR14). Pure and React-free so the rules —
// which message, which palette, how long a dismissal lasts — are unit-testable;
// PlanBanner.tsx is then just presentation.

/** Days left at which the notice switches to the urgent palette. */
export const URGENT_AT_DAYS = 3;

/** TR4: the free month's end is announced this many days ahead. */
export const TRIAL_NOTICE_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;
const KEY_PREFIX = "pulse.planNotice";

export interface PlanNotice {
  /** i18n key for the message. */
  messageKey:
    | "plan.pastDue"
    | "plan.pastDueToday"
    | "plan.pastDueExpired"
    | "plan.trialEnding"
    | "plan.trialEndingShort"
    | "plan.referralEarned";
  /** Interpolation params for `messageKey`. */
  params: Record<string, string | number>;
  /** Warmer palette — the consequence is imminent, or has already landed. */
  urgent: boolean;
  /**
   * localStorage key recording a dismissal. Scoped so a dismissal can never
   * hide something still actionable: **per calendar day** while the window is
   * open (it returns tomorrow, one day closer), and **permanent** once expired,
   * since there is no clock left to run.
   */
  dismissKey: string;
  /** Dismissed on the SERVER (`dismissBillingNotice`), not in this browser: a
   * one-time notice must not come back on the owner's other devices (TR14). */
  serverDismiss?: boolean;
  /** Good news — the calm palette, not a warning's. */
  good?: boolean;
}

/** Local calendar day, so "dismissed for today" matches the user's day. */
function dayStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The notice to show a given org, or `null` for "say nothing" — which covers
 * every healthy org, and also every non-owner, whose billing read resolves to
 * null (only owners may read `billing/{orgId}`). A failed payment outranks the
 * trial's end, which outranks a reward.
 */
export function planNotice(
  billing: BillingDoc | null | undefined,
  workspaceId: string | null | undefined,
  now: number = Date.now(),
  lang = "en",
): PlanNotice | null {
  if (!billing || !workspaceId) return null;
  const state = delinquency(billing, now);

  if (state.isDelinquent) {
    // Tier names (Pro, Business) are product terms — left untranslated,
    // like Beat and Epic (see i18n/en.ts).
    const tier = billing.tier.charAt(0).toUpperCase() + billing.tier.slice(1);
    if (state.expired) {
      return {
        messageKey: "plan.pastDueExpired",
        params: { days: graceDaysFor(billing) },
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

  // TR4: from three days before the free month ends — the date, the amount, the card.
  const end = billing.trialEnd;
  if (billing.status === "trialing" && end && now < end && now >= end - TRIAL_NOTICE_DAYS * DAY) {
    const date = new Date(end).toLocaleDateString(lang, { month: "short", day: "numeric" });
    const full = billing.nextAmount != null && billing.currency && billing.card;
    return {
      messageKey: full ? "plan.trialEnding" : "plan.trialEndingShort",
      params: full
        ? {
            date,
            amount: formatMinorUnits(billing.nextAmount!, billing.currency!, lang),
            card: `${cardBrand(billing.card!.brand)} ···· ${billing.card!.last4}`,
          }
        : { date },
      urgent: false,
      dismissKey: `${KEY_PREFIX}.${workspaceId}.trial.${dayStamp(now)}`,
    };
  }

  // TR14: once, until dismissed.
  const earned = billing.referralEarnedAt;
  if (earned && earned > (billing.referralNoticeDismissedAt ?? 0) && billing.referralEarnedAmount && billing.referralEarnedCurrency) {
    return {
      messageKey: "plan.referralEarned",
      params: { amount: formatMinorUnits(billing.referralEarnedAmount, billing.referralEarnedCurrency, lang) },
      urgent: false,
      good: true,
      dismissKey: `${KEY_PREFIX}.${workspaceId}.referral.${earned}`,
      serverDismiss: true,
    };
  }
  return null;
}

/** Stripe's brand ids are lower-case machine words; a person reads "Visa". */
export function cardBrand(brand: string): string {
  const names: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners Club", unionpay: "UnionPay" };
  return names[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}
