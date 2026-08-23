import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { log, logError } from "./lib/conventions";

// SF11 — quota counters (Plans-Spec §5 PL5 option b, Server-Functions-Spec,
// Billing-and-Backend-Build-Plan Phase 3).
//
// Security rules can neither count a collection nor sort one, so a quota like
// "at most 3 Pulses on Starter" needs the count materialized onto a document the
// rules can `get()`. This function owns `workspaces/{id}.pulseCount`.
//
// **Server-maintained, never client-written.** A client that could set its own
// counter could set it to 0, and the gate would be decoration. firestore.rules
// blocks `pulseCount` in the workspace update rule; the Admin SDK bypasses rules,
// which is what makes this function the authoritative writer.
//
// **Counts every Pulse the org holds — archived and hidden included** (§3.2,
// PL12), so the counter moves on create and delete ONLY. Archive/unarchive and
// hide/unhide never touch it, and unarchiving therefore needs no quota check: it
// cannot raise the count, so it can never take an org over its cap.
//
// **Async, so it is a commercial quota and not a security boundary.** A rapid
// burst of creates can transiently allow one past the cap before the counter
// catches up; it converges and blocks at steady state. That trade is accepted in
// PL5 — the security boundary is the plan doc being unwritable, not this.

type Db = FirebaseFirestore.Firestore;

const FN = "SF11.counters";

/**
 * Recount from the collection rather than `FieldValue.increment`.
 *
 * Firestore delivers triggers **at-least-once**, so an incremented counter drifts
 * upward on any redelivery and never repairs itself. Recounting is idempotent —
 * a duplicate delivery writes the same number — and self-healing: whatever the
 * stored value was, the next create or delete in that workspace corrects it. Same
 * reasoning as SF3 refetching the subscription instead of trusting the event
 * payload (`billing.ts`).
 *
 * `count()` is a server-side aggregation, billed at one read per 1000 documents
 * matched, so this stays cheap as an org grows.
 */
async function recountPulses(db: Db, workspaceId: string): Promise<number> {
  const agg = await db.collection("pulses").where("workspaceId", "==", workspaceId).count().get();
  const pulseCount = agg.data().count;
  // merge:true — this doc is owned by the client bootstrap; we contribute one field.
  await db.doc(`workspaces/${workspaceId}`).set({ pulseCount }, { merge: true });
  return pulseCount;
}

/** The workspace a created/deleted Pulse belonged to, or null if unusable. */
function workspaceIdOf(data: FirebaseFirestore.DocumentData | undefined): string | null {
  const id = data?.workspaceId;
  return typeof id === "string" && id ? id : null;
}

export const onPulseCreateCount = onDocumentCreated("pulses/{pulseId}", async (event) => {
  const { pulseId } = event.params;
  const workspaceId = workspaceIdOf(event.data?.data());
  // A Pulse with no workspaceId can't be counted against a plan. Logged rather
  // than thrown: retrying can't conjure the field, so a throw would just burn
  // retries on a permanently unusable document.
  if (!workspaceId) {
    log(FN, "pulse created without workspaceId — not counted", { pulseId });
    return;
  }
  try {
    const pulseCount = await recountPulses(getFirestore(), workspaceId);
    log(FN, "recounted pulses after create", { pulseId, workspaceId, pulseCount });
  } catch (err) {
    logError(FN, "recount after create failed", err, { pulseId, workspaceId });
    throw err; // retry — a stale-high counter locks an org out of its own plan
  }
});

export const onPulseDeleteCount = onDocumentDeleted("pulses/{pulseId}", async (event) => {
  const { pulseId } = event.params;
  const workspaceId = workspaceIdOf(event.data?.data());
  if (!workspaceId) {
    log(FN, "pulse deleted without workspaceId — not counted", { pulseId });
    return;
  }
  try {
    const pulseCount = await recountPulses(getFirestore(), workspaceId);
    log(FN, "recounted pulses after delete", { pulseId, workspaceId, pulseCount });
  } catch (err) {
    logError(FN, "recount after delete failed", err, { pulseId, workspaceId });
    throw err;
  }
});

// ---------------------------------------------------------------------------
// RM10 — per-Pulse resource counter (Resource-Master-Spec §8)
//
// `maxResourcesPerPulse` (20 / 40 / unlimited) has only ever been enforced in
// the client (`src/domain/entitlements.ts`), so any direct write ignored it. It
// was survivable while people were typed in one at a time; the resource master's
// "copy this team in" makes exceeding it one click, and `duplicatePulse` in full
// mode already copies every resource from its source.
//
// Same shape as `pulseCount` above, for the same reasons — recount rather than
// increment, server-owned so a client cannot zero its own gate. Two differences
// worth knowing, both learned from the collections this sits next to:
//
//   * It **must not resurrect a deleted Pulse.** `deletePulse` is a client-side
//     cascade that removes subcollection docs first, so these triggers routinely
//     fire during a teardown. `set(..., {merge:true})` on a deleted document
//     CREATES it, which would leave a ghost Pulse holding nothing but a count —
//     and SF6 has already run, so nothing would ever clean it up.
//   * It writes **only when the number changed**, so a burst of deletes during a
//     teardown converges to one write instead of N.
// ---------------------------------------------------------------------------

/**
 * Recount one Pulse's resources onto `pulses/{pulseId}.resourceCount`.
 *
 * Returns null when the Pulse is gone — the caller should treat that as "nothing
 * to do", never as zero.
 */
export async function recountResources(db: Db, pulseId: string): Promise<number | null> {
  const ref = db.doc(`pulses/${pulseId}`);
  const snap = await ref.get();
  if (!snap.exists) return null; // teardown in progress — see the note above

  const agg = await db.collection(`pulses/${pulseId}/resources`).count().get();
  const resourceCount = agg.data().count;
  if (snap.data()?.resourceCount === resourceCount) return resourceCount; // no-op write avoided
  await ref.set({ resourceCount }, { merge: true });
  return resourceCount;
}

export const onResourceCreateCount = onDocumentCreated("pulses/{pulseId}/resources/{resourceId}", async (event) => {
  const { pulseId } = event.params;
  try {
    const resourceCount = await recountResources(getFirestore(), pulseId);
    log(FN, "recounted resources after create", { pulseId, resourceCount });
  } catch (err) {
    logError(FN, "resource recount after create failed", err, { pulseId });
    throw err; // retry — a stale-LOW counter is a hole, a stale-high one is a lockout
  }
});

export const onResourceDeleteCount = onDocumentDeleted("pulses/{pulseId}/resources/{resourceId}", async (event) => {
  const { pulseId } = event.params;
  try {
    const resourceCount = await recountResources(getFirestore(), pulseId);
    log(FN, "recounted resources after delete", { pulseId, resourceCount });
  } catch (err) {
    logError(FN, "resource recount after delete failed", err, { pulseId });
    throw err;
  }
});

/**
 * Daily reconcile — the backfill, and the safety net.
 *
 * Every Pulse that predates this counter has no `resourceCount`, and the rule
 * reads an absent counter as **0**, so those Pulses are uncapped until something
 * happens to touch them. SF11's own `pulseCount` backfill was specified and
 * never run; making it a scheduled reconcile rather than a one-off script is how
 * this one cannot be forgotten — it needs no credentials, no operator, and no
 * remembering.
 *
 * It doubles as repair for a missed trigger, which is worth more than the
 * backfill: Firestore delivers at-least-once, not exactly-once, and a dropped
 * delivery would otherwise leave a wrong number until the next write.
 *
 * Bounded per run and it converges to zero *writes* (never zero reads — one
 * `count()` per Pulse, billed at one read per 1000 documents). Revisit the
 * whole-collection scan if Pulse ever holds tens of thousands.
 */
const RECONCILE_LIMIT = 500;

export const reconcileResourceCounts = onSchedule("every day 04:11", async () => {
  const db = getFirestore();
  try {
    const pulses = await db.collection("pulses").select("resourceCount").limit(RECONCILE_LIMIT).get();
    let corrected = 0;
    for (const d of pulses.docs) {
      const before = d.data()?.resourceCount;
      const after = await recountResources(db, d.id);
      if (after !== null && after !== before) corrected += 1;
    }
    // Logged even at zero: "ran and found nothing" and "did not run" are the two
    // states worth telling apart, and only one of them is fine.
    log(FN, "reconciled resource counts", { scanned: pulses.size, corrected });
  } catch (err) {
    logError(FN, "resource reconcile failed", err);
    throw err;
  }
});
