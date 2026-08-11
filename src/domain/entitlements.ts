import type { BillingDoc, Entitlements, PlanTier } from "@/types";

// Tier → quota resolution (Plans-Spec.md §3). Pure and React-free so it's
// unit-testable and usable from both the client and (later) the rules-mirroring
// server checks.
//
// The model is **quantity-only**: every tier has every feature; tiers differ
// solely by these limits. `null` = unlimited. Starter is the free default.
//
//  Tier      | $/editor/mo | editor seats        | pulses | collaborators | resources/pulse
//  --------- | ----------- | ------------------- | ------ | ------------- | ---------------
//  Starter   | $0          | 1 (fixed, free)     |   3    |     10        |     20
//  Pro       | $6          | per purchased seat  |   5    |     20        |     40
//  Business  | $12         | per purchased seat  |   ∞    |      ∞        |      ∞
export const TIER_ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  starter: { maxEditors: 1, maxPulses: 3, maxCollaborators: 10, maxResourcesPerPulse: 20 },
  pro: { maxEditors: null, maxPulses: 5, maxCollaborators: 20, maxResourcesPerPulse: 40 },
  business: { maxEditors: null, maxPulses: null, maxCollaborators: null, maxResourcesPerPulse: null },
};

/** The default free tier — what an org with no subscription gets. */
export const DEFAULT_TIER: PlanTier = "starter";
export const STARTER_ENTITLEMENTS = TIER_ENTITLEMENTS.starter;

/** Every tier, in upgrade order — the order the plan picker renders them. */
export const ALL_TIERS: PlanTier[] = ["starter", "pro", "business"];

/**
 * Monthly USD list price **per editor seat** (Plans-Spec §2, PL1 — decided).
 *
 * ⚠️ Display only. **Stripe is the source of truth for what is actually
 * charged**: Checkout bills the price attached to the product carrying the
 * matching `tier` metadata, not this number. They agree today; if the Stripe
 * price is ever edited without updating this, the picker will advertise a stale
 * figure. Sourcing it from Stripe would need a `listPlans` callable.
 */
export const TIER_PRICE_USD: Record<PlanTier, number> = { starter: 0, pro: 6, business: 12 };

/**
 * Days a delinquent org keeps its paid entitlements before resolving to Starter.
 * Plans-Spec §5.1: "ride Stripe's dunning — treat `past_due` as still-paid for a
 * short grace window". A failed card is usually a expired-card annoyance, not a
 * decision to stop paying, so the org keeps working while Stripe retries.
 */
export const DELINQUENCY_GRACE_DAYS = 15;
const GRACE_MS = DELINQUENCY_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * When the grace window closes for a delinquent org, or `null` if it isn't
 * delinquent. Measured from `pastDueSince` (stamped by SF3 on the first failed
 * charge); falls back to `updatedAt` for docs written before that field existed,
 * so an old doc gets a window rather than dropping instantly.
 */
function graceEndsAt(billing: BillingDoc | null | undefined): number | null {
  if (!billing || billing.status !== "past_due") return null;
  const startedAt = billing.pastDueSince ?? billing.updatedAt;
  return startedAt + GRACE_MS;
}

/**
 * The tier a billing doc grants. Absent doc = Starter (Plans-Spec §4).
 *
 * `past_due` keeps the paid tier until the grace window closes
 * (DELINQUENCY_GRACE_DAYS), then resolves to Starter. Every other non-active status
 * resolves to Starter immediately — the conservative free default (per PL4,
 * enforcement stays graceful/read-only, never destructive).
 *
 * `now` is injectable so callers can render a projected state and so this stays
 * deterministic under test.
 */
export function tierOf(billing: BillingDoc | null | undefined, now: number = Date.now()): PlanTier {
  if (!billing) return DEFAULT_TIER;
  if (billing.status === "active" || billing.status === "trialing") return billing.tier;
  const graceEnd = graceEndsAt(billing);
  if (graceEnd !== null && now < graceEnd) return billing.tier;
  return DEFAULT_TIER;
}

/** Resolve the effective quota limits from a billing doc (absent ⇒ Starter). */
export function entitlementsFor(billing: BillingDoc | null | undefined, now: number = Date.now()): Entitlements {
  return TIER_ENTITLEMENTS[tierOf(billing, now)];
}

/** What to warn a delinquent org about, and how urgently. */
export interface Delinquency {
  /** The org is `past_due` — payment failed and Stripe is retrying. */
  isDelinquent: boolean;
  /** The grace window has closed: entitlements have ALREADY dropped to Starter. */
  expired: boolean;
  /** Whole days left in the window, floored at 0. 0 means "closes today". */
  daysRemaining: number;
  /** When the window closes (epoch millis), or null when not delinquent. */
  expiresAt: number | null;
}

const NOT_DELINQUENT: Delinquency = { isDelinquent: false, expired: false, daysRemaining: 0, expiresAt: null };

/**
 * The delinquency warning state for an org (Plans-Spec §5.1). Drives the
 * "payment failed — fix it within N days" notice shown during the grace window,
 * and the "your plan has dropped to Starter" notice after it closes.
 *
 * Only the org owner can read the billing doc (firestore.rules), so only they
 * can be warned; everyone else sees `isDelinquent: false` because their read
 * resolves to null.
 */
export function delinquency(billing: BillingDoc | null | undefined, now: number = Date.now()): Delinquency {
  const expiresAt = graceEndsAt(billing);
  if (expiresAt === null) return NOT_DELINQUENT;
  return {
    isDelinquent: true,
    expired: now >= expiresAt,
    daysRemaining: Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))),
    expiresAt,
  };
}

/**
 * The hard limit on editor seats for an org. Starter is fixed at 1 (the owner);
 * Pro/Business are limited only by the seats they've bought (`billing.seats`).
 * Returns `null` only if a paid tier reports no seat count (treated as unlimited
 * pending the seat sync — enforcement should fail open here, never lock the
 * owner out).
 */
export function editorSeatLimit(billing: BillingDoc | null | undefined, now: number = Date.now()): number | null {
  const cap = entitlementsFor(billing, now).maxEditors;
  if (cap != null) return cap; // Starter → 1
  return billing?.seats ?? null; // Pro/Business → purchased seats
}
