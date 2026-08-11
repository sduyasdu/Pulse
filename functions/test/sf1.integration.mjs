// SF1 integration test — runs inside `firebase emulators:exec --only
// firestore,functions`. Writes real docs via the Admin SDK (pointed at the
// Firestore emulator), lets the deployed triggers fire, and asserts the denorm
// fields converge. Exits non-zero on any failed assertion.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

const P = "p1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

async function waitFor(ref, pred, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await ref.get();
    if (s.exists && pred(s.data())) return s.data();
    await sleep(200);
  }
  const s = await ref.get();
  throw new Error(`timeout waiting for ${label}; last = ${JSON.stringify(s.data())}`);
}

const r1 = db.doc(`pulses/${P}/resources/r1`);
const r2 = db.doc(`pulses/${P}/resources/r2`);
const f1 = db.doc(`pulses/${P}/features/f1`);

console.log("SF1 integration");

// Seed: r1 linked to u1, r2 unlinked.
await r1.set({ id: "r1", name: "Alice", linkedUid: "u1" });
await r2.set({ id: "r2", name: "Bob", linkedUid: null });

// 1. Feature write → own denorm from referenced resources.
await f1.set({ id: "f1", title: "T", resources: ["r1", "r2"], children: [], lead: null });
let d = await waitFor(f1, (x) => Array.isArray(x.assignedUids) && x.assignedUids.length === 1, "f1 assignedUids");
assert(eq(d.assignedUids, ["u1"]), "assignedUids = [u1] (unlinked r2 excluded)");
assert((d.leadUid ?? null) === null, "leadUid null with no lead");

// 2. Set lead → leadUid.
await f1.update({ lead: "r1" });
d = await waitFor(f1, (x) => (x.leadUid ?? null) === "u1", "f1 leadUid");
assert(d.leadUid === "u1", "leadUid = u1 after lead set");

// 3. linkedUid fan-out: link r2 → u2, f1 picks it up though f1 wasn't written.
await r2.update({ linkedUid: "u2" });
d = await waitFor(f1, (x) => (x.assignedUids || []).includes("u2"), "fan-out add");
assert(eq([...d.assignedUids].sort(), ["u1", "u2"]), "assignedUids = [u1,u2] after r2 linked (fan-out)");

// 4. Unlink the lead resource r1 → removed from assignedUids AND leadUid cleared.
await r1.update({ linkedUid: null });
d = await waitFor(f1, (x) => !(x.assignedUids || []).includes("u1"), "fan-out remove");
assert(eq(d.assignedUids, ["u2"]), "assignedUids = [u2] after r1 unlinked (fan-out)");
assert((d.leadUid ?? null) === null, "leadUid cleared when lead resource unlinked");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll SF1 assertions passed");
process.exit(failed ? 1 : 0);
