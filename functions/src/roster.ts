import { onDocumentWritten, onDocumentCreated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
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

/** The uid of the workspace member with this email, or null.
 *
 * Matches on the denormalized `WorkspaceMember.email` (RM16) rather than reading
 * each member's user document — one query instead of N lookups. Both sides are
 * stored in `emailKey()` form (trimmed, lowercased), so this is a plain equality
 * and `Ana@x.com` and `ana@x.com` are the same person. */
async function uidForEmail(db: Db, workspaceId: string, email: string): Promise<string | null> {
  const snap = await db
    .collection(`workspaces/${workspaceId}/workspaceMembers`)
    .where("email", "==", email)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

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

// Exported for the integration tests: the two pieces where being wrong is
// silent — the email match, and the comparison that terminates the trigger.
export const uidForEmailForTest = uidForEmail;
export const applyResolutionForTest = applyResolution;
