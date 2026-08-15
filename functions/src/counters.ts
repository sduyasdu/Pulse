import { onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
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
