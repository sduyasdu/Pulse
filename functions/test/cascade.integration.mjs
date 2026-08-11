// SF6–SF9 integration test — runs inside `firebase emulators:exec --only
// firestore,functions`. Exercises the delete-cascade triggers via the Admin SDK
// and asserts the cross-user / cross-doc cleanup converges. Exits non-zero on
// any failed assertion.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

async function waitUntil(pred, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}
const gone = (ref) => async () => !(await ref.get()).exists;

// ── SF8: resource delete strips it from features ────────────────────────────
{
  const P = "p_sf8";
  await db.doc(`pulses/${P}`).set({ id: P, name: "SF8" });
  const r = db.doc(`pulses/${P}/resources/rX`);
  const f = db.doc(`pulses/${P}/features/fX`);
  await r.set({ id: "rX", name: "R", linkedUid: null });
  await f.set({ id: "fX", title: "T", resources: ["rX", "rY"], children: [{ id: "s1", resources: ["rX"] }], lead: "rX" });
  await r.delete();
  await waitUntil(async () => !(await f.get()).data()?.resources?.includes("rX"), "SF8 strip");
  const d = (await f.get()).data();
  assert(eq(d.resources, ["rY"]), "SF8: resource removed from feature.resources");
  assert(eq(d.children[0].resources, []), "SF8: resource removed from subtask.resources");
  assert((d.lead ?? null) === null, "SF8: lead cleared when the lead resource is deleted");
}

// ── SF9: epic delete clears epicId on its features ──────────────────────────
{
  const P = "p_sf9";
  await db.doc(`pulses/${P}`).set({ id: P, name: "SF9" });
  const f = db.doc(`pulses/${P}/features/fY`);
  const epic = db.doc(`pulses/${P}/epics/eX`);
  await epic.set({ id: "eX", name: "E", color: "#000", y0: 0, y1: 100 });
  await f.set({ id: "fY", title: "T", epicId: "eX", resources: [], children: [] });
  await epic.delete(); // onDocumentDeleted only fires for a doc that existed
  await waitUntil(async () => ((await f.get()).data()?.epicId ?? null) === null, "SF9 clear");
  assert(((await f.get()).data()?.epicId ?? null) === null, "SF9: epicId cleared on orphaned feature");
}

// ── SF7: member removed from a LIVE pulse → cross-user cleanup ───────────────
{
  const P = "p_sf7";
  const U = "uX";
  await db.doc(`pulses/${P}`).set({ id: P, name: "SF7" }); // alive → SF7 runs
  await db.doc(`users/${U}/myPulses/${P}`).set({ pulseId: P, name: "SF7", role: "editor", joinedAt: Date.now() });
  await db.doc(`pulses/${P}/presence/${U}`).set({ uid: U, lastSeen: Date.now() });
  await db.doc(`pulses/${P}/notifications/n1`).set({ targetUid: U, type: "comment", createdAt: Date.now() });
  await db.doc(`pulses/${P}/resources/rZ`).set({ id: "rZ", name: "Z", linkedUid: U });
  const member = db.doc(`pulses/${P}/pulseMembers/${U}`);
  await member.set({ uid: U, role: "editor", joinedAt: Date.now() });
  await member.delete();
  await waitUntil(gone(db.doc(`users/${U}/myPulses/${P}`)), "SF7 myPulses");
  assert(!(await db.doc(`users/${U}/myPulses/${P}`).get()).exists, "SF7: removed member's myPulses deleted");
  assert(!(await db.doc(`pulses/${P}/presence/${U}`).get()).exists, "SF7: presence deleted");
  assert(!(await db.doc(`pulses/${P}/notifications/n1`).get()).exists, "SF7: their notification deleted");
  assert(((await db.doc(`pulses/${P}/resources/rZ`).get()).data()?.linkedUid ?? null) === null, "SF7: resource unlinked");
}

// ── SF6: pulse delete purges subcollections + all members' myPulses ─────────
{
  const P = "p_sf6";
  await db.doc(`pulses/${P}`).set({ id: P, name: "SF6" });
  const feat = db.doc(`pulses/${P}/features/f6`);
  const comment = db.doc(`pulses/${P}/comments/c6`);
  await feat.set({ id: "f6", title: "T", resources: [], children: [] });
  await comment.set({ id: "c6", text: "hi", createdAt: Date.now() });
  await db.doc(`users/m1/myPulses/${P}`).set({ pulseId: P, name: "SF6", role: "owner", joinedAt: Date.now() });
  await db.doc(`users/m2/myPulses/${P}`).set({ pulseId: P, name: "SF6", role: "editor", joinedAt: Date.now() });
  await db.doc(`pulses/${P}`).delete(); // triggers SF6
  await waitUntil(gone(feat), "SF6 subcollection purge");
  assert(!(await feat.get()).exists, "SF6: feature subcollection purged");
  assert(!(await comment.get()).exists, "SF6: comment subcollection purged");
  assert(!(await db.doc(`users/m1/myPulses/${P}`).get()).exists, "SF6: member m1 myPulses purged (cross-user)");
  assert(!(await db.doc(`users/m2/myPulses/${P}`).get()).exists, "SF6: member m2 myPulses purged (cross-user)");
}

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll SF6–SF9 assertions passed");
process.exit(failed ? 1 : 0);
