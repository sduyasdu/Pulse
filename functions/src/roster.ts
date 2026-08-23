import { onDocumentWritten, onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { log, logError } from "./lib/conventions";

// Resource master — resolving a linked email to a uid (Resource-Master-Spec §5,
// RM6/RM16/RM17).
//
// A roster entry names a person by **email**, which is what someone meant and
// works before that person has an account. `linkedUid` is not the link — it is
// what the email resolved to once they turned out to be a workspace member.
//
// That split is why this file exists. With a single uid field there was nothing
// to say "this seat is for Ana, who has not joined yet", and clearing the uid on
// removal fought propagation trying to write it back. Here the intent is stable
// and the resolution is derived, so a removal and a re-join are just the
// resolution changing.
//
// **These functions are the only writer of `linkedUid`** — firestore.rules
// refuses it from any client, because a forged uid would fake the "live" half of
// the live/waiting distinction the UI shows (RM20).

type Db = FirebaseFirestore.Firestore;

const FN = "RM16.roster";

/** Canonical email form. Mirrors `emailKey()` in
 * `src/services/firestore/emailKey.ts` — functions cannot import from the app,
 * so the two must be kept in step. */
export const emailKey = (email: string) => email.trim().toLowerCase();

/**
 * The uid of the member of `collectionPath` whose email is `email`, or null.
 *
 * **Compares in code rather than with a `where()` query, deliberately.** Member
 * emails are NOT reliably normalised in existing data: invite acceptance writes
 * them through `emailKey()`, while the copy-link join, Pulse creation and the
 * owner-email backfill all wrote the raw address. An equality query would
 * therefore miss anyone with a capital letter in their address — silently, in
 * the mechanism that decides whether someone shows as linked. Both writers are
 * fixed going forward, but the data already out there is mixed, and a scan is
 * immune to that.
 *
 * Affordable because membership is small and capped by plan
 * (`maxCollaborators` is 10 / 20 / unlimited).
 */
async function uidForEmailIn(db: Db, collectionPath: string, email: string): Promise<string | null> {
  const want = emailKey(email);
  const snap = await db.collection(collectionPath).get();
  for (const d of snap.docs) {
    const stored = d.data()?.email;
    if (typeof stored === "string" && emailKey(stored) === want) return d.id;
  }
  return null;
}

const uidForEmail = (db: Db, workspaceId: string, email: string) =>
  uidForEmailIn(db, `workspaces/${workspaceId}/workspaceMembers`, email);

/** Write a resolution only when it actually changes.
 *
 * This is what stops the trigger from re-entering forever: our own write fires
 * `onDocumentWritten` again, the desired value now equals the stored one, and
 * the second pass returns without writing. */
async function applyResolution(
  ref: FirebaseFirestore.DocumentReference,
  current: string | null,
  desired: string | null,
): Promise<boolean> {
  if (current === desired) return false;
  await ref.set({ linkedUid: desired }, { merge: true });
  return true;
}

/**
 * A roster entry was written — resolve its email if the intent changed, or if it
 * is set but still waiting.
 *
 * Deliberately does NOT query on every write: renaming a resource must not cost
 * a membership lookup. It runs when `linkedEmail` changed, or when an email is
 * present with no uid — which is exactly the state a newly created or
 * newly linked entry is in.
 */
export const onMasterResourceWriteResolve = onDocumentWritten(
  "workspaces/{workspaceId}/resources/{resourceId}",
  async (event) => {
    const { workspaceId, resourceId } = event.params;
    const after = event.data?.after;
    if (!after?.exists) return; // deleted — nothing to resolve

    const before = event.data?.before;
    const emailBefore = (before?.exists ? before.data()?.linkedEmail : null) ?? null;
    const emailAfter = (after.data()?.linkedEmail as string | null) ?? null;
    const uidNow = (after.data()?.linkedUid as string | null) ?? null;

    const intentChanged = emailAfter !== emailBefore;
    const waiting = emailAfter !== null && uidNow === null;
    if (!intentChanged && !waiting) return;

    try {
      const desired = emailAfter ? await uidForEmail(getFirestore(), workspaceId, emailAfter) : null;
      if (await applyResolution(after.ref, uidNow, desired)) {
        log(FN, "resolved roster link", { workspaceId, resourceId, email: emailAfter, uid: desired });
      }
    } catch (err) {
      logError(FN, "roster link resolution failed", err, { workspaceId, resourceId });
      throw err;
    }
  },
);

/**
 * Someone joined the workspace — resolve every roster entry that was waiting for
 * them.
 *
 * This is the half that makes rostering-before-joining work: an entry sits with
 * an email and no uid until the person accepts, and then simply becomes live.
 * Nobody has to remember to go back and link it.
 */
export const onWorkspaceMemberJoinResolve = onDocumentCreated(
  "workspaces/{workspaceId}/workspaceMembers/{memberUid}",
  async (event) => {
    const { workspaceId, memberUid } = event.params;
    const email = (event.data?.data()?.email as string | null) ?? null;
    if (!email) return; // member docs written before RM16 carry no email

    try {
      const db = getFirestore();
      const waiting = await db
        .collection(`workspaces/${workspaceId}/resources`)
        .where("linkedEmail", "==", email)
        .get();
      let resolved = 0;
      for (const d of waiting.docs) {
        if (await applyResolution(d.ref, (d.data()?.linkedUid as string | null) ?? null, memberUid)) resolved += 1;
      }
      if (resolved) log(FN, "resolved on join", { workspaceId, memberUid, resolved });
    } catch (err) {
      logError(FN, "resolution on join failed", err, { workspaceId, memberUid });
      throw err;
    }
  },
);

/**
 * Someone left the workspace — clear the resolution, keep the intent (RM17).
 *
 * The workspace-level mirror of what SF7 does inside a Pulse. Losing membership
 * is not a statement about who a roster entry *is*, so `linkedEmail` survives and
 * a re-join re-resolves it. Only an explicit unlink clears the email, and only a
 * client does that.
 */
export const onWorkspaceMemberLeaveUnresolve = onDocumentDeleted(
  "workspaces/{workspaceId}/workspaceMembers/{memberUid}",
  async (event) => {
    const { workspaceId, memberUid } = event.params;
    try {
      const db = getFirestore();
      // Guard against a workspace teardown: without it these writes would
      // recreate roster documents under a workspace that is being deleted.
      if (!(await db.doc(`workspaces/${workspaceId}`).get()).exists) return;

      const linked = await db
        .collection(`workspaces/${workspaceId}/resources`)
        .where("linkedUid", "==", memberUid)
        .get();
      for (const d of linked.docs) await applyResolution(d.ref, memberUid, null);
      if (linked.size) log(FN, "unresolved on leave", { workspaceId, memberUid, cleared: linked.size });
    } catch (err) {
      logError(FN, "unresolve on leave failed", err, { workspaceId, memberUid });
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// The same mechanism, one level down: a Pulse's own resources (RM16, second
// trigger).
//
// A Pulse resource copied from a master arrives with an email and no uid,
// because the master's uid means "member of the workspace" and says nothing
// about THIS Pulse. It resolves here, against this Pulse's own membership — and
// stays unresolved, correctly, for someone who is not a collaborator (RM20's
// "waiting" state).
//
// Removal is already handled: SF7 (`cascade.ts`) clears `linkedUid` when a
// member is removed and leaves `linkedEmail` alone, which is exactly RM17.
// ---------------------------------------------------------------------------

export const onPulseResourceWriteResolve = onDocumentWritten(
  "pulses/{pulseId}/resources/{resourceId}",
  async (event) => {
    const { pulseId, resourceId } = event.params;
    const after = event.data?.after;
    if (!after?.exists) return;

    const before = event.data?.before;
    const emailBefore = (before?.exists ? before.data()?.linkedEmail : null) ?? null;
    const emailAfter = (after.data()?.linkedEmail as string | null) ?? null;
    const uidNow = (after.data()?.linkedUid as string | null) ?? null;
    if (emailAfter === emailBefore && !(emailAfter !== null && uidNow === null)) return;

    try {
      const desired = emailAfter
        ? await uidForEmailIn(getFirestore(), `pulses/${pulseId}/pulseMembers`, emailAfter)
        : null;
      if (await applyResolution(after.ref, uidNow, desired)) {
        log(FN, "resolved pulse link", { pulseId, resourceId, email: emailAfter, uid: desired });
      }
    } catch (err) {
      logError(FN, "pulse link resolution failed", err, { pulseId, resourceId });
      throw err;
    }
  },
);

export const onPulseMemberJoinResolve = onDocumentCreated(
  "pulses/{pulseId}/pulseMembers/{memberUid}",
  async (event) => {
    const { pulseId, memberUid } = event.params;
    const stored = event.data?.data()?.email;
    if (typeof stored !== "string" || !stored) return;
    const email = emailKey(stored);

    try {
      const db = getFirestore();
      // Scanned rather than queried, for the same normalisation reason as
      // `uidForEmailIn`: resources copied from a roster carry a normalised
      // email, but nothing guarantees what a hand-made link stored.
      const resources = await db.collection(`pulses/${pulseId}/resources`).get();
      let resolved = 0;
      for (const d of resources.docs) {
        const want = d.data()?.linkedEmail;
        if (typeof want !== "string" || emailKey(want) !== email) continue;
        if (await applyResolution(d.ref, (d.data()?.linkedUid as string | null) ?? null, memberUid)) resolved += 1;
      }
      if (resolved) log(FN, "resolved pulse links on join", { pulseId, memberUid, resolved });
    } catch (err) {
      logError(FN, "pulse resolution on join failed", err, { pulseId, memberUid });
      throw err;
    }
  },
);

/**
 * A roster entry was deleted — DETACH its copies, never delete them (RM13).
 *
 * A Pulse's plan must not lose its people because someone tidied the roster, and
 * a departed person's past work still has to cost and report correctly. Clearing
 * `masterId` leaves each copy intact and self-sufficient, and buys a real
 * simplification: **`masterId` can never dangle**, so no reader anywhere has to
 * handle a pointer to a missing master.
 *
 * This has to be a server trigger. The workspace owner doing the deleting is
 * routinely not a member of the Pulses holding copies, so the rules would refuse
 * them the write — and widening that rule to allow it would be far worse than the
 * problem.
 *
 * `collectionGroup("resources")` also spans `workspaces/*​/resources`, i.e. the
 * masters themselves; harmless, because a master carries no `masterId` and so
 * never matches. Single-field collection-group queries are served by Firestore's
 * automatic index (same as SF6's `myPulses` sweep).
 *
 * **Phase 6 will add a second half.** RM13 requires the detach to clear
 * `inherited` on `pulses/{id}/rates/{resourceId}` too — a rate still marked as
 * tracking a master that no longer exists is a dangling reference in the one
 * place a mistake is denominated in currency. That collection does not carry the
 * flag yet (master rates are phase 6), so there is nothing to clear today; when
 * it does, it belongs here.
 */
export const onMasterResourceDeletedDetach = onDocumentDeleted(
  "workspaces/{workspaceId}/resources/{resourceId}",
  async (event) => {
    const { workspaceId, resourceId } = event.params;
    try {
      const db = getFirestore();
      const copies = await db.collectionGroup("resources").where("masterId", "==", resourceId).get();
      if (copies.empty) return;
      const writer = db.bulkWriter();
      // FieldValue.delete() rather than null: a null masterId would still read as
      // "has a provenance field", and `masterId` present is what RM2 treats as
      // "identity tracks the master".
      for (const d of copies.docs) writer.update(d.ref, { masterId: FieldValue.delete() });
      await writer.close();
      log(FN, "detached copies of a deleted master", { workspaceId, resourceId, detached: copies.size });
    } catch (err) {
      logError(FN, "detach after master delete failed", err, { workspaceId, resourceId });
      throw err;
    }
  },
);

// Exported for the integration tests: the two pieces where being wrong is
// silent — the email match, and the comparison that terminates the trigger.
export const uidForEmailForTest = uidForEmail;
export const uidForEmailInForTest = uidForEmailIn;
export const applyResolutionForTest = applyResolution;
