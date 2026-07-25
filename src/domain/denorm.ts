import type { Feature } from "@/types";

/**
 * The permission denorm fields for a feature (Permissions-Spec §4.2 /
 * Server-Functions-Spec SF1):
 *  - `assignedUids` — the linked account uid of every resource on the task OR
 *    any of its subtasks (deduped, sorted for stability; unlinked resources
 *    excluded). Enables the My-Beat read scope (`uid in assignedUids`).
 *  - `leadUid` — the linked uid of the `lead` resource, or null. Enables the
 *    Task Lead write scope (`uid == leadUid`).
 *
 * `linkOf` maps a resource id to its `linkedUid` (null/undefined = unlinked).
 */
export function featureDenorm(
  feature: Pick<Feature, "resources" | "children" | "lead">,
  linkOf: (resourceId: string) => string | null | undefined,
): { assignedUids: string[]; leadUid: string | null } {
  const ids = [...(feature.resources || []), ...(feature.children || []).flatMap((c) => c.resources || [])];
  const assignedUids = [...new Set(ids.map((rid) => linkOf(rid)).filter((u): u is string => !!u))].sort();
  const leadUid = feature.lead ? linkOf(feature.lead) ?? null : null;
  return { assignedUids, leadUid };
}

/** True when a feature's stored denorms already match the computed ones (so the
 * reconcile loop skips writing). Order-independent on `assignedUids`. */
export function denormMatches(feature: Feature, want: { assignedUids: string[]; leadUid: string | null }): boolean {
  const cur = feature.assignedUids ?? [];
  return (
    (feature.leadUid ?? null) === want.leadUid &&
    cur.length === want.assignedUids.length &&
    cur.every((u) => want.assignedUids.includes(u))
  );
}
