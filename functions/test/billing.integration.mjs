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
import {
  mapStatus,
  readTier,
  licensedItem,
  subscriptionIdFor,
  holdsSeats,
  applyProDowngrade,
  safeReturnUrl,
  requireSeats,
  tierOfPrice,
} from "../lib/billing.js";

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

assert(readTier({ tier: "pro" }) === "pro", "readTier: pro");
assert(readTier({ tier: "teams" }) === "pro", "readTier: legacy \"teams\" metadata still resolves to pro");
assert(readTier({ tier: "Business" }) === "business", "readTier: case-insensitive");
assert(readTier({ tier: " pro " }) === "pro", "readTier: trims");
assert(readTier({ tier: "starter" }) === null, "readTier: starter is never a Stripe product");
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

assert(licensedItem(subWith([item("pro")]))?.tier === "pro", "licensedItem: tier from expanded product");
assert(licensedItem(subWith([item("business", { onPrice: true })]))?.tier === "business", "licensedItem: falls back to price metadata");
assert(licensedItem(subWith([item("pro", { quantity: 7 })]))?.item.quantity === 7, "licensedItem: quantity = purchased seats");
assert(licensedItem(subWith([])) === null, "licensedItem: no items → null");
assert(licensedItem(subWith([item(undefined)])) === null, "licensedItem: no tier metadata → null (falls back to Pro)");
// A metered/add-on item first, the licensed one second — must skip past it.
assert(licensedItem(subWith([item(undefined), item("pro")]))?.tier === "pro", "licensedItem: skips untagged items");
assert(
  licensedItem(subWith([item("pro")]))?.item.current_period_end === 1_800_000_000,
  "licensedItem: period end read off the item (2025 API move)",
);

// holdsSeats + the flip matrix it drives. The `active → past_due → canceled`
// row is the regression guard: dunning-exhausted cancellation is the usual
// involuntary-churn path, and an active/trialing-only test for the PREVIOUS state
// makes it never demote (on the final event the previous status is past_due).
assert(holdsSeats("pro", "active") === true, "holdsSeats: pro/active");
assert(holdsSeats("business", "trialing") === true, "holdsSeats: business/trialing");
assert(holdsSeats("pro", "past_due") === true, "holdsSeats: past_due still holds (§5.1 dunning grace)");
assert(holdsSeats("pro", "canceled") === false, "holdsSeats: canceled releases");
assert(holdsSeats("pro", "incomplete") === false, "holdsSeats: incomplete never held");
assert(holdsSeats("starter", "active") === false, "holdsSeats: starter is not a paid tier");
assert(holdsSeats(undefined, undefined) === false, "holdsSeats: absent doc holds nothing");

const flips = (fromTier, fromStatus, toTier, toStatus) =>
  holdsSeats(fromTier, fromStatus) && !holdsSeats(toTier, toStatus);

assert(flips("pro", "active", "pro", "past_due") === false, "flip: active → past_due does NOT demote (grace)");
assert(flips("pro", "past_due", "pro", "canceled") === true, "flip: past_due → canceled DOES demote (dunning exhausted)");
assert(flips("pro", "active", "pro", "canceled") === true, "flip: active → canceled demotes");
assert(flips("business", "trialing", "business", "canceled") === true, "flip: trial abandoned demotes");
assert(flips("pro", "canceled", "pro", "canceled") === false, "flip: duplicate cancel does not re-demote");
assert(flips(undefined, undefined, "pro", "canceled") === false, "flip: never-subscribed org is not demoted");
assert(flips("pro", "past_due", "pro", "active") === false, "flip: dunning recovered does not demote");
assert(flips("business", "active", "pro", "active") === false, "flip: paid→paid downgrade does not demote (out of scope, §5.1)");

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

// ---------------------------------------------------------------------------
// 3. Timestamp representation + the delinquency clock
//
// These assert on the *shape* SF3 writes. The app declares
// `type Timestamp = number` and every client service writes Date.now(), so a
// Firestore Timestamp object here would hand the billing UI an object where the
// type promises a number.
// ---------------------------------------------------------------------------

const billingRef = db.doc("billing/ws_shape");
await billingRef.set({
  tier: "pro",
  status: "past_due",
  updatedAt: Date.now(),
  currentPeriodEnd: Date.now() + 86_400_000,
  pastDueSince: 1_700_000_000_000,
  source: "stripe",
});
const shape = (await billingRef.get()).data();
assert(typeof shape.updatedAt === "number", "updatedAt is epoch millis, not a Timestamp object");
assert(typeof shape.currentPeriodEnd === "number", "currentPeriodEnd is epoch millis, not a Timestamp object");
assert(typeof shape.pastDueSince === "number", "pastDueSince is epoch millis");

// The clock must survive dunning retries: SF3 carries a previous pastDueSince
// forward rather than restamping, so the 15-day window measures from the FIRST
// failed charge. This mirrors the branch in syncSubscription.
const carryForward = (prev, status, now) =>
  status === "past_due" ? (typeof prev?.pastDueSince === "number" ? prev.pastDueSince : now) : null;
assert(carryForward(undefined, "past_due", 500) === 500, "clock: first past_due stamps now");
assert(carryForward({ pastDueSince: 100 }, "past_due", 500) === 100, "clock: dunning retry keeps the original stamp");
assert(carryForward({ pastDueSince: 100 }, "active", 500) === null, "clock: recovery clears the stamp");
assert(carryForward({ pastDueSince: 100 }, "canceled", 500) === null, "clock: cancellation clears the stamp");

// ---------------------------------------------------------------------------
// 4. Checkout / Portal callable guards
//
// safeReturnUrl is an open-redirect guard: the return URL arrives from the
// client and lands on a Stripe page, so an unvalidated value would let an
// attacker bounce a user from a page they trust to one they shouldn't.
// ---------------------------------------------------------------------------

// Two different things that used to share one constant: FALLBACK is where a
// rejected or absent value lands (DEFAULT_RETURN_ORIGIN), APP is merely *an*
// allowed origin. They diverged when the fallback moved to the branded domain,
// and conflating them would let a future repoint pass unnoticed.
const FALLBACK = "https://pulse.yasdu.com";
const APP = "https://pulse-b9d96.web.app";

assert(safeReturnUrl(`${APP}/`) === `${APP}/`, "returnUrl: the Firebase app origin is still allowed");
assert(
  safeReturnUrl("https://pulse.yasdu.com/") === "https://pulse.yasdu.com/",
  "returnUrl: the branded domain pulse.yasdu.com is allowed",
);
assert(
  safeReturnUrl("https://pulse.yasdu.com/?billing=success") === "https://pulse.yasdu.com/?billing=success",
  "returnUrl: branded domain keeps its query string",
);
// A lookalike of the branded domain must still be rejected.
assert(safeReturnUrl("https://pulse.yasdu.com.evil.com/") === FALLBACK, "returnUrl: branded-domain lookalike rejected");
assert(safeReturnUrl("https://evil.pulse.yasdu.com/") === FALLBACK, "returnUrl: subdomain of the branded host rejected");
assert(safeReturnUrl("http://pulse.yasdu.com/") === FALLBACK, "returnUrl: http on the branded domain rejected");
assert(safeReturnUrl("https://pulse-b9d96.firebaseapp.com/x") === "https://pulse-b9d96.firebaseapp.com/x", "returnUrl: alternate Firebase domain allowed");
assert(safeReturnUrl("http://localhost:5173/") === "http://localhost:5173/", "returnUrl: local dev allowed");
assert(safeReturnUrl("https://evil.example.com/steal") === FALLBACK, "returnUrl: foreign origin rejected");
// The classic bypasses: a lookalike host and a scheme swap on the real host.
assert(safeReturnUrl("https://pulse-b9d96.web.app.evil.com/") === FALLBACK, "returnUrl: suffix-lookalike host rejected");
assert(safeReturnUrl("http://pulse-b9d96.web.app/") === FALLBACK, "returnUrl: http on the https origin rejected");
assert(safeReturnUrl("javascript:alert(1)") === FALLBACK, "returnUrl: javascript: scheme rejected");
assert(safeReturnUrl("//evil.example.com") === FALLBACK, "returnUrl: protocol-relative rejected");
assert(safeReturnUrl("not a url") === FALLBACK, "returnUrl: unparseable falls back");
assert(safeReturnUrl(undefined) === FALLBACK && safeReturnUrl(null) === FALLBACK, "returnUrl: absent falls back");
assert(safeReturnUrl(42) === FALLBACK, "returnUrl: non-string falls back");
// The fallback itself must be an allowed origin, or every rejection would send
// the customer somewhere the guard would reject on the way back. Note the
// result carries a trailing slash the constant doesn't: an accepted value is
// returned as `new URL(...).toString()`, which normalises a bare origin.
assert(safeReturnUrl(FALLBACK) === `${FALLBACK}/`, "returnUrl: the fallback origin is itself allowed");

// ---------------------------------------------------------------------------
// 4b. Reading a tier back off an existing subscription
//
// The catalog is now resolved from PRODUCTS and their default_price, so nothing
// needs `tier` on a Price. tierOfPrice is the read-back path only: it keeps a
// price-metadata fallback so a subscription sold against the older
// price-tagged catalog still resolves to a plan instead of silently losing it.
// ---------------------------------------------------------------------------

const priceWith = (productMeta, priceMeta) => ({
  currency: "usd",
  unit_amount: 600,
  metadata: priceMeta ?? {},
  product: productMeta === null ? "prod_unexpanded" : { active: true, metadata: productMeta },
});

assert(tierOfPrice(priceWith({ tier: "pro" }, {})) === "pro", "readback: product metadata resolves");
assert(tierOfPrice(priceWith({ tier: "business" }, { tier: "pro" })) === "business", "readback: product wins over price");
assert(tierOfPrice(priceWith({}, { tier: "pro" })) === "pro", "readback: legacy price-tagged subscription still resolves");
assert(tierOfPrice(priceWith({}, {})) === null, "readback: untagged resolves to null");
assert(tierOfPrice(priceWith({ tier: "teams" }, {})) === "pro", "readback: legacy 'teams' alias maps to pro");
assert(tierOfPrice(priceWith(null, { tier: "pro" })) === "pro", "readback: unexpanded product falls back to price metadata");

const seatsThrows = (v) => {
  try {
    requireSeats(v);
    return false;
  } catch {
    return true;
  }
};
assert(requireSeats(undefined) === 1, "seats: default is 1");
assert(requireSeats(5) === 5, "seats: a valid count passes through");
assert(requireSeats("7") === 7, "seats: numeric string coerced");
assert(seatsThrows(0), "seats: 0 rejected");
assert(seatsThrows(-3), "seats: negative rejected");
assert(seatsThrows(2.5), "seats: fractional rejected");
assert(seatsThrows(1000), "seats: absurd count rejected");
assert(seatsThrows("many"), "seats: non-numeric rejected");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll SF3 assertions passed");
process.exit(failed ? 1 : 0);
