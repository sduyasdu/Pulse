import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { log, logError } from "./lib/conventions";

// The free month and $12 for every friend who pays (Trials-and-Referrals-Spec.md,
// TR1–TR14). Split from billing.ts so every function here takes its Firestore and
// its Stripe as arguments: functions/test drives them against the emulator with a
// fake Stripe, which the webhook's signature check would never allow.
//
// Where things live, all server-only (firestore.rules):
// - `billing/{orgId}`: `trialUsedAt`, `trialSubscription`, `trialEnd` (kept after the
//   trial), `paidSince`, `paidFingerprints`, `livemode`, `referredBy`, and the
//   earned notice (`referralEarnedAt`, its amount, `referralNoticeDismissedAt`).
// - `trialPeople/{uid}`, `trialCards/{livemode}_{fingerprint}` (TR1).
// - `referralCodes/{code}` → `{ workspaceId, createdBy, createdAt }` (TR8).
// - `referrals/{workspaceId}` → `{ code, earned: { [year]: n }, banked }`, and its
//   ledger `referrals/{workspaceId}/friends/{orgId}` (TR9–TR13).

const FN = "TR.trials";

type Db = FirebaseFirestore.Firestore;

export const TRIAL_DAYS = 30;
/** TR2: a free month starts with at most this many seats. */
export const TRIAL_MAX_SEATS = 5;
/** TR5: a trial that never paid gets this many days past a failed first charge. */
export const TRIAL_GRACE_DAYS = 3;
/** TR13: rewards per workspace per calendar year. */
export const REFERRAL_CAP = 12;
/** TR11: a full refund this soon after the reward takes it back. */
export const REFUND_WINDOW_DAYS = 14;
/** TR9: a friend is counted only this soon after their workspace was made. */
export const CLAIM_WINDOW_HOURS = 24;

const DAY_MS = 86_400_000;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_RE = /^[a-z2-9]{8}$/;

export type FriendStatus = "signed-up" | "rewarded" | "void" | "over-cap" | "revoked" | "refunded-used";
export type VoidReason = "self" | "card" | "mode";

/** One Business seat-month in a currency, minor units, from Stripe's catalog (TR12). */
export type SeatPrice = (currency: string) => number | null;

const newCode = (): string => [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");

// ---------------------------------------------------------------------------
// The free month (TR1–TR7)
// ---------------------------------------------------------------------------

/**
 * Whether a Checkout now starts the org's free month (TR1, TR7): never had one, nor its
 * owner, never had a subscription, and not on a plan granted by hand.
 */
export function trialOffered(x: { orgTrialUsed: boolean; personTrialUsed: boolean; everSubscribed: boolean; granted: boolean }): boolean {
  return !x.orgTrialUsed && !x.personTrialUsed && !x.everSubscribed && !x.granted;
}

/** Reads what `trialOffered` decides on. `workspace` is the org's document, already read. */
export async function trialEligible(db: Db, uid: string, workspaceId: string, workspace: FirebaseFirestore.DocumentData): Promise<boolean> {
  const [billing, person] = await Promise.all([db.doc(`billing/${workspaceId}`).get(), db.doc(`trialPeople/${uid}`).get()]);
  return trialOffered({
    orgTrialUsed: billing.get("trialUsedAt") != null,
    personTrialUsed: person.exists,
    everSubscribed:
      typeof workspace.stripeCustomerId === "string" ||
      typeof billing.get("stripeSubscriptionId") === "string" ||
      billing.get("paidSince") != null,
    granted: billing.get("source") === "manual",
  });
}

/**
 * A free month that has just started (TR1): the org and the person who started it are
 * marked, and the card is remembered by its fingerprint. A card that started a trial for
 * another org — or an org or person that already had one, if two Checkouts raced — ends
 * this one at once, so the first invoice is raised today. Marked here, from the webhook,
 * never at Checkout: an abandoned Checkout burns nothing. Returns why it was ended, or
 * null if it stands.
 */
export async function recordTrial(
  db: Db,
  stripe: Stripe,
  orgId: string,
  uid: string | null,
  subscriptionId: string,
  livemode: boolean,
): Promise<"card-used" | "org-used" | "person-used" | null> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
  if (sub.status !== "trialing") return null;
  const pm = typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
  const fingerprint = pm?.card?.fingerprint ?? null;
  const orgRef = db.doc(`billing/${orgId}`);
  const personRef = uid ? db.doc(`trialPeople/${uid}`) : null;
  const cardRef = fingerprint ? db.doc(`trialCards/${livemode ? "live" : "test"}_${fingerprint}`) : null;
  const outcome = await db.runTransaction(async (tx) => {
    const [org, person, card] = await Promise.all([
      tx.get(orgRef),
      personRef ? tx.get(personRef) : Promise.resolve(null),
      cardRef ? tx.get(cardRef) : Promise.resolve(null),
    ]);
    const mine = (x: unknown) => x === subscriptionId;
    if (org.get("trialUsedAt") != null && !mine(org.get("trialSubscription"))) return "org-used" as const;
    if (person?.exists && !mine(person.get("subscriptionId"))) return "person-used" as const;
    if (card?.exists && !mine(card.get("subscriptionId"))) return "card-used" as const;
    const now = Date.now();
    tx.set(orgRef, { trialUsedAt: now, trialSubscription: subscriptionId }, { merge: true });
    if (personRef) tx.set(personRef, { workspaceId: orgId, subscriptionId, at: now });
    if (cardRef) tx.set(cardRef, { workspaceId: orgId, subscriptionId, at: now });
    return null;
  });
  if (outcome) {
    await stripe.subscriptions.update(subscriptionId, { trial_end: "now", proration_behavior: "none" });
    log(FN, "free month ended at once: one was had already", { orgId, outcome });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Referrals (TR8–TR14)
// ---------------------------------------------------------------------------

/** The workspace's referral code, made on first ask when `create` (TR8). Owner checked by the caller. */
export async function referralCode(db: Db, uid: string, workspaceId: string, create: boolean): Promise<string | null> {
  const rootRef = db.doc(`referrals/${workspaceId}`);
  const existing = (await rootRef.get()).get("code");
  if (typeof existing === "string") return existing;
  if (!create) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const codeRef = db.doc(`referralCodes/${code}`);
    const out = await db.runTransaction(async (tx) => {
      const [root, taken] = await Promise.all([tx.get(rootRef), tx.get(codeRef)]);
      const mine = root.get("code");
      if (typeof mine === "string") return mine;
      if (taken.exists) return null;
      tx.set(codeRef, { workspaceId, createdBy: uid, createdAt: Date.now() });
      tx.set(rootRef, { code }, { merge: true });
      return code;
    });
    if (out) return out;
  }
  throw new Error("could not mint a referral code");
}

/** The NAME of the workspace a link belongs to, for the sign-in screen — nothing else (TR9). */
export async function resolveReferral(db: Db, raw: unknown): Promise<{ name: string } | null> {
  if (typeof raw !== "string" || !CODE_RE.test(raw)) return null;
  const code = await db.doc(`referralCodes/${raw}`).get();
  if (!code.exists) return null;
  const ws = await db.doc(`workspaces/${String(code.get("workspaceId"))}`).get();
  return ws.exists ? { name: String(ws.get("name") ?? "") } : null;
}

export type ClaimOutcome =
  | { status: "signed-up" | "void"; reason?: VoidReason }
  | { status: "refused"; reason: "unknown-code" | "no-workspace" | "too-late" | "already" | "paid-before" };

/**
 * A friend counted (TR9, TR10): called by the client once, after `ensureUserDoc` has made
 * the personal workspace. Counted only within 24 hours of that workspace's creation, once,
 * and only for someone who has never paid in any workspace. Yourself — the referring
 * workspace's owner, the code's maker, or one of its members — is recorded `void`, never
 * dropped. `referredBy` and the ledger entry are written in ONE transaction.
 */
export async function claimReferral(db: Db, uid: string, raw: unknown, now = Date.now()): Promise<ClaimOutcome> {
  if (typeof raw !== "string" || !CODE_RE.test(raw)) return { status: "refused", reason: "unknown-code" };
  const user = await db.doc(`users/${uid}`).get();
  const orgId = user.get("personalWorkspaceId");
  if (typeof orgId !== "string") return { status: "refused", reason: "no-workspace" };
  const ws = await db.doc(`workspaces/${orgId}`).get();
  if (!ws.exists || ws.get("ownerId") !== uid) return { status: "refused", reason: "no-workspace" };
  const createdAt = Number(ws.get("createdAt") ?? 0);
  if (!(now - createdAt <= CLAIM_WINDOW_HOURS * 3_600_000)) return { status: "refused", reason: "too-late" };

  // Never paid in ANY workspace they own — read before the transaction, since a query
  // inside one would lock every workspace they own for a question about none of them.
  const owned = await db.collection("workspaces").where("ownerId", "==", uid).get();
  const bills = await Promise.all(owned.docs.map((d) => db.doc(`billing/${d.id}`).get()));
  if (bills.some((b) => b.get("paidSince") != null)) return { status: "refused", reason: "paid-before" };

  const codeRef = db.doc(`referralCodes/${raw}`);
  const billingRef = db.doc(`billing/${orgId}`);
  return db.runTransaction(async (tx): Promise<ClaimOutcome> => {
    const [code, billing] = await Promise.all([tx.get(codeRef), tx.get(billingRef)]);
    if (!code.exists) return { status: "refused", reason: "unknown-code" };
    if (billing.get("referredBy") != null) return { status: "refused", reason: "already" };
    const referrerId = String(code.get("workspaceId"));
    const [referrer, member] = await Promise.all([
      tx.get(db.doc(`workspaces/${referrerId}`)),
      tx.get(db.doc(`workspaces/${referrerId}/workspaceMembers/${uid}`)),
    ]);
    const self = referrerId === orgId || code.get("createdBy") === uid || referrer.get("ownerId") === uid || member.exists;
    tx.set(billingRef, { referredBy: { workspaceId: referrerId, code: raw, at: now } }, { merge: true });
    tx.set(db.doc(`referrals/${referrerId}/friends/${orgId}`), {
      status: self ? "void" : "signed-up",
      ...(self ? { reason: "self" } : {}),
      code: raw,
      signedUpAt: now,
    });
    return self ? { status: "void", reason: "self" } : { status: "signed-up" };
  });
}

/** Does the referrer hold a live subscription a credit can be taken from? */
function subscribed(billing: FirebaseFirestore.DocumentSnapshot): boolean {
  const tier = billing.get("tier");
  const status = billing.get("status");
  return (
    (tier === "pro" || tier === "business") &&
    (status === "active" || status === "trialing" || status === "past_due") &&
    typeof billing.get("stripeCustomerId") === "string"
  );
}

/**
 * The friend's first PAID invoice (TR11): the referrer earns $12 — one Business
 * seat-month in its billing currency (TR12) — credited on its Stripe customer when it is
 * subscribed, banked when it is on Starter. Never for a card that paid for the referrer, a
 * payment in the other Stripe mode (TR10), or past the year's twelve (TR13). Idempotent: a
 * ledger entry past `signed-up` is left alone, and the credit carries an idempotency key,
 * so a retried webhook never pays twice.
 */
export async function rewardReferral(
  db: Db,
  stripe: Stripe,
  refereeId: string,
  invoiceId: string,
  fingerprint: string | null,
  livemode: boolean,
  seatPrice: SeatPrice,
  now = new Date(),
): Promise<FriendStatus | null> {
  const referee = await db.doc(`billing/${refereeId}`).get();
  const referrerId = referee.get("referredBy.workspaceId");
  if (typeof referrerId !== "string") return null;
  const ledgerRef = db.doc(`referrals/${referrerId}/friends/${refereeId}`);
  const rootRef = db.doc(`referrals/${referrerId}`);
  const referrerBillingRef = db.doc(`billing/${referrerId}`);
  const [ledger, root, referrerBilling] = await Promise.all([ledgerRef.get(), rootRef.get(), referrerBillingRef.get()]);
  if (!ledger.exists || ledger.get("status") !== "signed-up") return null;

  const at = now.getTime();
  const paidCards: string[] = referrerBilling.get("paidFingerprints") ?? [];
  const referrerMode = referrerBilling.get("livemode");
  const reason: VoidReason | null =
    fingerprint && paidCards.includes(fingerprint) ? "card" : typeof referrerMode === "boolean" && referrerMode !== livemode ? "mode" : null;
  if (reason) {
    await ledgerRef.update({ status: "void", reason, invoiceId, livemode, at });
    return "void";
  }
  const year = String(now.getUTCFullYear());
  if (Number(root.get(`earned.${year}`) ?? 0) >= REFERRAL_CAP) {
    await ledgerRef.update({ status: "over-cap", invoiceId, livemode, at });
    return "over-cap";
  }

  const currency = String(referrerBilling.get("currency") ?? "usd");
  const amount = seatPrice(currency);
  const customerId = referrerBilling.get("stripeCustomerId") as string | undefined;
  const credit = subscribed(referrerBilling) && !!customerId && !!amount;
  if (credit) {
    await stripe.customers.createBalanceTransaction(
      customerId!,
      { amount: -amount!, currency, description: "Beats — a workspace you invited subscribed", metadata: { beatsReferral: refereeId } },
      { idempotencyKey: `beats-referral-${refereeId}` },
    );
  }
  const earned = await db.runTransaction(async (tx) => {
    const again = await tx.get(ledgerRef);
    if (again.get("status") !== "signed-up") return false;
    tx.update(ledgerRef, {
      status: "rewarded",
      invoiceId,
      livemode,
      rewardedAt: at,
      credited: credit,
      ...(credit ? { amount, currency } : {}),
    });
    tx.set(
      rootRef,
      { earned: { [year]: FieldValue.increment(1) }, ...(credit ? {} : { banked: FieldValue.increment(1) }) },
      { merge: true },
    );
    // TR14: the one-time notice, until the owner dismisses it.
    tx.set(
      referrerBillingRef,
      { referralEarnedAt: at, ...(amount ? { referralEarnedAmount: amount, referralEarnedCurrency: currency } : {}) },
      { merge: true },
    );
    return true;
  });
  log(FN, "referral rewarded", { referrerId, refereeId, credited: credit, amount, currency, earned });
  return earned ? "rewarded" : null;
}

/**
 * Rewards banked on Starter, credited when the workspace subscribes (TR12). A customer
 * balance is taken only from an invoice above zero, so it lands after any free month,
 * never stretching it. `sessionId` makes a redelivered Checkout the same credit.
 */
export async function creditBanked(
  db: Db,
  stripe: Stripe,
  orgId: string,
  customerId: string,
  currency: string,
  sessionId: string,
  seatPrice: SeatPrice,
): Promise<number> {
  const rootRef = db.doc(`referrals/${orgId}`);
  const root = await rootRef.get();
  const banked = Number(root.get("banked") ?? 0);
  if (banked <= 0 || root.get("bankedSession") === sessionId) return 0;
  const price = seatPrice(currency);
  if (!price) return 0;
  await stripe.customers.createBalanceTransaction(
    customerId,
    { amount: -price * banked, currency, description: `Beats — ${banked} workspace(s) you invited subscribed` },
    { idempotencyKey: `beats-banked-${sessionId}` },
  );
  await db.runTransaction(async (tx) => {
    const again = await tx.get(rootRef);
    if (again.get("bankedSession") === sessionId) return;
    tx.set(rootRef, { banked: Math.max(0, Number(again.get("banked") ?? 0) - banked), bankedSession: sessionId }, { merge: true });
  });
  log(FN, "banked referral rewards credited", { orgId, banked, currency });
  return banked;
}

/**
 * A full refund of the friend's first paid invoice within 14 days takes back a reward not
 * yet used (TR11): a credit still on the referrer's balance, or a banked one. A reward
 * already spent stays spent, and the ledger says so (`refunded-used`).
 */
export async function revokeReferral(db: Db, stripe: Stripe, refereeId: string, invoiceId: string, now = Date.now()): Promise<FriendStatus | null> {
  const referee = await db.doc(`billing/${refereeId}`).get();
  const referrerId = referee.get("referredBy.workspaceId");
  if (typeof referrerId !== "string") return null;
  const ledgerRef = db.doc(`referrals/${referrerId}/friends/${refereeId}`);
  const rootRef = db.doc(`referrals/${referrerId}`);
  const ledger = await ledgerRef.get();
  if (ledger.get("status") !== "rewarded" || ledger.get("invoiceId") !== invoiceId) return null;
  const at = Number(ledger.get("rewardedAt") ?? 0);
  if (now - at > REFUND_WINDOW_DAYS * DAY_MS) return null;

  let outcome: FriendStatus = "revoked";
  if (ledger.get("credited") === true) {
    const referrerBilling = await db.doc(`billing/${referrerId}`).get();
    const customerId = String(referrerBilling.get("stripeCustomerId"));
    const amount = Number(ledger.get("amount") ?? 0);
    const customer = await stripe.customers.retrieve(customerId);
    const balance = "deleted" in customer && customer.deleted ? 0 : (customer as Stripe.Customer).balance;
    // A balance still holding the credit is negative by at least its amount.
    if (balance <= -amount) {
      await stripe.customers.createBalanceTransaction(
        customerId,
        { amount, currency: String(ledger.get("currency") ?? "usd"), description: "Beats — a referral refunded" },
        { idempotencyKey: `beats-referral-revoke-${refereeId}` },
      );
    } else outcome = "refunded-used";
  }
  const year = String(new Date(at).getUTCFullYear());
  await db.runTransaction(async (tx) => {
    const [again, root] = await Promise.all([tx.get(ledgerRef), tx.get(rootRef)]);
    if (again.get("status") !== "rewarded") return;
    tx.update(ledgerRef, { status: outcome, revokedAt: now });
    if (outcome === "revoked") {
      tx.set(
        rootRef,
        {
          earned: { [year]: FieldValue.increment(-1) },
          ...(again.get("credited") === true ? {} : { banked: Math.max(0, Number(root.get("banked") ?? 0) - 1) }),
        },
        { merge: true },
      );
    }
  });
  log(FN, "referral refunded", { referrerId, refereeId, outcome });
  return outcome;
}

/** What the Billing dialog shows (TR8, TR14). Owner checked by the caller. */
export async function referralSummary(db: Db, workspaceId: string, now = new Date()): Promise<{
  signedUp: number;
  subscribed: number;
  earnedThisYear: number;
  banked: number;
  cap: number;
}> {
  const [root, ledger] = await Promise.all([db.doc(`referrals/${workspaceId}`).get(), db.collection(`referrals/${workspaceId}/friends`).get()]);
  const count = (...s: FriendStatus[]) => ledger.docs.filter((d) => s.includes(d.get("status"))).length;
  return {
    signedUp: count("signed-up", "rewarded", "over-cap", "revoked", "refunded-used"),
    subscribed: count("rewarded", "over-cap", "refunded-used"),
    earnedThisYear: Number(root.get(`earned.${now.getUTCFullYear()}`) ?? 0),
    banked: Number(root.get("banked") ?? 0),
    cap: REFERRAL_CAP,
  };
}

/**
 * The paid half of an `invoice.paid` (TR5, TR10, TR11): the first one above zero stamps
 * `paidSince`; every one adds its card to `paidFingerprints`, which is what makes a
 * friend paying with the referrer's own card void. Returns the card's fingerprint, for
 * the reward that follows.
 */
export async function recordPayment(db: Db, stripe: Stripe, orgId: string, subscriptionId: string, livemode: boolean): Promise<string | null> {
  let fingerprint: string | null = null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
    const pm = typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
    fingerprint = pm?.card?.fingerprint ?? null;
  } catch (err) {
    logError(FN, "could not read the paying card", err, { orgId, subscriptionId });
  }
  const ref = db.doc(`billing/${orgId}`);
  await db.runTransaction(async (tx) => {
    const billing = await tx.get(ref);
    tx.set(
      ref,
      {
        ...(billing.get("paidSince") == null ? { paidSince: Date.now() } : {}),
        livemode,
        ...(fingerprint ? { paidFingerprints: FieldValue.arrayUnion(fingerprint) } : {}),
      },
      { merge: true },
    );
  });
  return fingerprint;
}
