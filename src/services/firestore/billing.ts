import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import type { BillingDoc, PlanTier } from "@/types";

// Read-only access to the plan doc `billing/{workspaceId}` (Plans-Spec §4). The
// client NEVER writes it — the tier is set only by the Stripe webhook (SF3).
// Readable only by the org's admins (workspace owners) per firestore.rules; a
// rejected read resolves to `null` (⇒ Free via domain/entitlements).

export function subscribeBilling(workspaceId: string, cb: (billing: BillingDoc | null) => void): () => void {
  return onSnapshot(
    doc(db, "billing", workspaceId),
    (snap) => cb(snap.exists() ? (snap.data() as BillingDoc) : null),
    () => cb(null), // permission-denied / offline → treat as no plan (Free)
  );
}

export async function fetchBilling(workspaceId: string): Promise<BillingDoc | null> {
  try {
    const snap = await getDoc(doc(db, "billing", workspaceId));
    return snap.exists() ? (snap.data() as BillingDoc) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hosted Stripe flows. Both callables return a URL on Stripe's domain; payment
// details are never entered in-app (Plans-Spec §6). The resulting plan change
// arrives back through the SF3 webhook — nothing here writes `billing/{orgId}`,
// so the UI updates when the subscription does, not when the redirect happens.
// ---------------------------------------------------------------------------

/** Where Stripe should send the user back to. Sent to the server, which
 * validates it against an origin allowlist before using it. */
const returnUrl = () => `${window.location.origin}/`;

/**
 * Start Checkout for a paid tier and hand back the Stripe URL to redirect to.
 * `seats` is the number of paid editor seats (the billed quantity, PL9).
 */
export async function createCheckoutUrl(
  tier: Exclude<PlanTier, "starter">,
  seats: number,
  /** Force a presentment currency (a `currency_options` entry must exist for
   * it). Omit to let Stripe geolocate the buyer — the normal path. */
  currency?: string,
): Promise<string> {
  const call = httpsCallable<{ tier: string; seats: number; returnUrl: string; currency?: string }, { url: string }>(
    functions,
    "createCheckoutSession",
  );
  const { data } = await call({ tier, seats, returnUrl: returnUrl(), ...(currency ? { currency } : {}) });
  return data.url;
}

/** Open the Stripe Customer Portal — update card, change seats, or cancel.
 * Only works once the org has been through Checkout at least once. */
export async function createPortalUrl(): Promise<string> {
  const call = httpsCallable<{ returnUrl: string }, { url: string }>(functions, "createPortalSession");
  const { data } = await call({ returnUrl: returnUrl() });
  return data.url;
}

/** One tier's live prices, straight from Stripe (Plans-Spec PL14/PL17).
 * `amounts` is keyed by lowercase ISO currency and holds **minor units**
 * (600 = $6.00) as Stripe stores them — every currency the price is configured
 * for, not only the default. A tier may not offer every currency. */
export interface PlanPrice {
  tier: PlanTier;
  defaultCurrency: string;
  amounts: Record<string, number | null>;
}

/**
 * The live catalog, so the plans form shows what Checkout will actually charge
 * rather than a hardcoded constant that drifts the moment Stripe is edited.
 * Public pricing — no auth needed.
 */
export async function listPlanPrices(): Promise<PlanPrice[]> {
  const call = httpsCallable<Record<string, never>, { plans: PlanPrice[] }>(functions, "listPlans");
  const { data } = await call({});
  return data.plans ?? [];
}

// ---------------------------------------------------------------------------
// The free month and referrals (Trials-and-Referrals-Spec TR1–TR14). Every one
// is a callable: the marks and the ledger are server-only, so the client asks
// rather than reads.
// ---------------------------------------------------------------------------

/** Whether this owner's Upgrade starts a free month, and its terms (TR1, TR2). */
export async function getTrialOffer(): Promise<{ offered: boolean; days: number; maxSeats: number }> {
  const call = httpsCallable<Record<string, never>, { offered: boolean; days: number; maxSeats: number }>(functions, "getTrialOffer");
  return (await call({})).data;
}

/** TR2: the first invoice if the free month ended now — quoted, nothing changed. */
export async function quoteEndFreeTrial(): Promise<{ amount: number; currency: string; card: { brand: string; last4: string } | null }> {
  const call = httpsCallable<{ confirm?: boolean }, { amount: number; currency: string; card: { brand: string; last4: string } | null }>(functions, "endFreeTrial");
  return (await call({})).data;
}

/** TR2: end the free month now; the first invoice is raised at once. */
export async function endFreeTrial(): Promise<void> {
  const call = httpsCallable<{ confirm: boolean }, { ended: boolean }>(functions, "endFreeTrial");
  await call({ confirm: true });
}

export interface ReferralSummary {
  code: string | null;
  signedUp: number;
  subscribed: number;
  earnedThisYear: number;
  banked: number;
  cap: number;
  /** One Business seat-month in `currency`, minor units — what each friend earns. */
  reward: number | null;
  currency: string;
}

/** The workspace's link and counts (TR8). `create` mints the code on first ask. */
export async function getReferrals(create: boolean, currency?: string): Promise<ReferralSummary> {
  const call = httpsCallable<{ create: boolean; currency?: string }, ReferralSummary>(functions, "getReferrals");
  return (await call({ create, ...(currency ? { currency } : {}) })).data;
}

/** The name of the workspace behind a link, for "Invited by" (TR9). No sign-in needed. */
export async function resolveReferralCode(code: string): Promise<string | null> {
  const call = httpsCallable<{ code: string }, { name: string | null }>(functions, "resolveReferralCode");
  return (await call({ code })).data.name;
}

/** Count this new account's personal workspace as a friend (TR9). */
export async function claimReferral(code: string): Promise<{ status: string; reason?: string }> {
  const call = httpsCallable<{ code: string }, { status: string; reason?: string }>(functions, "claimReferral");
  return (await call({ code })).data;
}

/** TR14: dismiss the "you earned" notice for good, on every device. */
export async function dismissBillingNotice(): Promise<void> {
  const call = httpsCallable<Record<string, never>, { ok: boolean }>(functions, "dismissBillingNotice");
  await call({});
}
