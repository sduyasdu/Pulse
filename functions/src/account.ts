/**
 * SF15 — account deletion.
 *
 * Two callables: `previewAccountDeletion` says what deleting would do, and
 * `deleteAccount` does it. They share one audit function, so the preview cannot
 * drift from the act — a confirmation screen that describes different
 * consequences from the ones that follow is worse than no confirmation at all.
 *
 * **Why a callable and not an Auth trigger.** The spec names the "Auth
 * user-deletion lifecycle" as the trigger, and in 1st-gen functions that is
 * `functions.auth.user().onDelete()`. This codebase is entirely 2nd-gen, which
 * has no after-delete event — only the *blocking* before-create/before-sign-in
 * ones. Worse, a trigger runs after the account is gone, so a failed teardown
 * leaves an orphaned footprint with no signed-in user left to retry it. The
 * callable inverts that: clean up first, delete the identity last, and give the
 * client a completion signal (Backend-Architecture-Spec §D, item 6).
 *
 * Teardown is driven by deleting documents that already have cascades, rather
 * than by re-implementing them: removing `pulses/{id}` fires SF6
 * (`onPulseDelete`) and removing `pulses/{id}/pulseMembers/{uid}` fires SF7
 * (`onMemberRemoved`). Anything else would be a second copy of that logic,
 * free to drift.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { log, logError } from "./lib/conventions";
import { emailKey } from "./roster";

const FN = "SF15.account";

/** How recently the caller must have signed in, in seconds.
 *
 * Deleting an account is irreversible, so it is gated the way a password change
 * is: on a fresh session, not merely a valid one. A stolen but idle token
 * cannot spend it. The client catches this and sends the user back through
 * sign-in. */
const REAUTH_WINDOW_S = 5 * 60;

/** A Beat the caller solely owns and cannot silently take with them. */
interface Blocker {
  beatId: string;
  name: string;
  otherMembers: number;
}

interface Audit {
  /** Beats deleted outright — the caller is the only owner AND the only member. */
  beatsToDelete: { beatId: string; name: string }[];
  /** Beats the caller merely leaves; the Beat and its other members survive. */
  beatsToLeave: { beatId: string; name: string }[];
  /** Sole-owned Beats that still have other members. Deletion stops on these. */
  blockers: Blocker[];
  /** A live paid subscription. Deletion stops on this too. */
  subscription: { orgId: string; status: string } | null;
}

/**
 * What deleting this account would do. Read-only.
 *
 * Runs before anything is destroyed so the decision is made on the whole
 * picture: a partial teardown that then hits a blocker would leave the account
 * half-gone and the user unable to finish or undo.
 */
async function audit(db: FirebaseFirestore.Firestore, uid: string): Promise<Audit> {
  const out: Audit = { beatsToDelete: [], beatsToLeave: [], blockers: [], subscription: null };

  // `myPulses` is the user's own index of every Beat they belong to, and the
  // only listable view of it — membership lives inside each Beat, which cannot
  // be queried across Beats without a collection-group index on a path the
  // rules deliberately scope per Beat.
  const mine = await db.collection(`users/${uid}/myPulses`).get();

  for (const row of mine.docs) {
    const beatId = String(row.data().pulseId ?? row.id);
    const name = String(row.data().name ?? "Untitled Beat");

    const beat = await db.doc(`pulses/${beatId}`).get();
    if (!beat.exists) continue; // already gone; the stale index row dies with the user subtree

    const members = await db.collection(`pulses/${beatId}/pulseMembers`).get();
    const owners = members.docs.filter((m) => m.data().role === "owner").map((m) => m.id);
    const soleOwner = owners.length === 1 && owners[0] === uid;

    if (!soleOwner) {
      out.beatsToLeave.push({ beatId, name });
      continue;
    }
    const others = members.docs.filter((m) => m.id !== uid).length;
    if (others === 0) out.beatsToDelete.push({ beatId, name });
    else out.blockers.push({ beatId, name, otherMembers: others });
  }

  // A live subscription outlives the account unless someone cancels it, and
  // cancelling on the customer's behalf is a billing decision this function has
  // no business taking — a refund may be owed, or the seat may belong to an org
  // that still wants it. Stop, and say so.
  const user = await db.doc(`users/${uid}`).get();
  const orgId = user.exists ? String(user.data()?.personalWorkspaceId ?? "") : "";
  if (orgId) {
    const billing = await db.doc(`billing/${orgId}`).get();
    const status = billing.exists ? String(billing.data()?.status ?? "") : "";
    const live = billing.exists && Boolean(billing.data()?.stripeSubscriptionId) && status !== "canceled";
    if (live) out.subscription = { orgId, status };
  }
  return out;
}

export const previewAccountDeletion = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const db = getFirestore();
  try {
    const a = await audit(db, uid);
    return {
      deletes: a.beatsToDelete,
      leaves: a.beatsToLeave,
      blockers: a.blockers,
      subscription: a.subscription,
      canDelete: a.blockers.length === 0 && a.subscription === null,
    };
  } catch (err) {
    logError(FN, "preview failed", err, { uid });
    throw new HttpsError("internal", "Couldn't work out what deleting your account would do.");
  }
});

export const deleteAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  // `auth_time` is when this ID token's session was established, in seconds.
  const authTime = Number(request.auth?.token?.auth_time ?? 0);
  if (!authTime || Date.now() / 1000 - authTime > REAUTH_WINDOW_S) {
    throw new HttpsError("failed-precondition", "reauth-required");
  }

  const db = getFirestore();
  const a = await audit(db, uid);

  if (a.blockers.length > 0) {
    throw new HttpsError(
      "failed-precondition",
      "sole-owner-beats",
      // The client renders these; a bare "cannot delete" would leave the user
      // with no idea which Beats to hand over.
      { beats: a.blockers },
    );
  }
  if (a.subscription) {
    throw new HttpsError("failed-precondition", "active-subscription", a.subscription);
  }

  try {
    // 1. Beats the caller solely owns and nobody else is in. Deleting the Beat
    //    document fires SF6, which purges the subtree and every member's index.
    for (const b of a.beatsToDelete) await db.doc(`pulses/${b.beatId}`).delete();

    // 2. Beats they merely belong to. Deleting the membership fires SF7, which
    //    clears their index row, presence, notifications and resource link.
    for (const b of a.beatsToLeave) await db.doc(`pulses/${b.beatId}/pulseMembers/${uid}`).delete();

    const writer = db.bulkWriter();

    // 3. Organisation memberships, wherever they are.
    const wsMembers = await db.collectionGroup("workspaceMembers").where("uid", "==", uid).get();
    for (const d of wsMembers.docs) writer.delete(d.ref);

    // 4. Invitations addressed to this person but never accepted. Keyed by
    //    email, so they survive the uid unless removed here.
    const email = emailKey(String(request.auth?.token?.email ?? ""));
    let invites = 0;
    if (email) {
      const pending = await db.collection(`inviteIndex/${email}/pending`).get();
      for (const d of pending.docs) writer.delete(d.ref);
      invites = pending.size;
    }

    // 5. Connector credentials. Hashes, so nothing here is replayable, but they
    //    are keyed to the uid and the policy says they go when the account does.
    const codes = await db.collection("mcpAuthCodes").where("uid", "==", uid).get();
    for (const d of codes.docs) writer.delete(d.ref);
    const refresh = await db.collection("mcpRefreshTokens").where("uid", "==", uid).get();
    for (const d of refresh.docs) writer.delete(d.ref);

    await writer.close();

    // 6. The personal workspace and its billing record, if this user owns it.
    //    A shared org they merely belonged to is left alone — step 3 removed
    //    their membership and the org belongs to someone else.
    const user = await db.doc(`users/${uid}`).get();
    const orgId = user.exists ? String(user.data()?.personalWorkspaceId ?? "") : "";
    if (orgId) {
      const ws = await db.doc(`workspaces/${orgId}`).get();
      if (ws.exists && ws.data()?.ownerId === uid) {
        await db.recursiveDelete(db.doc(`workspaces/${orgId}`));
        await db.doc(`billing/${orgId}`).delete();
      }
    }

    // 7. The user subtree: the Beat index, connector records, the profile.
    await db.recursiveDelete(db.doc(`users/${uid}`));

    log(FN, "tore down account footprint", {
      uid,
      beatsDeleted: a.beatsToDelete.length,
      beatsLeft: a.beatsToLeave.length,
      workspaceMemberships: wsMembers.size,
      invites,
      mcpCodes: codes.size,
      mcpRefreshTokens: refresh.size,
    });

    // 8. The identity, last. Everything above is idempotent, so if this throws
    //    the user can sign in and retry; the reverse order would strand the
    //    data with nobody able to reach it.
    await getAuth().deleteUser(uid);
    log(FN, "deleted auth user", { uid });
    return { deleted: true, beatsDeleted: a.beatsToDelete.length, beatsLeft: a.beatsToLeave.length };
  } catch (err) {
    logError(FN, "account deletion failed", err, { uid });
    throw new HttpsError("internal", "Couldn't finish deleting your account. Nothing further was removed.");
  }
});

/** The audit, exposed for the integration test. It is the half that decides
 * what gets destroyed, and the half a unit test can reach without an Auth
 * emulator — `deleteAccount` itself ends in `getAuth().deleteUser`, which the
 * test harness (`--only firestore,functions`) has no emulator for. */
export const auditAccountForTest = audit;
