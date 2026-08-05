import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { log, logError } from "./lib/conventions";

// SF6–SF9 — cross-user integrity & cleanup on delete (Server-Functions-Spec.md,
// Backend-Architecture-Spec.md §B). These are the **server-mandatory** cases: a
// client cannot delete another user's self-owned docs (`users/{uid}/myPulses`,
// presence, notifications), so there is no safe client interim — only the
// dashboard's `myPulses` self-heal partly covers it. All idempotent (re-delete
// is a no-op).

type Data = FirebaseFirestore.DocumentData;
const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** True while the Pulse doc still exists — i.e. this is a single-doc delete, not
 * a whole-Pulse teardown (which SF6 owns). SF7–9 skip during a teardown. */
async function pulseAlive(db: FirebaseFirestore.Firestore, pulseId: string): Promise<boolean> {
  return (await db.doc(`pulses/${pulseId}`).get()).exists;
}

/**
 * SF6 — Pulse delete cascade. Purge every remaining subcollection under the
 * (already-deleted) Pulse doc, and every member's dashboard index entry. Member
 * `myPulses` are found by a collectionGroup query on `pulseId` rather than by
 * reading `pulseMembers` — the client races to delete `pulseMembers` on teardown,
 * so that read is unreliable; the index query is not.
 */
export const onPulseDelete = onDocumentDeleted("pulses/{pulseId}", async (event) => {
  const { pulseId } = event.params;
  const db = getFirestore();
  try {
    const writer = db.bulkWriter();
    // Cross-user dashboard index entries (users/{uid}/myPulses/{pulseId}).
    const idx = await db.collectionGroup("myPulses").where("pulseId", "==", pulseId).get();
    for (const d of idx.docs) writer.delete(d.ref);
    await writer.close();
    // Everything under the Pulse tree (features, epics, resources, comments,
    // costs, rates, notifications, presence, activity, pulseMembers, invites…).
    await db.recursiveDelete(db.doc(`pulses/${pulseId}`));
    log("SF6.pulseDelete", "purged pulse", { pulseId, indexEntries: idx.size });
  } catch (err) {
    logError("SF6.pulseDelete", "cascade failed", err, { pulseId });
    throw err;
  }
});

/**
 * SF7 — Membership-removal cleanup. When a member is removed from a live Pulse,
 * clean the docs the removing admin has no permission to touch: the member's
 * dashboard index entry, their presence, notifications addressed to them, and
 * unlink them from any resource (SF1's fan-out then re-derives feature denorms).
 */
export const onMemberRemoved = onDocumentDeleted("pulses/{pulseId}/pulseMembers/{uid}", async (event) => {
  const { pulseId, uid } = event.params;
  const db = getFirestore();
  try {
    if (!(await pulseAlive(db, pulseId))) return; // whole-Pulse teardown → SF6 owns it
    const writer = db.bulkWriter();
    writer.delete(db.doc(`users/${uid}/myPulses/${pulseId}`));
    writer.delete(db.doc(`pulses/${pulseId}/presence/${uid}`));
    const notifs = await db.collection(`pulses/${pulseId}/notifications`).where("targetUid", "==", uid).get();
    for (const d of notifs.docs) writer.delete(d.ref);
    const linked = await db.collection(`pulses/${pulseId}/resources`).where("linkedUid", "==", uid).get();
    for (const d of linked.docs) writer.update(d.ref, { linkedUid: null });
    await writer.close();
    log("SF7.memberRemoved", "cleaned up removed member", { pulseId, uid, notifs: notifs.size, unlinked: linked.size });
  } catch (err) {
    logError("SF7.memberRemoved", "cleanup failed", err, { pulseId, uid });
    throw err;
  }
});

/**
 * SF8 — Resource-delete integrity. Strip the deleted resource id from every
 * feature's `resources`, its subtasks' `resources`, and `lead`. SF1 then
 * re-derives `assignedUids`/`leadUid` from the updated features.
 */
export const onResourceDelete = onDocumentDeleted("pulses/{pulseId}/resources/{resourceId}", async (event) => {
  const { pulseId, resourceId } = event.params;
  const db = getFirestore();
  try {
    if (!(await pulseAlive(db, pulseId))) return; // teardown → SF6
    const feats = await db.collection(`pulses/${pulseId}/features`).get();
    const writer = db.bulkWriter();
    let n = 0;
    for (const doc of feats.docs) {
      const f = doc.data() as Data;
      const children = Array.isArray(f.children) ? (f.children as Data[]) : [];
      const inResources = asArr(f.resources).includes(resourceId);
      const inChildren = children.some((c) => asArr(c?.resources).includes(resourceId));
      const isLead = f.lead === resourceId;
      if (!inResources && !inChildren && !isLead) continue;
      const patch: Data = {};
      if (inResources) patch.resources = asArr(f.resources).filter((r) => r !== resourceId);
      if (inChildren) patch.children = children.map((c) => ({ ...c, resources: asArr(c?.resources).filter((r) => r !== resourceId) }));
      if (isLead) patch.lead = null;
      writer.update(doc.ref, patch);
      n++;
    }
    await writer.close();
    log("SF8.resourceDelete", "stripped resource from features", { pulseId, resourceId, features: n });
  } catch (err) {
    logError("SF8.resourceDelete", "integrity update failed", err, { pulseId, resourceId });
    throw err;
  }
});

/**
 * SF9 — Epic-delete integrity. Clear `epicId` on every feature that pointed at
 * the deleted epic (they become epic-less rather than dangling).
 */
export const onEpicDelete = onDocumentDeleted("pulses/{pulseId}/epics/{epicId}", async (event) => {
  const { pulseId, epicId } = event.params;
  const db = getFirestore();
  try {
    if (!(await pulseAlive(db, pulseId))) return; // teardown → SF6
    const feats = await db.collection(`pulses/${pulseId}/features`).where("epicId", "==", epicId).get();
    if (feats.empty) return;
    const writer = db.bulkWriter();
    for (const doc of feats.docs) writer.update(doc.ref, { epicId: null });
    await writer.close();
    log("SF9.epicDelete", "cleared epicId on orphaned features", { pulseId, epicId, features: feats.size });
  } catch (err) {
    logError("SF9.epicDelete", "integrity update failed", err, { pulseId, epicId });
    throw err;
  }
});
