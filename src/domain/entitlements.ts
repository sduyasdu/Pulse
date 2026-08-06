import type { BillingDoc, Entitlements, PlanTier } from "@/types";

// Tier → quota resolution (Plans-Spec.md §3). Pure and React-free so it's
// unit-testable and usable from both the client and (later) the rules-mirroring
// server checks.
//
// The model is **quantity-only**: every tier has every feature; tiers differ
// solely by these limits. `null` = unlimited. Pro is the free default.
//
//  Tier      | $/editor/mo | editor seats        | pulses | collaborators | resources/pulse
//  --------- | ----------- | ------------------- | ------ | ------------- | ---------------
//  Pro       | $0          | 1 (fixed, free)     |   3    |     10        |     20
//  Teams     | $6          | per purchased seat  |   5    |     20        |     40
//  Business  | $12         | per purchased seat  |   ∞    |      ∞        |      ∞
export const TIER_ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  pro: { maxEditors: 1, maxPulses: 3, maxCollaborators: 10, maxResourcesPerPulse: 20 },
  teams: { maxEditors: null, maxPulses: 5, maxCollaborators: 20, maxResourcesPerPulse: 40 },
  business: { maxEditors: null, maxPulses: null, maxCollaborators: null, maxResourcesPerPulse: null },
};

/** The default free tier — what an org with no subscription gets. */
export const DEFAULT_TIER: PlanTier = "pro";
export const PRO_ENTITLEMENTS = TIER_ENTITLEMENTS.pro;

/**
 * The tier a billing doc grants. Absent doc = Pro (Plans-Spec §4). A
 * non-active/-trialing status also resolves to Pro — the conservative free
 * default (per PL4, enforcement stays graceful/read-only, never destructive).
 */
export function tierOf(billing: BillingDoc | null | undefined): PlanTier {
  if (!billing) return DEFAULT_TIER;
  if (billing.status !== "active" && billing.status !== "trialing") return DEFAULT_TIER;
  return billing.tier;
}

/** Resolve the effective quota limits from a billing doc (absent ⇒ Pro). */
export function entitlementsFor(billing: BillingDoc | null | undefined): Entitlements {
  return TIER_ENTITLEMENTS[tierOf(billing)];
}

/**
 * The hard limit on editor seats for an org. Pro is fixed at 1 (the owner);
 * Teams/Business are limited only by the seats they've bought (`billing.seats`).
 * Returns `null` only if a paid tier reports no seat count (treated as unlimited
 * pending the seat sync — enforcement should fail open here, never lock the
 * owner out).
 */
export function editorSeatLimit(billing: BillingDoc | null | undefined): number | null {
  const cap = entitlementsFor(billing).maxEditors;
  if (cap != null) return cap; // Pro → 1
  return billing?.seats ?? null; // Teams/Business → purchased seats
}
