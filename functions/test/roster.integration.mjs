// RM16/RM17 — resolving a roster link from email to uid. Runs inside
// `firebase emulators:exec --only firestore,functions`.
//
// The resolver writes to the same document it watches, so the assertion that
// matters most is not "does it resolve" but "does it stop" — a re-entrant
// trigger would be invisible in a unit test and expensive in production.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

// The triggers themselves need a deployed function runtime; what is exercised
// here is the logic they are built from, against real Firestore semantics.
const { uidForEmailForTest, applyResolutionForTest } = await import("../lib/roster.js");

const WS = "ws_roster";
await db.doc(`workspaces/${WS}`).set({ id: WS, name: "Acme" });
await db.doc(`workspaces/${WS}/workspaceMembers/bob`).set({ uid: "bob", role: "member", joinedAt: 1, email: "bob@example.com" });

// ---------------------------------------------------------------------------
// Resolution matches on the denormalized member email, in emailKey() form.
// ---------------------------------------------------------------------------
assert((await uidForEmailForTest(db, WS, "bob@example.com")) === "bob", "resolve: a member's email finds their uid");
assert((await uidForEmailForTest(db, WS, "nobody@example.com")) === null, "resolve: a stranger resolves to null, not undefined");

// Both sides are stored lowercased, so this is a plain equality — the test
// exists to pin that the STORAGE is normalised, since the query cannot fold case.
await db.doc(`workspaces/${WS}/workspaceMembers/cara`).set({ uid: "cara", role: "member", joinedAt: 1, email: "Cara@Example.com" });
assert((await uidForEmailForTest(db, WS, "cara@example.com")) === null,
  "resolve: an unnormalised stored email does NOT match — emailKey() must be applied on write");

// ---------------------------------------------------------------------------
// Termination. applyResolution is what stops the write-triggers-itself loop.
// ---------------------------------------------------------------------------
const ref = db.doc(`workspaces/${WS}/resources/m1`);
await ref.set({ id: "m1", name: "Ana", linkedEmail: "bob@example.com", linkedUid: null });

assert((await applyResolutionForTest(ref, null, "bob")) === true, "loop: a real change writes");
assert((await ref.get()).data()?.linkedUid === "bob", "loop: the resolution lands");
assert((await applyResolutionForTest(ref, "bob", "bob")) === false, "loop: an unchanged value does NOT write — this is what terminates the trigger");

// Clearing on leave keeps the intent (RM17).
assert((await applyResolutionForTest(ref, "bob", null)) === true, "leave: clearing the uid writes");
const after = (await ref.get()).data();
assert(after?.linkedUid === null, "leave: the resolution is cleared");
assert(after?.linkedEmail === "bob@example.com", "leave: the INTENT survives, so a re-join re-resolves");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll roster assertions passed");
process.exit(failed ? 1 : 0);
