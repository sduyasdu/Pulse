// SF3 integration test — runs inside `firebase emulators:exec --only
// firestore,functions`. Two halves:
//
//   1. The **pure mappers** (status/tier/event → our shape). No Stripe, no
//      network — they are exported precisely so they can be checked directly.
//   2. The **PL4 downgrade** (Plans-Spec §5.1) against the real emulator: seed a
//      workspace with several editors across several Pulses, run the downgrade,
//      assert exactly the right members were demoted and nothing else moved.
//
// The webhook handler itself is NOT covered here — verifying a real signature
// needs the Stripe CLI (`stripe listen`), which isn't available in this harness.
// Exits non-zero on any failed assertion.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { mapStatus, readTier, licensedItem, subscriptionIdFor, applyProDowngrade } from "../lib/billing.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

// ---------------------------------------------------------------------------
// 1. Pure mappers
// ---------------------------------------------------------------------------

assert(mapStatus("active") === "active", "mapStatus: active");
assert(mapStatus("trialing") === "trialing", "mapStatus: trialing");
assert(mapStatus("past_due") === "past_due", "mapStatus: past_due (grace, not a downgrade)");
assert(mapStatus("incomplete") === "incomplete", "mapStatus: incomplete");
assert(mapStatus("canceled") === "canceled", "mapStatus: canceled");
assert(mapStatus("unpaid") === "canceled", "mapStatus: unpaid → canceled");
assert(mapStatus("incomplete_expired") === "canceled", "mapStatus: incomplete_expired → canceled");
assert(mapStatus("paused") === "canceled", "mapStatus: paused → canceled");
assert(mapStatus("some_future_status") === "canceled", "mapStatus: unknown status fails closed to canceled");

assert(readTier({ tier: "teams" }) === "teams", "readTier: teams");
assert(readTier({ tier: "Business" }) === "business", "readTier: case-insensitive");
assert(readTier({ tier: " teams " }) === "teams", "readTier: trims");
assert(readTier({ tier: "pro" }) === null, "readTier: pro is never a Stripe product");
assert(readTier({}) === null && readTier(null) === null, "readTier: absent → null");

const subWith = (items) => ({ items: { data: items } });
const item = (tier, { onPrice = false, quantity = 1, periodEnd = 1_800_000_000 } = {}) => ({
  quantity,
  current_period_end: periodEnd,
  price: {
    metadata: onPrice ? { tier } : {},
    product: onPrice ? "prod_x" : { id: "prod_x", metadata: { tier } },
  },
});

assert(licensedItem(subWith([item("teams")]))?.tier === "teams", "licensedItem: tier from expanded product");
assert(licensedItem(subWith([item("business", { onPrice: true })]))?.tier === "business", "licensedItem: falls back to price metadata");
assert(licensedItem(subWith([item("teams", { quantity: 7 })]))?.item.quantity === 7, "licensedItem: quantity = purchased seats");
assert(licensedItem(subWith([])) === null, "licensedItem: no items → null");
assert(licensedItem(subWith([item(undefined)])) === null, "licensedItem: no tier metadata → null (falls back to Pro)");
// A metered/add-on item first, the licensed one second — must skip past it.
assert(licensedItem(subWith([item(undefined), item("teams")]))?.tier === "teams", "licensedItem: skips untagged items");
assert(
  licensedItem(subWith([item("teams")]))?.item.current_period_end === 1_800_000_000,
  "licensedItem: period end read off the item (2025 API move)",
);

const ev = (type, object) => ({ type, data: { object } });
assert(subscriptionIdFor(ev("customer.subscription.updated", { id: "sub_1" })) === "sub_1", "subscriptionIdFor: subscription.updated");
assert(subscriptionIdFor(ev("customer.subscription.deleted", { id: "sub_2" })) === "sub_2", "subscriptionIdFor: subscription.deleted");
assert(subscriptionIdFor(ev("checkout.session.completed", { subscription: "sub_3" })) === "sub_3", "subscriptionIdFor: checkout session");
assert(
  subscriptionIdFor(ev("invoice.paid", { parent: { subscription_details: { subscription: "sub_4" } } })) === "sub_4",
  "subscriptionIdFor: invoice via parent.subscription_details (2025 API move)",
);
assert(subscriptionIdFor(ev("invoice.paid", { parent: null })) === null, "subscriptionIdFor: one-off invoice → null");
assert(subscriptionIdFor(ev("customer.created", { id: "cus_1" })) === null, "subscriptionIdFor: unrelated event ignored");

// ---------------------------------------------------------------------------
// 2. PL4 downgrade against the emulator
// ---------------------------------------------------------------------------

const WS = "ws_pl4";
const OTHER = "ws_other";
const OWNER = "u_owner";

async function seed() {
  const b = db.batch();
  b.set(db.doc(`workspaces/${WS}`), { ownerId: OWNER, name: "Org", editorUids: [OWNER, "u_e1", "u_e2"] });
  b.set(db.doc(`workspaces/${OTHER}`), { ownerId: "u_other", name: "Other org", editorUids: ["u_other", "u_e9"] });

  // Pulse A (this org): the org owner + a second editor + a viewer.
  b.set(db.doc(`pulses/p_a`), { workspaceId: WS, name: "A" });
  b.set(db.doc(`pulses/p_a/pulseMembers/${OWNER}`), { uid: OWNER, role: "owner" });
  b.set(db.doc(`pulses/p_a/pulseMembers/u_e1`), { uid: "u_e1", role: "editor" });
  b.set(db.doc(`pulses/p_a/pulseMembers/u_v1`), { uid: "u_v1", role: "fullViewer" });

  // Pulse B (this org): owned by a co-owner who is NOT the org owner, plus a
  // task lead. The co-owner gets demoted and the org owner isn't a member —
  // the ownerless case the function logs about.
  b.set(db.doc(`pulses/p_b`), { workspaceId: WS, name: "B" });
  b.set(db.doc(`pulses/p_b/pulseMembers/u_e2`), { uid: "u_e2", role: "owner" });
  b.set(db.doc(`pulses/p_b/pulseMembers/u_tl`), { uid: "u_tl", role: "taskLead" });

  // Pulse C belongs to a DIFFERENT org — must be untouched.
  b.set(db.doc(`pulses/p_c`), { workspaceId: OTHER, name: "C" });
  b.set(db.doc(`pulses/p_c/pulseMembers/u_e9`), { uid: "u_e9", role: "editor" });
  await b.commit();
}

const roleOf = async (path) => (await db.doc(path).get()).get("role");

await seed();
const result = await applyProDowngrade(db, WS);

assert(eq(result, { pulses: 2, demoted: 2 }), "downgrade visited this org's 2 Pulses and demoted 2 members");
assert((await roleOf(`pulses/p_a/pulseMembers/${OWNER}`)) === "owner", "org owner keeps owner on p_a");
assert((await roleOf(`pulses/p_a/pulseMembers/u_e1`)) === "fullViewer", "editor u_e1 demoted to fullViewer");
assert((await roleOf(`pulses/p_b/pulseMembers/u_e2`)) === "fullViewer", "non-org-owner Pulse owner u_e2 demoted to fullViewer");
assert((await roleOf(`pulses/p_a/pulseMembers/u_v1`)) === "fullViewer", "existing fullViewer untouched");
assert((await roleOf(`pulses/p_b/pulseMembers/u_tl`)) === "taskLead", "collaborator (taskLead) unaffected — §5.1");
assert((await roleOf(`pulses/p_c/pulseMembers/u_e9`)) === "editor", "editor in a DIFFERENT org untouched");

const demotedCaps = (await db.doc(`pulses/p_a/pulseMembers/u_e1`).get()).get("caps");
assert(demotedCaps?.editScope === "none", "demoted member's caps re-materialized: editScope none");
assert(demotedCaps?.readScope === "all" && demotedCaps?.comment === true, "demoted member keeps read + comment (never destructive)");

assert(eq((await db.doc(`workspaces/${WS}`).get()).get("editorUids"), [OWNER]), "editor roster collapsed to [ownerId] (1 Pro seat)");
assert(
  eq((await db.doc(`workspaces/${OTHER}`).get()).get("editorUids"), ["u_other", "u_e9"]),
  "other org's editor roster untouched",
);

// Nothing was deleted — PL4 is a demotion, never a removal.
assert((await db.collection(`pulses/p_a/pulseMembers`).get()).size === 3, "p_a still has all 3 members");
assert((await db.collection(`pulses/p_b/pulseMembers`).get()).size === 2, "p_b still has both members");

// Idempotent: a duplicate cancel delivery finds nothing left to demote.
const again = await applyProDowngrade(db, WS);
assert(eq(again, { pulses: 2, demoted: 0 }), "re-running the downgrade demotes nobody (idempotent)");

// A workspace with no ownerId must not throw — it logs and no-ops.
await db.doc(`workspaces/ws_broken`).set({ name: "no owner" });
const broken = await applyProDowngrade(db, "ws_broken");
assert(eq(broken, { pulses: 0, demoted: 0 }), "missing ownerId → no-op, no throw");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll SF3 assertions passed");
process.exit(failed ? 1 : 0);
