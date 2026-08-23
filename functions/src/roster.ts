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
 * A workspace member's email became known — resolve every roster entry waiting
 * for it.
 *
 * This is the half that makes rostering-before-joining work: an entry sits with
 * an email and no uid until the person accepts, and then simply becomes live.
 * Nobody has to remember to go back and link it.
 *
 * **`onDocumentWritten`, not `onDocumentCreated`, and that is a fix rather than
 * a preference.** `WorkspaceMember.email` was added with RM16, so every member
 * document written before it carries none — which is all of them, since a
 * personal workspace's member doc is written once at first sign-in and never
 * again. Those emails arrive by backfill, i.e. as an UPDATE. Listening only for
 * creates meant the backfill landed and nothing re-resolved, so every roster
 * entry stayed "Waiting" forever with no way out.
 */
export const onWorkspaceMemberJoinResolve = onDocumentWritten(
  "workspaces/{workspaceId}/workspaceMembers/{memberUid}",
  async (event) => {
    const { workspaceId, memberUid } = event.params;
    const after = event.data?.after;
    if (!after?.exists) return; // removal is handled by the unresolve trigger

    const email = (after.data()?.email as string | null) ?? null;
    if (!email) return; // still no email — nothing to match on

    // Only when the email actually arrived or changed. A role edit must not
    // re-scan the roster, and our own writes are to a different collection so
    // they cannot re-enter here.
    const emailBefore = (event.data?.before?.exists ? event.data.before.data()?.email : null) ?? null;
    if (emailBefore === email) return;

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
 * A roster entry changed — push its IDENTITY down to every copy (RM2, RM22).
 *
 * Only the always-propagate class: name, initials, `role` and `linkedEmail`.
 * Never `capacity`, which is per-Pulse by nature; never `linkedUid`, which means
 * "collaborator on THIS Pulse" and is resolved locally; and never `type`, which
 * since RM24 is the Pulse's OWN category and has nothing to do with the roster.
 *
 * Role and type being one field was the whole problem: the Capacity tab renames
 * a type across a Pulse, and propagation would silently undo that rename. Two
 * fields, two owners, no conflict.
 *
 * Writes only the fields that actually differ, so a capacity edit on the master
 * does not touch a single copy, and a no-op write does not fan out at all.
 */
export const onMasterResourceWritePropagate = onDocumentWritten(
  "workspaces/{workspaceId}/resources/{resourceId}",
  async (event) => {
    const { workspaceId, resourceId } = event.params;
    const after = event.data?.after;
    const before = event.data?.before;
    if (!after?.exists || !before?.exists) return; // create/delete are not propagation

    const a = after.data() ?? {};
    const b = before.data() ?? {};
    // Typed as string|null rather than unknown: every propagated field is one,
    // and `unknown` is not assignable to Firestore's UpdateData.
    const patch: Record<string, string | null> = {};
    for (const field of ["name", "initials", "linkedEmail"] as const) {
      const next = a[field];
      if (next !== b[field]) patch[field] = typeof next === "string" ? next : null;
    }
    // The org role lands on the copy's `role`, NOT its `type` (RM24). A Pulse's
    // `type` is its own category and must never be written from here — writing
    // it was what made the Capacity tab's rename cascade unsafe.
    // `?? type` reads a roster entry written before the split.
    // `before` reads ONLY `role`, while `after` falls back to the pre-split
    // `type`. Deliberately asymmetric: the self-heal that moves a roster entry's
    // role out of `type` into `role` would otherwise look like no change at all
    // (both sides resolving to the same string through the fallback), and the
    // copies would never receive a `role` — which is exactly how existing
    // linked resources ended up showing no role at all.
    //
    // It also means the first edit of ANY kind to a pre-split entry backfills
    // its copies, which is the cheapest migration available: none.
    const roleAfter = (a.role ?? a.type ?? null) as string | null;
    const roleBefore = (b.role ?? null) as string | null;
    if (roleAfter !== roleBefore) patch.role = roleAfter;
    if (Object.keys(patch).length === 0) return;

    try {
      const db = getFirestore();
      const copies = await db.collectionGroup("resources").where("masterId", "==", resourceId).get();
      if (copies.empty) return;
      const writer = db.bulkWriter();
      for (const d of copies.docs) writer.update(d.ref, patch);
      await writer.close();
      log(FN, "propagated identity to copies", { workspaceId, resourceId, fields: Object.keys(patch), copies: copies.size });
    } catch (err) {
      logError(FN, "identity propagation failed", err, { workspaceId, resourceId });
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
 * never matches.
 *
 * **It needs an explicit index, and this is where that was learned the hard
 * way.** An earlier version of this comment claimed single-field collection-group
 * queries are served by Firestore's automatic index. They are not: automatic
 * single-field indexes are COLLECTION-scoped, and a collection-group query needs
 * a `fieldOverrides` entry with `COLLECTION_GROUP` scope — see
 * `firestore.indexes.json`. Without it every call fails with FAILED_PRECONDITION,
 * which the trigger logs and retries forever while the feature silently does
 * nothing.
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
      // Firestore does not delete subcollections with their parent, so the usage
      // index (§6) would outlive the master and stay readable by path. Nothing
      // points at it any more, which is exactly why nothing would ever clean it.
      const usage = await db.collection(`workspaces/${workspaceId}/resources/${resourceId}/usage`).get();
      for (const d of usage.docs) writer.delete(d.ref);
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

// ---------------------------------------------------------------------------
// Where is this person? (Resource-Master-Spec §6, RM7)
//
// `workspaces/{wsId}/resources/{rid}/usage/{pulseId}` — one document per Pulse
// holding a copy, maintained by the server.
//
// A collection-group query over `pulses/*​/resources` would answer the same
// question without an index to maintain, and is the wrong tool: scoping one
// safely in rules is hard to get right and easy to get subtly wrong. An index
// the server owns is readable by "workspace members" and nothing else.
//
// The document id IS the pulse id, so the index is naturally idempotent — a
// duplicated trigger delivery writes the same document twice.
// ---------------------------------------------------------------------------

/** Does any resource in this Pulse still point at this master? Decides whether a
 * delete removes the usage entry, since a Pulse can hold more than one copy of
 * the same person (nothing forbids it, and the picker only guards its own
 * path). */
async function stillUsed(db: Db, pulseId: string, masterId: string): Promise<boolean> {
  const snap = await db.collection(`pulses/${pulseId}/resources`).where("masterId", "==", masterId).limit(1).get();
  return !snap.empty;
}

async function writeUsage(db: Db, pulseId: string, masterId: string): Promise<void> {
  const pulse = await db.doc(`pulses/${pulseId}`).get();
  if (!pulse.exists) return; // teardown — SF6 owns it
  const workspaceId = pulse.data()?.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId) return;
  await db.doc(`workspaces/${workspaceId}/resources/${masterId}/usage/${pulseId}`).set({
    pulseId,
    // Denormalized so the People screen can name a Pulse the viewer cannot open
    // (RM7's accepted disclosure). Kept in step by onPulseRenameSyncUsage below;
    // without that the view goes quietly stale, which is worse than absent.
    pulseName: pulse.data()?.name ?? "",
    workspaceId,
    updatedAt: Date.now(),
  });
}

async function clearUsage(db: Db, pulseId: string, masterId: string, workspaceId?: string): Promise<void> {
  const ws = workspaceId ?? (await db.doc(`pulses/${pulseId}`).get()).data()?.workspaceId;
  if (typeof ws !== "string" || !ws) return;
  await db.doc(`workspaces/${ws}/resources/${masterId}/usage/${pulseId}`).delete().catch(() => {});
}

/**
 * A Pulse resource was created, deleted, or had its `masterId` change — keep the
 * usage index in step.
 *
 * One `onDocumentWritten` rather than a create and a delete pair, because detach
 * (RM13) changes `masterId` on an existing document and that is neither.
 */
export const onPulseResourceUsage = onDocumentWritten(
  "pulses/{pulseId}/resources/{resourceId}",
  async (event) => {
    const { pulseId } = event.params;
    const before = (event.data?.before?.exists ? event.data.before.data()?.masterId : null) ?? null;
    const after = (event.data?.after?.exists ? event.data.after.data()?.masterId : null) ?? null;
    if (before === after) return; // a rename or a capacity edit is not our business

    try {
      const db = getFirestore();
      if (typeof after === "string" && after) await writeUsage(db, pulseId, after);
      // Only when the LAST copy of that master leaves this Pulse.
      if (typeof before === "string" && before && !(await stillUsed(db, pulseId, before))) {
        await clearUsage(db, pulseId, before);
      }
      log(FN, "usage index updated", { pulseId, added: after, removed: before });
    } catch (err) {
      logError(FN, "usage index update failed", err, { pulseId, before, after });
      throw err;
    }
  },
);

/**
 * A Pulse was renamed — refresh the name this index denormalized.
 *
 * RM7 accepted showing the title of a Pulse the viewer cannot open; a title that
 * silently stops matching the real one is a worse disclosure than none, because
 * it is wrong rather than merely revealing.
 */
export const onPulseRenameSyncUsage = onDocumentWritten("pulses/{pulseId}", async (event) => {
  const { pulseId } = event.params;
  const after = event.data?.after;
  if (!after?.exists) return; // deleted — the copies go with it (SF6)
  const nameBefore = (event.data?.before?.exists ? event.data.before.data()?.name : null) ?? null;
  const nameAfter = after.data()?.name ?? null;
  if (nameBefore === nameAfter) return;

  try {
    const db = getFirestore();
    const entries = await db.collectionGroup("usage").where("pulseId", "==", pulseId).get();
    if (entries.empty) return;
    const writer = db.bulkWriter();
    for (const d of entries.docs) writer.update(d.ref, { pulseName: nameAfter ?? "" });
    await writer.close();
    log(FN, "usage names refreshed after rename", { pulseId, entries: entries.size });
  } catch (err) {
    logError(FN, "usage name refresh failed", err, { pulseId });
    throw err;
  }
});
