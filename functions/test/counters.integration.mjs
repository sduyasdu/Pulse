// RM10 — per-Pulse resource counter (Resource-Master-Spec §8). Runs inside
// `firebase emulators:exec --only firestore,functions`.
//
// The counter is the WRITER for a rule that will refuse writes, so the two ways
// it can be wrong are not symmetric: a stale-low count is a hole in the quota,
// a stale-high one locks a customer out of their own plan. Both are covered, as
// is the teardown case that would otherwise resurrect a deleted Pulse.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { recountResources } from "../lib/counters.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

const P = "p_count";
const addResource = (id) => db.doc(`pulses/${P}/resources/${id}`).set({ id, name: id, capacity: 100 });
const countOf = async () => (await db.doc(`pulses/${P}`).get()).data()?.resourceCount;

await db.doc(`pulses/${P}`).set({ id: P, workspaceId: "ws_count", name: "Counting" });

// ---------------------------------------------------------------------------
// 1. It counts, and it counts from the collection rather than from a delta.
// ---------------------------------------------------------------------------
assert((await recountResources(db, P)) === 0, "count: an empty Pulse is 0, not absent");

await addResource("r1");
await addResource("r2");
assert((await recountResources(db, P)) === 2, "count: reflects the collection");
assert((await countOf()) === 2, "count: is written to the Pulse doc");

// The property that makes recounting the right choice over increment: triggers
// are at-least-once, so the same call twice must not drift.
await recountResources(db, P);
assert((await countOf()) === 2, "count: recounting twice is idempotent");

// And it self-heals from ANY stored value, which an incremented counter cannot.
await db.doc(`pulses/${P}`).set({ resourceCount: 99 }, { merge: true });
assert((await recountResources(db, P)) === 2, "count: repairs a wrong stored value");

await db.doc(`pulses/${P}/resources/r1`).delete();
assert((await recountResources(db, P)) === 1, "count: falls on delete");

// ---------------------------------------------------------------------------
// 2. It must not resurrect a deleted Pulse.
//
// deletePulse removes subcollection docs BEFORE the Pulse doc, so these triggers
// routinely fire mid-teardown. A merge write on a deleted doc creates it, and SF6
// has already run — the ghost would never be cleaned up.
// ---------------------------------------------------------------------------
const G = "p_ghost";
await db.doc(`pulses/${G}/resources/r1`).set({ id: "r1", name: "orphan" });
assert((await recountResources(db, G)) === null, "teardown: a missing Pulse returns null, not 0");
assert(!(await db.doc(`pulses/${G}`).get()).exists, "teardown: a missing Pulse is NOT recreated");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll counter assertions passed");
process.exit(failed ? 1 : 0);
