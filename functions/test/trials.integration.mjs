// TR1–TR14 integration test — the free month and referrals (Trials-and-Referrals-Spec.md),
// against the Firestore emulator with a FAKE Stripe: every function in lib/trials.js
// takes its Stripe as an argument for exactly this. The fake records what was asked of
// it, so "a credit was given once" is an assertion about calls, not about a balance.
// Exits non-zero on any failed assertion.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  trialOffered,
  trialEligible,
  recordTrial,
  referralCode,
  resolveReferral,
  claimReferral,
  rewardReferral,
  creditBanked,
  revokeReferral,
  referralSummary,
  recordPayment,
  REFERRAL_CAP,
  TRIAL_MAX_SEATS,
} from "../lib/trials.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

let failed = 0;
let passed = 0;
const assert = (cond, msg) => (cond ? (passed++, console.log("  ✓", msg)) : (failed++, console.error("  ✗", msg)));

/** A Stripe that answers what trials.js asks, and remembers it. */
function fakeStripe({ status = "trialing", fingerprint = "fp_1", balance = 0 } = {}) {
  const calls = { updates: [], credits: [], keys: new Set(), attempts: 0 };
  return {
    calls,
    subscriptions: {
      retrieve: async () => ({ status, default_payment_method: fingerprint ? { card: { fingerprint } } : null }),
      update: async (id, params) => calls.updates.push({ id, params }),
    },
    customers: {
      retrieve: async () => ({ balance }),
      createBalanceTransaction: async (customer, params, opts) => {
        calls.attempts++;
        // Stripe's idempotency key: a repeat is the same transaction, not a second one.
        if (opts?.idempotencyKey && calls.keys.has(opts.idempotencyKey)) return;
        if (opts?.idempotencyKey) calls.keys.add(opts.idempotencyKey);
        calls.credits.push({ customer, ...params });
      },
    },
  };
}

const price = (currency) => ({ usd: 1200, mxn: 24000 })[currency] ?? null;

async function clear() {
  for (const c of ["workspaces", "users", "billing", "trialPeople", "trialCards", "referralCodes", "referrals"]) {
    await db.recursiveDelete(db.collection(c));
  }
}

async function workspace(id, ownerId, { createdAt = Date.now(), members = [] } = {}) {
  await db.doc(`workspaces/${id}`).set({ id, name: `${id} name`, isPersonal: true, ownerId, createdAt });
  await db.doc(`workspaces/${id}/workspaceMembers/${ownerId}`).set({ uid: ownerId, role: "owner" });
  for (const m of members) await db.doc(`workspaces/${id}/workspaceMembers/${m}`).set({ uid: m, role: "member" });
  await db.doc(`users/${ownerId}`).set({ uid: ownerId, personalWorkspaceId: id });
}

// ---------------------------------------------------------------------------
console.log("TR1/TR7 — who is offered a free month");
// ---------------------------------------------------------------------------
const none = { orgTrialUsed: false, personTrialUsed: false, everSubscribed: false, granted: false };
assert(trialOffered(none), "a new org, a new person, never subscribed: offered");
assert(!trialOffered({ ...none, orgTrialUsed: true }), "an org that had one: not offered, whatever the tier");
assert(!trialOffered({ ...none, personTrialUsed: true }), "a person who had one in another workspace: not offered");
assert(!trialOffered({ ...none, everSubscribed: true }), "an org that ever subscribed: not offered");
assert(!trialOffered({ ...none, granted: true }), "a plan granted by hand: not offered");
assert(TRIAL_MAX_SEATS === 5, "a free month starts with at most 5 seats (TR2)");

await clear();
await workspace("wsA", "alice");
assert(await trialEligible(db, "alice", "wsA", { ownerId: "alice" }), "eligible: read from the emulator, nothing marked");
assert(!(await trialEligible(db, "alice", "wsA", { ownerId: "alice", stripeCustomerId: "cus_1" })), "a Stripe customer on the workspace: not eligible");

// ---------------------------------------------------------------------------
console.log("TR1 — one free month per org, person and card");
// ---------------------------------------------------------------------------
{
  const stripe = fakeStripe();
  assert((await recordTrial(db, stripe, "wsA", "alice", "sub_A", false)) === null, "the first trial stands");
  assert((await db.doc("billing/wsA").get()).get("trialSubscription") === "sub_A", "the org is marked");
  assert((await db.doc("trialPeople/alice").get()).exists, "the person is marked, outside users/{uid}");
  assert((await db.doc("trialCards/test_fp_1").get()).exists, "the card is marked by mode and fingerprint");
  assert((await recordTrial(db, stripe, "wsA", "alice", "sub_A", false)) === null, "a redelivery of the same trial is not a repeat");
  assert(stripe.calls.updates.length === 0, "...and ends nothing");
  assert(!(await trialEligible(db, "alice", "wsA", { ownerId: "alice" })), "after it: the org is no longer offered one");

  await workspace("wsA2", "alice");
  assert((await recordTrial(db, stripe, "wsA2", "alice", "sub_A2", false)) === "person-used", "the same person in a second workspace: ended");
  assert(stripe.calls.updates.at(-1)?.params.trial_end === "now", "...with trial_end now");

  await workspace("wsB", "bob");
  assert((await recordTrial(db, stripe, "wsB", "bob", "sub_B", false)) === "card-used", "another person, the same card: ended");
  const other = fakeStripe({ fingerprint: "fp_other" });
  await db.doc("billing/wsB").delete();
  await db.doc("billing/wsB").set({ trialUsedAt: 1, trialSubscription: "sub_old" });
  assert((await recordTrial(db, other, "wsB", "bob", "sub_B2", false)) === "org-used", "an org that had one, racing a second Checkout: ended");
  assert(
    (await recordTrial(db, fakeStripe({ status: "active" }), "wsB", "bob", "sub_paid", false)) === null,
    "a subscription that is not trialing marks nothing",
  );
  assert((await recordTrial(db, fakeStripe({ fingerprint: "fp_1" }), "wsC", null, "sub_live", true)) === null, "the same card in LIVE mode is a different card from test");
}

// ---------------------------------------------------------------------------
console.log("TR8/TR9 — a link, and a friend counted");
// ---------------------------------------------------------------------------
await clear();
const NOW = Date.UTC(2026, 9, 18);
await workspace("ref", "rita", { members: ["mo"] });
assert((await referralCode(db, "rita", "ref", false)) === null, "no code until asked to create one");
const code = await referralCode(db, "rita", "ref", true);
assert(/^[a-z2-9]{8}$/.test(code), "an 8-character code");
assert((await referralCode(db, "rita", "ref", true)) === code, "one per workspace: asking again returns the same");
assert((await resolveReferral(db, code))?.name === "ref name", "resolve returns the workspace's name");
const resolved = await resolveReferral(db, code);
assert(Object.keys(resolved).join() === "name", "...and nothing else");
assert((await resolveReferral(db, "nope")) === null, "a malformed code resolves to nothing");

await workspace("f1", "fred", { createdAt: NOW - 3_600_000 });
const c1 = await claimReferral(db, "fred", code, NOW);
assert(c1.status === "signed-up", "a new workspace inside 24 hours: signed up");
assert((await db.doc("billing/f1").get()).get("referredBy.workspaceId") === "ref", "referredBy written on the friend's billing doc");
assert((await db.doc("referrals/ref/friends/f1").get()).get("status") === "signed-up", "the referrer's ledger has the friend");
assert((await claimReferral(db, "fred", code, NOW)).reason === "already", "claimed once: a second claim is refused");

await workspace("f2", "gil", { createdAt: NOW - 25 * 3_600_000 });
assert((await claimReferral(db, "gil", code, NOW)).reason === "too-late", "a workspace older than 24 hours: refused");

await workspace("f3", "hal", { createdAt: NOW });
await db.doc("workspaces/old-hal").set({ ownerId: "hal", name: "Hal's old", createdAt: 0 });
await db.doc("billing/old-hal").set({ paidSince: 1 });
assert((await claimReferral(db, "hal", code, NOW)).reason === "paid-before", "someone who has paid in another workspace: refused");

await workspace("f4", "mo", { createdAt: NOW });
const c4 = await claimReferral(db, "mo", code, NOW);
assert(c4.status === "void" && c4.reason === "self", "a member of the referring workspace: recorded void, self");
assert((await db.doc("referrals/ref/friends/f4").get()).get("reason") === "self", "...and kept in the ledger, not dropped");
assert((await claimReferral(db, "rita", code, NOW)).status !== "signed-up", "the referrer cannot count herself");
assert((await claimReferral(db, "zed", code, NOW)).reason === "no-workspace", "an account with no workspace is refused");

// ---------------------------------------------------------------------------
console.log("TR11/TR12 — a reward on the first paid invoice, $12, once");
// ---------------------------------------------------------------------------
{
  // The referrer subscribed in USD, live mode unknown (never paid yet).
  await db.doc("billing/ref").set({ tier: "pro", status: "active", stripeCustomerId: "cus_ref", currency: "usd" });
  const stripe = fakeStripe();
  const out = await rewardReferral(db, stripe, "f1", "in_1", "fp_friend", true, price, new Date(NOW));
  assert(out === "rewarded", "the friend's first paid invoice rewards the referrer");
  assert(stripe.calls.credits.length === 1 && stripe.calls.credits[0].amount === -1200, "a credit of -$12.00 on the referrer's customer");
  assert(stripe.calls.credits[0].currency === "usd" && stripe.calls.credits[0].customer === "cus_ref", "in the referrer's currency, on its customer");
  assert((await rewardReferral(db, stripe, "f1", "in_1", "fp_friend", true, price, new Date(NOW))) === null, "a redelivered invoice rewards nothing more");
  assert(stripe.calls.credits.length === 1, "...one credit in all");
  assert(stripe.calls.attempts === 1, "...and the redelivery never even asked Stripe — the ledger's state stops it, not only the idempotency key");
  const billing = (await db.doc("billing/ref").get()).data();
  assert(billing.referralEarnedAt === NOW && billing.referralEarnedAmount === 1200, "the earned notice is set for the owner (TR14)");
  const s = await referralSummary(db, "ref", new Date(NOW));
  assert(s.signedUp === 1 && s.subscribed === 1 && s.earnedThisYear === 1 && s.banked === 0, "counts: one signed up, one subscribed, one earned");
}

// ---------------------------------------------------------------------------
console.log("TR10 — never counted: the same card, the other mode");
// ---------------------------------------------------------------------------
{
  await db.doc("billing/ref").set({ paidFingerprints: ["fp_rita"], livemode: true }, { merge: true });
  for (const [ws, uid] of [["g1", "g1u"], ["g2", "g2u"]]) {
    await workspace(ws, uid, { createdAt: NOW });
    await claimReferral(db, uid, code, NOW);
  }
  const stripe = fakeStripe();
  assert((await rewardReferral(db, stripe, "g1", "in_g1", "fp_rita", true, price, new Date(NOW))) === "void", "a friend paying with a card that paid for the referrer: void");
  assert((await db.doc("referrals/ref/friends/g1").get()).get("reason") === "card", "...reason card");
  assert((await rewardReferral(db, stripe, "g2", "in_g2", "fp_g2", false, price, new Date(NOW))) === "void", "a test-mode payment for a live referrer: void");
  assert((await db.doc("referrals/ref/friends/g2").get()).get("reason") === "mode", "...reason mode");
  assert(stripe.calls.credits.length === 0, "neither credits anything");
}

// ---------------------------------------------------------------------------
console.log("TR13 — twelve a year, then over-cap");
// ---------------------------------------------------------------------------
{
  await db.doc("referrals/ref").set({ earned: { 2026: REFERRAL_CAP } }, { merge: true });
  await workspace("h1", "h1u", { createdAt: NOW });
  await claimReferral(db, "h1u", code, NOW);
  const stripe = fakeStripe();
  assert((await rewardReferral(db, stripe, "h1", "in_h1", "fp_h1", true, price, new Date(NOW))) === "over-cap", "the thirteenth this year: over-cap");
  assert(stripe.calls.credits.length === 0, "...and no credit");
  await db.doc("referrals/ref").set({ earned: { 2026: 1 } }, { merge: true });
}

// ---------------------------------------------------------------------------
console.log("TR12 — banked on Starter, given at the first subscription");
// ---------------------------------------------------------------------------
{
  await workspace("star", "sam");
  const starCode = await referralCode(db, "sam", "star", true);
  await workspace("k1", "k1u", { createdAt: NOW });
  await claimReferral(db, "k1u", starCode, NOW);
  const stripe = fakeStripe();
  assert((await rewardReferral(db, stripe, "k1", "in_k1", "fp_k1", true, price, new Date(NOW))) === "rewarded", "a referrer on Starter is rewarded");
  assert(stripe.calls.credits.length === 0, "...with nothing to credit yet");
  assert((await referralSummary(db, "star", new Date(NOW))).banked === 1, "...so it is banked");
  assert((await creditBanked(db, stripe, "star", "cus_star", "mxn", "cs_1", price)) === 1, "at its first Checkout the bank is credited");
  assert(stripe.calls.credits[0]?.amount === -24000 && stripe.calls.credits[0]?.currency === "mxn", "...at the Business seat's peso price");
  assert((await creditBanked(db, stripe, "star", "cus_star", "mxn", "cs_1", price)) === 0, "a redelivered Checkout credits nothing more");
  assert((await referralSummary(db, "star", new Date(NOW))).banked === 0, "the bank is empty");
}

// ---------------------------------------------------------------------------
console.log("TR11 — a full refund within 14 days takes back an unused reward");
// ---------------------------------------------------------------------------
{
  // f1's reward was credited on cus_ref: still on the balance → revoked.
  const unused = fakeStripe({ balance: -1200 });
  assert((await revokeReferral(db, unused, "f1", "in_1", NOW + 86_400_000)) === "revoked", "still on the balance: revoked");
  assert(unused.calls.credits[0]?.amount === 1200, "...by a positive balance transaction of the same amount");
  assert((await referralSummary(db, "ref", new Date(NOW))).earnedThisYear === 0, "the year's count goes back down (1 → 0)");
  assert((await revokeReferral(db, unused, "f1", "in_1", NOW + 86_400_000)) === null, "a second refund event changes nothing");

  // k1's reward was banked, then credited at sam's Checkout — but a banked one that is
  // still in the bank is simply taken out. Make a fresh banked reward to test that.
  await workspace("k2", "k2u", { createdAt: NOW });
  await claimReferral(db, "k2u", (await referralCode(db, "sam", "star", false)), NOW);
  await rewardReferral(db, fakeStripe(), "k2", "in_k2", "fp_k2", true, price, new Date(NOW));
  assert((await referralSummary(db, "star", new Date(NOW))).banked === 1, "a second banked reward");
  assert((await revokeReferral(db, fakeStripe(), "k2", "in_k2", NOW + 86_400_000)) === "revoked", "refunded while banked: revoked");
  assert((await referralSummary(db, "star", new Date(NOW))).banked === 0, "...and taken out of the bank");

  await workspace("k3", "k3u", { createdAt: NOW });
  await claimReferral(db, "k3u", code, NOW);
  await db.doc("billing/ref").set({ paidFingerprints: [], livemode: true }, { merge: true });
  await rewardReferral(db, fakeStripe(), "k3", "in_k3", "fp_k3", true, price, new Date(NOW));
  const spent = fakeStripe({ balance: 0 });
  assert((await revokeReferral(db, spent, "k3", "in_k3", NOW + 86_400_000)) === "refunded-used", "a credit already spent: stays spent, ledger says so");
  assert(spent.calls.credits.length === 0, "...nothing is charged back");

  await workspace("k4", "k4u", { createdAt: NOW });
  await claimReferral(db, "k4u", code, NOW);
  await rewardReferral(db, fakeStripe(), "k4", "in_k4", "fp_k4", true, price, new Date(NOW));
  assert((await revokeReferral(db, fakeStripe({ balance: -1200 }), "k4", "in_k4", NOW + 15 * 86_400_000)) === null, "a refund after 14 days takes nothing back");
  assert((await revokeReferral(db, fakeStripe({ balance: -1200 }), "k4", "in_other", NOW)) === null, "a refund of a different invoice takes nothing back");
}

// ---------------------------------------------------------------------------
console.log("TR5/TR10 — a payment recorded");
// ---------------------------------------------------------------------------
{
  await workspace("p1", "pat");
  const fp = await recordPayment(db, fakeStripe({ status: "active", fingerprint: "fp_pat" }), "p1", "sub_p1", true);
  const b = (await db.doc("billing/p1").get()).data();
  assert(fp === "fp_pat" && b.paidFingerprints?.includes("fp_pat"), "the paying card's fingerprint is kept");
  assert(typeof b.paidSince === "number" && b.livemode === true, "paidSince and the mode are stamped");
  const first = b.paidSince;
  await recordPayment(db, fakeStripe({ status: "active", fingerprint: "fp_pat2" }), "p1", "sub_p1", true);
  const b2 = (await db.doc("billing/p1").get()).data();
  assert(b2.paidSince === first, "paidSince is the FIRST payment, not the latest");
  assert(b2.paidFingerprints.length === 2, "a second card joins the list");
}

console.log(failed ? `\n${failed} assertion(s) FAILED (${passed} passed)` : `\nAll TR assertions passed (${passed})`);
process.exit(failed ? 1 : 0);
