import type { BillingDoc, Entitlements, PlanTier } from "@/types";

// Tier → entitlements resolution (Plans-Spec.md §3). Pure and React-free so it's
// unit-testable and usable from both the client and (later) the rules-mirroring
// server checks.
//
// ⚠️ PLACEHOLDER VALUES. The tier set (PL1), which features are gated (PL2), and
// the quota numbers (PL3) are open product decisions. The map below encodes the
// *recommended* split from Plans-Spec §3.1/§3.2 so the shape is real and easy to
// swap — do NOT treat the specific flags/numbers as final. `null` quota =
// unlimited.
export const TIER_ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  free: { scopedRoles: false, teams: false, advancedCaps: false, maxPulses: 3, maxMembersPerPulse: 3, maxResourcesPerPulse: 15 },
  pro: { scopedRoles: true, teams: false, advancedCaps: true, maxPulses: null, maxMembersPerPulse: 10, maxResourcesPerPulse: null },
  team: { scopedRoles: true, teams: true, advancedCaps: true, maxPulses: null, maxMembersPerPulse: null, maxResourcesPerPulse: null },
};

export const FREE_ENTITLEMENTS = TIER_ENTITLEMENTS.free;

/**
 * The tier a billing doc grants. Absent doc = Free (Plans-Spec §4). A
 * non-active/-trialing status also resolves to Free — a conservative default
 * until PL4 pins exact downgrade behaviour (recommend graceful/read-only, so
 * enforcement code should still avoid destructive action on downgrade).
 */
export function tierOf(billing: BillingDoc | null | undefined): PlanTier {
  if (!billing) return "free";
  if (billing.status !== "active" && billing.status !== "trialing") return "free";
  return billing.tier;
}

/** Resolve the effective entitlements from a billing doc (absent ⇒ Free). */
export function entitlementsFor(billing: BillingDoc | null | undefined): Entitlements {
  return TIER_ENTITLEMENTS[tierOf(billing)];
}
