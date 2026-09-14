// SF15 integration test — runs inside `firebase emulators:exec --only
// firestore,functions`. Exercises the audit that decides what account deletion
// destroys. Exits non-zero on any failed assertion.
//
// The audit rather than `deleteAccount` itself: the callable ends in
// `getAuth().deleteUser`, and the harness runs no Auth emulator. The audit is
// the half that makes the irreversible decisions, so it is the half worth
// pinning — which Beats die, which are merely left, and what refuses outright.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { auditAccountForTest } from "../lib/account.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

const ME = "u_me";
const OTHER = "u_other";

/** A Beat with the given members, plus the caller's index row for it. */
async function beat(id, name, members) {
  await db.doc(`pulses/${id}`).set({ id, name });
  for (const [uid, role] of Object.entries(members)) {
    await db.doc(`pulses/${id}/pulseMembers/${uid}`).set({ uid, role });
  }
  if (members[ME]) await db.doc(`users/${ME}/myPulses/${id}`).set({ pulseId: id, name });
}

await db.doc(`users/${ME}`).set({ uid: ME, email: "me@example.com", personalWorkspaceId: "ws_me" });

// Sole owner, nobody else in it → deleted outright, harming no one.
await beat("b_solo", "Solo", { [ME]: "owner" });
// Sole owner, other people in it → refuses. Deleting would take their work.
await beat("b_shared", "Shared", { [ME]: "owner", [OTHER]: "editor" });
// Someone else owns it → the caller merely leaves.
await beat("b_theirs", "Theirs", { [OTHER]: "owner", [ME]: "editor" });
// Two owners → not sole, so it survives and the caller leaves.
await beat("b_coowned", "Co-owned", { [ME]: "owner", [OTHER]: "owner" });

{
  const a = await auditAccountForTest(db, ME);
  const ids = (rows) => rows.map((r) => r.beatId).sort();
  assert(ids(a.beatsToDelete).join() === "b_solo", "sole-owned and empty → deleted");
  assert(ids(a.blockers).join() === "b_shared", "sole-owned with others → blocks deletion");
  assert(a.blockers[0]?.otherMembers === 1, "blocker counts the other members");
  assert(ids(a.beatsToLeave).join() === "b_coowned,b_theirs", "co-owned and others' Beats → left, not deleted");
  assert(a.subscription === null, "no subscription, no billing block");
}

// A live subscription refuses: it would keep charging an account that is gone.
{
  await db.doc("billing/ws_me").set({ tier: "pro", status: "active", stripeSubscriptionId: "sub_123" });
  const a = await auditAccountForTest(db, ME);
  assert(a.subscription?.orgId === "ws_me", "live subscription blocks deletion");
  // A cancelled one does not — there is nothing left to stop.
  await db.doc("billing/ws_me").set({ tier: "free", status: "canceled", stripeSubscriptionId: "sub_123" });
  const b = await auditAccountForTest(db, ME);
  assert(b.subscription === null, "cancelled subscription does not block");
}

// A stale index row for a Beat that no longer exists must not be mistaken for
// one to tear down — it would read as a Beat with no members, i.e. deletable.
{
  await db.doc(`users/${ME}/myPulses/b_ghost`).set({ pulseId: "b_ghost", name: "Ghost" });
  const a = await auditAccountForTest(db, ME);
  const all = [...a.beatsToDelete, ...a.beatsToLeave, ...a.blockers].map((r) => r.beatId);
  assert(!all.includes("b_ghost"), "stale index row for a deleted Beat is ignored");
}

// Everything the teardown will delete must be resolved by the audit, not
// discovered mid-teardown.
//
// This is the regression. The `workspaceMembers` collection-group query needs an
// index, and it used to be issued in the middle of the teardown — so in
// production it threw *after* Beats had already been deleted, leaving a
// half-deleted account behind an error that claimed nothing had been removed.
// The emulator does not enforce indexes, so the failure itself cannot be
// reproduced here; what is pinned instead is the property that made it
// survivable: every read happens before the first destructive write.
{
  await db.doc("workspaces/ws_me/workspaceMembers/u_me").set({ uid: ME, role: "owner" });
  await db.doc("workspaces/ws_other/workspaceMembers/u_me").set({ uid: ME, role: "editor" });
  await db.doc("inviteIndex/me@example.com/pending/b_invited").set({ pulseId: "b_invited" });
  await db.doc("mcpAuthCodes/hash1").set({ uid: ME });
  await db.doc("mcpRefreshTokens/hash2").set({ uid: ME });
  await db.doc("workspaces/ws_me").set({ id: "ws_me", ownerId: ME, isPersonal: true });

  const a = await auditAccountForTest(db, ME);
  const paths = a.refs.map((r) => r.path).sort();
  assert(paths.includes("workspaces/ws_me/workspaceMembers/u_me"), "audit resolves the owned org membership");
  assert(paths.includes("workspaces/ws_other/workspaceMembers/u_me"), "audit resolves a membership in someone else's org");
  assert(paths.includes("inviteIndex/me@example.com/pending/b_invited"), "audit resolves pending invitations by email");
  assert(paths.includes("mcpAuthCodes/hash1"), "audit resolves connector auth codes");
  assert(paths.includes("mcpRefreshTokens/hash2"), "audit resolves connector refresh tokens");
  assert(a.ownedOrgId === "ws_me", "audit identifies the personal org this user owns");
}

// The personal org is torn down only when this user actually owns it. An org
// someone else owns must survive, however the user's profile points at it —
// deleting it would take a stranger's roster and billing with it.
//
// (An earlier version of this case asserted `ownedOrgId !== "ws_other"`, which
// no mutation could ever falsify: `ownedOrgId` is only ever derived from the
// user's own `personalWorkspaceId`, so it could not have been "ws_other" under
// any implementation. It passed, and proved nothing.)
{
  await db.doc("workspaces/ws_me").set({ id: "ws_me", ownerId: OTHER, isPersonal: false });
  const a = await auditAccountForTest(db, ME);
  assert(a.ownedOrgId === null, "an org owned by someone else is never marked for deletion");
  await db.doc("workspaces/ws_me").set({ id: "ws_me", ownerId: ME, isPersonal: true });
  const b = await auditAccountForTest(db, ME);
  assert(b.ownedOrgId === "ws_me", "the user's own personal org still is");
}

if (failed) {
  console.error(`\n${failed} assertion(s) FAILED`);
  process.exit(1);
}
console.log("All SF15 assertions passed");
