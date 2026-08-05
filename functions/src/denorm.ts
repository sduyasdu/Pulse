import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { isSelfMaintainedChange, log, logError } from "./lib/conventions";

// SF1 — Feature denormalization maintainer (Server-Functions-Spec.md §3 SF1,
// Permissions-Spec.md §4.2). Owns the two scalar fields the security rules read
// to enforce the scoped roles:
//   - Feature.assignedUids: linked account uids of every resource on the task or
//     any subtask (deduped, sorted; unlinked excluded) → My-Beat read scope.
//   - Feature.leadUid: the linked uid of the `lead` resource, or null → Task Lead
//     write scope.
// Authoritative server copy of the client's interim (src/domain/denorm.ts +
// pulseStore.reconcileDenorms). Idempotent and loop-safe (§1).

// The keys this function owns — used for loop-avoidance (skip our own writes).
const DENORM_KEYS = ["assignedUids", "leadUid"] as const;

type FeatureData = FirebaseFirestore.DocumentData;
type LinkOf = (resourceId: string) => string | null;

const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Every resource id a feature references — directly or through a subtask or lead. */
function referencedResourceIds(feature: FeatureData): string[] {
  const direct = asStringArray(feature.resources);
  const children = Array.isArray(feature.children) ? (feature.children as FeatureData[]) : [];
  const sub = children.flatMap((c) => asStringArray(c?.resources));
  const lead = typeof feature.lead === "string" ? [feature.lead] : [];
  return [...new Set([...direct, ...sub, ...lead])];
}

/** Recompute the denorm fields — mirrors `featureDenorm` in src/domain/denorm.ts. */
function computeDenorm(feature: FeatureData, linkOf: LinkOf): { assignedUids: string[]; leadUid: string | null } {
  const children = Array.isArray(feature.children) ? (feature.children as FeatureData[]) : [];
  const ids = [...asStringArray(feature.resources), ...children.flatMap((c) => asStringArray(c?.resources))];
  const assignedUids = [...new Set(ids.map((rid) => linkOf(rid)).filter((u): u is string => !!u))].sort();
  const lead = typeof feature.lead === "string" ? feature.lead : null;
  const leadUid = lead ? linkOf(lead) : null;
  return { assignedUids, leadUid };
}

/** Order-independent equality of a feature's stored denorms vs. the computed ones. */
function denormMatches(feature: FeatureData, want: { assignedUids: string[]; leadUid: string | null }): boolean {
  const cur = asStringArray(feature.assignedUids);
  return (
    (feature.leadUid ?? null) === want.leadUid &&
    cur.length === want.assignedUids.length &&
    cur.every((u) => want.assignedUids.includes(u))
  );
}

/** Does this feature reference the given resource id anywhere? */
function featureReferences(feature: FeatureData, resourceId: string): boolean {
  return referencedResourceIds(feature).includes(resourceId);
}

/** Build a resourceId → linkedUid lookup for a bounded set of ids (getAll). */
async function buildLinkOf(db: FirebaseFirestore.Firestore, pulseId: string, ids: string[]): Promise<LinkOf> {
  const map = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  if (unique.length) {
    const refs = unique.map((id) => db.doc(`pulses/${pulseId}/resources/${id}`));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) map.set(s.id, s.exists ? ((s.data()?.linkedUid as string | null) ?? null) : null);
  }
  return (rid) => map.get(rid) ?? null;
}

/**
 * A feature write → recompute *its own* denorms from the resources it references.
 * Skips the function's own denorm-only writes (loop-avoidance) and no-ops when
 * the stored value is already correct (idempotent).
 */
export const onFeatureWriteDenorm = onDocumentWritten("pulses/{pulseId}/features/{featureId}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return; // deleted → nothing to maintain
  const before = event.data?.before;
  const feature = after.data() as FeatureData;

  // If the only thing that changed was our own denorm write, stop the loop.
  if (before?.exists && isSelfMaintainedChange(before.data(), feature, DENORM_KEYS)) return;

  const { pulseId, featureId } = event.params;
  try {
    const db = getFirestore();
    const linkOf = await buildLinkOf(db, pulseId, referencedResourceIds(feature));
    const want = computeDenorm(feature, linkOf);
    if (denormMatches(feature, want)) return; // already correct
    await after.ref.update(want);
    log("SF1.feature", "denorm updated", { pulseId, featureId, assigned: want.assignedUids.length, leadUid: want.leadUid });
  } catch (err) {
    logError("SF1.feature", "denorm update failed", err, { pulseId, featureId });
    throw err; // let the platform retry
  }
});

/**
 * A resource write → if its `linkedUid` changed (linked / unlinked / deleted),
 * fan out: recompute every feature in the Pulse that references this resource.
 * This is the case the client interim can't do atomically (Server-Functions-Spec
 * SF1 "linkedUid fan-out").
 */
export const onResourceWriteFanout = onDocumentWritten("pulses/{pulseId}/resources/{resourceId}", async (event) => {
  const beforeLink = event.data?.before?.exists ? ((event.data.before.data()?.linkedUid as string | null) ?? null) : null;
  const afterLink = event.data?.after?.exists ? ((event.data.after.data()?.linkedUid as string | null) ?? null) : null;
  if (beforeLink === afterLink) return; // link unchanged → no denorm impact

  const { pulseId, resourceId } = event.params;
  try {
    const db = getFirestore();
    const [featuresSnap, resourcesSnap] = await Promise.all([
      db.collection(`pulses/${pulseId}/features`).get(),
      db.collection(`pulses/${pulseId}/resources`).get(),
    ]);
    const linkMap = new Map<string, string | null>();
    for (const r of resourcesSnap.docs) linkMap.set(r.id, (r.data()?.linkedUid as string | null) ?? null);
    const linkOf: LinkOf = (rid) => linkMap.get(rid) ?? null;

    const batch = db.batch();
    let updated = 0;
    for (const doc of featuresSnap.docs) {
      const feature = doc.data() as FeatureData;
      if (!featureReferences(feature, resourceId)) continue;
      const want = computeDenorm(feature, linkOf);
      if (denormMatches(feature, want)) continue;
      batch.update(doc.ref, want);
      updated++;
    }
    if (updated) await batch.commit();
    log("SF1.fanout", "recomputed features after resource link change", { pulseId, resourceId, updated });
  } catch (err) {
    logError("SF1.fanout", "fan-out failed", err, { pulseId, resourceId });
    throw err;
  }
});
