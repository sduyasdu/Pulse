import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { log, logError } from "./lib/conventions";

// MCP retention sweep (MCP-Privacy-Disclosure §5).
//
// Two collections grew without bound, and neither was a security hole — both
// hold only hashes, and both are re-checked against a live connection before
// anything is issued. The problem is a **retention claim**: a privacy policy that
// says "authorization codes are kept for five minutes" was not true, because
// nothing ever deleted one.
//
// So this exists to make a statement in the policy true, not to close an
// exploit. That framing decides how aggressive it should be — see the note on
// refresh tokens below for the case it deliberately does NOT clean up.

const FN = "MCP.cleanup";

/** Firestore's hard ceiling on operations in one batched write. */
const BATCH_LIMIT = 500;

/** Documents examined per collection per run. A day's worth of real traffic is
 * far below this; the cap is here so a pathological backlog degrades into
 * several days of sweeping rather than one enormous run. */
const SCAN_LIMIT = 2000;

type Db = FirebaseFirestore.Firestore;

async function deleteAll(db: Db, refs: FirebaseFirestore.DocumentReference[]): Promise<number> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

/**
 * Authorization codes past their expiry.
 *
 * Unambiguous: the code is single-use, `mcpOauthToken` deletes it on exchange,
 * and expiry is enforced on read — so anything still here past `expiresAt` can
 * never be used again by anyone. It is pure garbage holding a uid.
 */
export async function sweepAuthCodes(db: Db, nowMs: number): Promise<number> {
  const snap = await db
    .collection("mcpAuthCodes")
    .where("expiresAt", "<", nowMs)
    .limit(SCAN_LIMIT)
    .get();
  return deleteAll(db, snap.docs.map((d) => d.ref));
}

/**
 * Refresh tokens whose connection is revoked or gone.
 *
 * **Deliberately narrow.** A token whose connection is dead can never be
 * exchanged — `mcpOauthToken` refuses it at `liveConnection` — so deleting it
 * changes nothing for anyone. That is the whole rule.
 *
 * What this does NOT do is delete an old token whose connection is still live,
 * even though such a token may well be abandoned. Rotation means a working
 * client replaces its token roughly hourly, so age looks like a good signal —
 * but it cannot distinguish "abandoned" from "connected and not used for a
 * while", and getting that wrong silently breaks a dormant connection the
 * customer still wants, with a reconnect as the only cure. The retention
 * argument does not justify it either: while the connection is live it is listed
 * in the customer's own UI and already holds their uid, so the token row
 * discloses nothing further.
 *
 * Connections are fetched once per distinct connection rather than once per
 * token, because a connection can legitimately have more than one row (a refresh
 * whose response never reached the client leaves the replacement orphaned).
 */
export async function sweepRefreshTokens(db: Db, scanLimit = SCAN_LIMIT): Promise<number> {
  const snap = await db.collection("mcpRefreshTokens").limit(scanLimit).get();
  if (snap.empty) return 0;

  const connectionPath = (uid: unknown, connectionId: unknown) => `users/${uid}/connections/${connectionId}`;
  const paths = new Set<string>();
  for (const d of snap.docs) {
    const { uid, connectionId } = d.data() as { uid?: string; connectionId?: string };
    if (uid && connectionId) paths.add(connectionPath(uid, connectionId));
  }

  const dead = new Set<string>();
  await Promise.all(
    [...paths].map(async (path) => {
      const c = await db.doc(path).get();
      // Missing OR revoked. Both mean the same thing to the token endpoint, so
      // they mean the same thing here.
      if (!c.exists || c.data()?.revokedAt) dead.add(path);
    }),
  );

  const doomed = snap.docs.filter((d) => {
    const { uid, connectionId } = d.data() as { uid?: string; connectionId?: string };
    // A row with no connection reference at all cannot be validated and cannot
    // be exchanged — it is malformed, and keeping it serves nobody.
    if (!uid || !connectionId) return true;
    return dead.has(connectionPath(uid, connectionId));
  });

  return deleteAll(db, doomed.map((d) => d.ref));
}

/**
 * Daily, off-peak. Cheap and idempotent, so a missed run costs nothing but a
 * day of retention and the next run picks up the backlog.
 *
 * Runs on a schedule rather than on a trigger because the condition is the
 * passage of time, not an event: nothing happens when a code expires, which is
 * exactly why they accumulated.
 */
export const mcpCleanup = onSchedule("every day 03:17", async () => {
  const db = getFirestore();
  try {
    const codes = await sweepAuthCodes(db, Date.now());
    const tokens = await sweepRefreshTokens(db);
    // Logged even at zero: "the sweep ran and found nothing" and "the sweep did
    // not run" are the two states worth telling apart, and only one of them is
    // fine.
    log(FN, "swept", { authCodes: codes, refreshTokens: tokens });
  } catch (err) {
    logError(FN, "sweep failed", err);
    throw err; // let the scheduler record the failure and retry
  }
});
