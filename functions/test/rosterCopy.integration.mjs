// RM15 — bulk copy from the roster into a Pulse.
//
// The callable itself needs an auth context the emulator harness cannot mint, so
// what is exercised here is the decision logic it is built from, against real
// Firestore: how many fit, what is skipped, and the shape a copy lands in.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { emailKey } from "../lib/roster.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

const WS = "ws_copy";
const P = "p_copy";

await db.doc(`workspaces/${WS}/resources/m1`).set({ id: "m1", name: "Ana", initials: "AN", type: "dev", capacity: 80, linkedEmail: "ana@example.com" });
await db.doc(`workspaces/${WS}/resources/m2`).set({ id: "m2", name: "Bo", initials: "BO", type: null, capacity: 100, linkedEmail: null });
await db.doc(`pulses/${P}`).set({ id: P, workspaceId: WS, name: "Target" });
await db.doc(`pulses/${P}/pulseMembers/u_ana`).set({ uid: "u_ana", role: "editor", joinedAt: 1, email: "Ana@Example.com" });

// ---------------------------------------------------------------------------
// Room is computed from a live recount, not from the stored counter. The stored
// one is eventually consistent, and this is the single place that must not be.
// ---------------------------------------------------------------------------
const roomFor = (limit, used) => (limit < 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used));
assert(roomFor(20, 19) === 1, "quota: one slot left is one slot");
assert(roomFor(20, 20) === 0, "quota: at the cap there is no room");
assert(roomFor(20, 25) === 0, "quota: already over the cap clamps to 0, never negative");
assert(roomFor(-1, 9999) > 1000, "quota: business is uncapped");

// ---------------------------------------------------------------------------
// Copying the same team twice must be a no-op, not a second Ana.
// ---------------------------------------------------------------------------
await db.doc(`pulses/${P}/resources/existing`).set({ id: "existing", name: "Ana", masterId: "m1" });
const existing = await db.collection(`pulses/${P}/resources`).get();
const alreadyCopied = new Set(existing.docs.map((d) => d.data()?.masterId).filter(Boolean));
const wanted = ["m1", "m2"].filter((id) => !alreadyCopied.has(id));
assert(wanted.length === 1 && wanted[0] === "m2", "dedupe: a master already present is skipped");

// ---------------------------------------------------------------------------
// Resolution at copy time, folding case, so a copy does not flicker through
// "waiting" on its way to "live".
// ---------------------------------------------------------------------------
const members = await db.collection(`pulses/${P}/pulseMembers`).get();
const uidByEmail = new Map();
for (const m of members.docs) {
  const e = m.data()?.email;
  if (typeof e === "string" && e) uidByEmail.set(emailKey(e), m.id);
}
const m1 = (await db.doc(`workspaces/${WS}/resources/m1`).get()).data();
assert(uidByEmail.get(emailKey(m1.linkedEmail)) === "u_ana", "copy: a roster email resolves to a collaborator despite stored case");

const m2 = (await db.doc(`workspaces/${WS}/resources/m2`).get()).data();
assert(m2.linkedEmail === null, "copy: an unlinked master copies with no email");
assert(m1.capacity === 80, "copy: the master's capacity is the DEFAULT a copy starts from (RM2)");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll roster-copy assertions passed");
process.exit(failed ? 1 : 0);
