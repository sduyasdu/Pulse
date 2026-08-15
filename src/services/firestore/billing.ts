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
export async function createCheckoutUrl(tier: Exclude<PlanTier, "starter">, seats: number): Promise<string> {
  const call = httpsCallable<{ tier: string; seats: number; returnUrl: string }, { url: string }>(
    functions,
    "createCheckoutSession",
  );
  const { data } = await call({ tier, seats, returnUrl: returnUrl() });
  return data.url;
}

/** Open the Stripe Customer Portal — update card, change seats, or cancel.
 * Only works once the org has been through Checkout at least once. */
export async function createPortalUrl(): Promise<string> {
  const call = httpsCallable<{ returnUrl: string }, { url: string }>(functions, "createPortalSession");
  const { data } = await call({ returnUrl: returnUrl() });
  return data.url;
}

/** One tier's live price, straight from Stripe (Plans-Spec PL14). `unitAmount`
 * is in **minor units** (600 = $6.00) as Stripe stores it. */
export interface PlanPrice {
  tier: PlanTier;
  currency: string;
  unitAmount: number | null;
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
