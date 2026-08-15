import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { log, logError } from "./lib/conventions";

// SF3 — Billing / plan sync (Server-Functions-Spec.md §SF3, Plans-Spec.md §4/§9,
// Billing-and-Backend-Build-Plan.md Phase 3).
//
// The **only** writer of `billing/{orgId}`. The plan is a security boundary — if
// the client could write it, any user would set themselves to Business — so the
// doc is `write: if false` in firestore.rules and is set here through the Admin
// SDK, which bypasses rules. `orgId === workspaceId` (PL6).
//
// Idempotency (Stripe delivers **at-least-once**, and out of order): every
// delivery *recomputes* the doc from the subscription's CURRENT state, refetched
// from Stripe rather than read out of the event payload. So a duplicate or
// late-arriving delivery converges on the same result. A delivery strictly older
// than the one already applied is dropped up front (`stripeEventCreated`), and a
// replay of the exact same event id is a no-op.

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

const FN = "SF3.billing";

type Db = FirebaseFirestore.Firestore;
type Data = FirebaseFirestore.DocumentData;

/** Mirrors src/types PlanTier / BillingStatus. Duplicated rather than imported:
 * functions/ is a separate package with its own tsconfig (rootDir `src`), so it
 * cannot reach the app's `src/types`. Keep the two in sync. */
export type PlanTier = "starter" | "pro" | "business";
export type BillingStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

/** The `fullViewer` capability bundle — mirrors PRESET_CAPS.fullViewer in
 * src/domain/permissions.ts (same cross-package duplication as above). Written
 * onto demoted members so their `caps` match their new role rather than being
 * left as the stale editor bundle. */
const FULL_VIEWER_CAPS = {
  readScope: "all",
  editScope: "none",
  editEpics: false,
  editResources: false,
  editConfig: false,
  comment: true,
  invite: false,
  manageMembers: false,
  deletePulse: false,
  viewPeopleCost: false,
} as const;

/**
 * Stripe subscription status → the subset we act on. `Stripe.Subscription.Status`
 * includes `OtherString` (forward-compatibility for statuses added server-side),
 * so this is a lookup with a fallback rather than an exhaustive switch: anything
 * unrecognized, plus `canceled`/`incomplete_expired`/`unpaid`/`paused`, means
 * "no live plan" and resolves to Starter downstream.
 */
const STATUS_MAP: Partial<Record<Stripe.Subscription.Status, BillingStatus>> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  incomplete: "incomplete",
};

export function mapStatus(status: Stripe.Subscription.Status): BillingStatus {
  return STATUS_MAP[status] ?? "canceled";
}

/**
 * A `tier` metadata value, validated. Only the two paid products carry it;
 * Starter is the absence of a subscription, never a Stripe product.
 *
 * **`"teams"` is accepted as a legacy alias for `"pro"`.** The $6 tier was
 * originally named Teams, and the live Stripe product still carries
 * `tier: "teams"` until someone edits it in the dashboard. Without this alias the
 * rename would be a coordinated deploy — code and Stripe having to change in the
 * same instant, with Checkout failing to find a price in between. With it, either
 * order is safe and the Stripe edit can happen whenever.
 */
export function readTier(meta: Stripe.Metadata | null | undefined): PlanTier | null {
  const t = meta?.tier?.trim().toLowerCase();
  if (t === "teams") return "pro"; // legacy: the $6 tier's former name
  return t === "pro" || t === "business" ? t : null;
}

/**
 * The tier a Price declares, for reading an **existing** subscription back:
 * product metadata first, price metadata as a legacy fallback.
 *
 * The fallback is tolerance, not a requirement. The catalog is resolved from
 * products (`tierCatalog`), so nothing needs `tier` on a Price any more — but a
 * subscription sold before that change may have been created against a
 * price-tagged catalog, and failing to resolve its tier would leave a paying
 * customer with no plan.
 *
 * Deliberately no `active` check: an existing subscription must still resolve
 * its tier after its product has been deactivated.
 */
export function tierOfPrice(price: Stripe.Price): PlanTier | null {
  const product = price.product;
  const expanded = typeof product === "object" && product !== null && !("deleted" in product && product.deleted);
  return (expanded ? readTier((product as Stripe.Product).metadata) : null) ?? readTier(price.metadata);
}

/**
 * The **licensed** subscription item: the first item whose product (preferred) or
 * price metadata declares a `tier`. Everything we surface hangs off this item —
 * `quantity` is the purchased editor seats (PL9: the seat count Stripe bills) and
 * `current_period_end` the renewal date.
 *
 * Note both period fields moved from the subscription onto its **items** in the
 * 2025 Stripe API versions (verified against the installed stripe@22 types):
 * `Subscription.current_period_end` no longer exists.
 */
export function licensedItem(sub: Stripe.Subscription): { item: Stripe.SubscriptionItem; tier: PlanTier } | null {
  for (const item of sub.items.data) {
    const tier = tierOfPrice(item.price);
    if (tier) return { item, tier };
  }
  return null;
}

/**
 * Does this (tier, status) pair still **hold its editor seats**? This is the
 * question the PL4 flip turns on — deliberately NOT the same as "does it grant a
 * paid plan for display", which is `tierOf` in src/domain/entitlements.ts
 * (active/trialing only).
 *
 * `past_due` counts as holding: Plans-Spec §5.1 says to ride Stripe's dunning for
 * a grace window rather than demote on a single failed charge, and Stripe emits
 * `customer.subscription.deleted` once dunning is exhausted — that is the event
 * that demotes.
 *
 * Both sides of the flip must use this same predicate. Using an active/trialing-
 * only test for the *previous* state would mean the usual involuntary-churn path
 * `active → past_due → canceled` never demotes at all: on the final event the
 * previous status is `past_due`, so "was paid" would read false and the flip
 * would go undetected.
 */
export function holdsSeats(tier: unknown, status: unknown): boolean {
  const paidTier = tier === "pro" || tier === "business";
  return paidTier && (status === "active" || status === "trialing" || status === "past_due");
}

/**
 * Resolve the org (= workspace) a subscription belongs to, most-authoritative
 * first: subscription metadata (stamped at Checkout), then Customer metadata,
 * then a reverse lookup on `Workspace.stripeCustomerId`. The reverse lookup is
 * the self-heal path for subscriptions created straight from the Stripe
 * dashboard, where no metadata was ever stamped.
 */
async function resolveOrgId(db: Db, sub: Stripe.Subscription, customer: Stripe.Customer | null): Promise<string | null> {
  const fromSub = sub.metadata?.workspaceId?.trim();
  if (fromSub) return fromSub;
  const fromCustomer = customer?.metadata?.workspaceId?.trim();
  if (fromCustomer) return fromCustomer;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const q = await db.collection("workspaces").where("stripeCustomerId", "==", customerId).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}

/**
 * PL4 downgrade (Plans-Spec §5.1) — run when an org's plan flips to Starter.
 * **Graceful, never destructive:** nothing is deleted and nobody loses access;
 * every editor/owner across the org's Pulses **except the org owner** is demoted
 * to full viewer, because Starter allows exactly one editor seat. They keep their
 * data and can be re-promoted when the org re-subscribes. The editor roster
 * collapses to `[ownerId]` to match.
 *
 * Done server-side so it holds regardless of client. Idempotent: re-running finds
 * nothing left to demote.
 *
 * The Pulse-quota half of §5.1 (newest over-limit Pulses become read-only) is
 * deliberately NOT here — it is derived client-side from the Pulse list ordered
 * by `createdAt`, since rules can neither count nor sort (PL5).
 */
export async function applyProDowngrade(db: Db, orgId: string): Promise<{ pulses: number; demoted: number }> {
  const wsRef = db.doc(`workspaces/${orgId}`);
  const ws = await wsRef.get();
  const ownerId = ws.get("ownerId");
  if (typeof ownerId !== "string" || !ownerId) {
    logError(FN, "downgrade skipped — workspace has no ownerId", new Error("missing ownerId"), { orgId });
    return { pulses: 0, demoted: 0 };
  }

  const writer = db.bulkWriter();
  // Starter = 1 editor seat, and it belongs to the org owner.
  writer.set(wsRef, { editorUids: [ownerId] }, { merge: true });

  const pulses = await db.collection("pulses").where("workspaceId", "==", orgId).get();
  let demoted = 0;
  let ownerless = 0;
  for (const pulse of pulses.docs) {
    const editors = await db
      .collection(`pulses/${pulse.id}/pulseMembers`)
      .where("role", "in", ["owner", "editor"])
      .get();
    let ownerRemains = false;
    for (const member of editors.docs) {
      if (member.id === ownerId) {
        ownerRemains = true;
        continue;
      }
      writer.set(member.ref, { role: "fullViewer", caps: FULL_VIEWER_CAPS }, { merge: true });
      demoted++;
    }
    if (!ownerRemains && !editors.empty) ownerless++;
  }
  await writer.close();

  log(FN, "applied PL4 Pro downgrade", { orgId, ownerId, pulses: pulses.size, demoted });
  // Surfaced because §5.1 keeps the *org* owner as sole editor, which can leave a
  // Pulse the org owner isn't a member of with nobody able to edit or manage it.
  if (ownerless > 0) {
    log(FN, "downgrade left Pulses with no editor (org owner is not a member)", { orgId, pulses: ownerless });
  }
  return { pulses: pulses.size, demoted };
}

/**
 * Recompute `billing/{orgId}` from the subscription's current state and, when the
 * plan flips off a paid tier, apply the PL4 downgrade.
 */
export async function syncSubscription(
  db: Db,
  stripe: Stripe,
  subscriptionId: string,
  event: Pick<Stripe.Event, "id" | "created" | "type">,
): Promise<void> {
  // Refetch rather than trust the (possibly stale, possibly out-of-order) event
  // payload; expanding the product gets us the `tier` metadata and expanding the
  // customer saves a second round-trip for org resolution + country.
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product", "customer"],
  });

  const rawCustomer = sub.customer;
  const customer =
    typeof rawCustomer === "object" && rawCustomer !== null && !("deleted" in rawCustomer && rawCustomer.deleted)
      ? (rawCustomer as Stripe.Customer)
      : null;
  const customerId = typeof rawCustomer === "string" ? rawCustomer : rawCustomer.id;

  const orgId = await resolveOrgId(db, sub, customer);
  if (!orgId) {
    // Unresolvable: a subscription for a Customer we can't map to a workspace.
    // Logged and swallowed (not thrown) — retrying can't fix missing metadata,
    // and a 500 would make Stripe retry this delivery for days.
    logError(FN, "cannot resolve workspace for subscription", new Error("unresolved org"), {
      subscriptionId,
      customerId,
      eventType: event.type,
    });
    return;
  }

  const ref = db.doc(`billing/${orgId}`);
  const prev = (await ref.get()).data();
  if (prev?.stripeEventId === event.id) {
    log(FN, "duplicate delivery ignored", { orgId, eventId: event.id });
    return;
  }
  const appliedAt = typeof prev?.stripeEventCreated === "number" ? prev.stripeEventCreated : null;
  if (appliedAt !== null && event.created < appliedAt) {
    log(FN, "stale delivery ignored", { orgId, eventId: event.id, eventCreated: event.created, appliedAt });
    return;
  }

  const licensed = licensedItem(sub);
  if (!licensed) {
    // A subscription with no `tier` metadata on any item — misconfigured product.
    // Recorded as unpaid so the org falls back to Starter rather than silently
    // inheriting a stale paid tier.
    logError(FN, "subscription has no tier metadata on any item", new Error("missing tier metadata"), {
      orgId,
      subscriptionId,
    });
  }
  const tier: PlanTier = licensed?.tier ?? "starter";
  const status = mapStatus(sub.status);

  // Timestamps are plain epoch millis, NOT Firestore Timestamp objects: the app
  // declares `type Timestamp = number` (src/types/index.ts) and every client
  // service writes `Date.now()`. Writing a Timestamp object here would hand the
  // billing UI an object where the type promises a number.
  const now = Date.now();
  const doc: Data = {
    tier,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currency: sub.currency,
    source: "stripe",
    updatedAt: now,
    stripeEventId: event.id,
    stripeEventCreated: event.created,
  };
  if (licensed) {
    doc.seats = licensed.item.quantity ?? 1;
    doc.currentPeriodEnd = licensed.item.current_period_end * 1000;
  }

  // Delinquency clock (Plans-Spec §5.1). Stamped when the org first enters
  // `past_due` and carried across every later past_due delivery, so the grace
  // window measures from the FIRST failed charge rather than restarting on each
  // dunning retry. Cleared the moment the org leaves past_due, so a recovered
  // org that later fails again gets a fresh window. `domain/entitlements`
  // resolves the org to Pro once DELINQUENCY_GRACE_DAYS have elapsed.
  doc.pastDueSince =
    status === "past_due"
      ? (typeof prev?.pastDueSince === "number" ? prev.pastDueSince : now)
      : FieldValue.delete();
  const country = customer?.address?.country;
  if (country) doc.country = country;

  await ref.set(doc, { merge: true });
  log(FN, "synced billing doc", {
    orgId,
    tier,
    status,
    seats: doc.seats ?? null,
    eventType: event.type,
    eventId: event.id,
  });

  // Keep the workspace's Stripe ids current so the reverse lookup in
  // resolveOrgId works even if metadata is later lost, and so the billing UI can
  // link to the portal.
  await db.doc(`workspaces/${orgId}`).set(
    { stripeCustomerId: customerId, stripeSubscriptionId: sub.id, ...(country ? { country } : {}) },
    { merge: true },
  );

  // A *flip* off the seats, not merely "currently unpaid" — so a duplicate cancel
  // delivery doesn't re-demote. `past_due` holds on both sides (see holdsSeats),
  // so entering dunning is a no-op while exhausting it demotes.
  const heldSeats = holdsSeats(prev?.tier, prev?.status);
  const holdsNow = holdsSeats(tier, status);
  if (heldSeats && !holdsNow) {
    await applyProDowngrade(db, orgId);
  }
}

/**
 * The subscription an event concerns, or null if the event isn't one we sync on.
 *
 * Note `Invoice.subscription` was removed at the top level in the 2025 API
 * versions — it now lives at `invoice.parent.subscription_details.subscription`
 * (verified against the installed stripe@22 types).
 */
export function subscriptionIdFor(event: Stripe.Event): string | null {
  const object = event.data.object as Data;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.trial_will_end":
      return typeof object.id === "string" ? object.id : null;
    case "checkout.session.completed": {
      const sub = (object as unknown as Stripe.Checkout.Session).subscription;
      return typeof sub === "string" ? sub : (sub?.id ?? null);
    }
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_succeeded": {
      const details = (object as unknown as Stripe.Invoice).parent?.subscription_details?.subscription;
      return typeof details === "string" ? details : (details?.id ?? null);
    }
    default:
      return null;
  }
}

/**
 * Stamp the workspace ↔ Stripe Customer link the moment Checkout completes, so
 * every later delivery for this Customer resolves even if the subscription
 * carries no metadata. The workspace comes from what the Checkout callable put
 * on the session (`metadata.workspaceId`, else `client_reference_id`).
 */
async function linkCheckoutSession(db: Db, stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.workspaceId?.trim() || session.client_reference_id?.trim();
  const customer = session.customer;
  const customerId = typeof customer === "string" ? customer : (customer?.id ?? null);
  if (!orgId || !customerId) return;
  await db.doc(`workspaces/${orgId}`).set({ stripeCustomerId: customerId }, { merge: true });
  // Stamp the org onto the Customer too. This used to happen at creation time;
  // now that Checkout creates the Customer, this is the only chance — and
  // `resolveOrgId` reads Customer metadata as its second fallback, for
  // subscriptions later made straight from the Stripe dashboard, which carry no
  // metadata of their own. Best-effort: the link above already covers the
  // reverse lookup, so a failure here costs a fallback, not the resolution.
  await stripe.customers.update(customerId, { metadata: { workspaceId: orgId } }).catch((err) => {
    logError(FN, "could not stamp workspaceId on customer", err, { orgId, customerId });
  });
  log(FN, "linked workspace to Stripe customer", { orgId, customerId });
}

/**
 * SF3 — the Stripe webhook endpoint.
 *
 * `invoker: "public"` is required and safe: Stripe calls this unauthenticated,
 * and the actual authentication is the **signature check** below, which runs
 * against the raw request body before anything is read. A 4xx tells Stripe not
 * to retry (bad signature / malformed); a 5xx asks it to retry (our fault).
 */
export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], invoker: "public", cors: false },
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).send("missing stripe-signature");
      return;
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    let event: Stripe.Event;
    try {
      // `req.rawBody` — NOT req.body: the signature is computed over the exact
      // bytes Stripe sent, so any JSON re-serialization breaks verification.
      event = stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value());
    } catch (err) {
      logError(FN, "signature verification failed", err);
      res.status(400).send("invalid signature");
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        await linkCheckoutSession(getFirestore(), stripe, event.data.object as Stripe.Checkout.Session);
      }
      const subscriptionId = subscriptionIdFor(event);
      if (!subscriptionId) {
        log(FN, "event ignored", { eventType: event.type, eventId: event.id });
        res.status(200).send("ignored");
        return;
      }
      await syncSubscription(getFirestore(), stripe, subscriptionId, event);
      res.status(200).send("ok");
    } catch (err) {
      logError(FN, "handler failed", err, { eventType: event.type, eventId: event.id });
      res.status(500).send("error"); // Stripe retries
    }
  },
);

// ---------------------------------------------------------------------------
// Hosted Stripe flows — Checkout (subscribe) and Customer Portal (manage).
//
// Payment details are NEVER entered in-app (Plans-Spec §6): both callables just
// mint a URL on Stripe's domain and hand it back for the client to redirect to.
// Neither writes `billing/{orgId}` — the resulting subscription comes back
// through the webhook above, which stays the single writer.
// ---------------------------------------------------------------------------

/**
 * Origins allowed as a Checkout/Portal return target. The return URL comes from
 * the client, so it is matched against this list rather than trusted: an open
 * redirect here would let an attacker bounce a user from a Stripe page they
 * trust to one they shouldn't.
 *
 * Adding an origin here is required for that origin to work at all. A returnUrl
 * from an unlisted origin does not error — it silently falls back to
 * DEFAULT_RETURN_ORIGIN, which strands the customer on a different domain, and
 * (because Firebase Auth state is per-origin) **signed out**, immediately after
 * paying. Quiet by design, so keep this list ahead of any new domain.
 *
 * `pulse.yasdu.com` is the intended branded domain and is pre-authorised here so
 * the DNS cutover needs no code change.
 */
const ALLOWED_RETURN_ORIGINS = [
  "https://pulse.yasdu.com",
  "https://pulse-b9d96.web.app",
  "https://pulse-b9d96.firebaseapp.com",
  "http://localhost:5173",
];

/**
 * Where an absent or rejected returnUrl lands. Named rather than taken as
 * `ALLOWED_RETURN_ORIGINS[0]`, so reordering the list above can't silently
 * repoint the fallback.
 *
 * Now the branded domain: `pulse.yasdu.com` resolves (CNAME to
 * `pulse-b9d96.web.app`) and serves a valid certificate, which was the condition
 * for moving it off the Firebase URL — a fallback pointing at a hostname that
 * doesn't resolve turns a recoverable redirect into a dead end. The Firebase
 * origins stay in the allowlist above, so a returnUrl from either still works.
 */
const DEFAULT_RETURN_ORIGIN = "https://pulse.yasdu.com";

export function safeReturnUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return DEFAULT_RETURN_ORIGIN;
  try {
    const url = new URL(raw);
    return ALLOWED_RETURN_ORIGINS.includes(url.origin) ? url.toString() : DEFAULT_RETURN_ORIGIN;
  } catch {
    return DEFAULT_RETURN_ORIGIN;
  }
}

/** The org the caller is acting for, asserting they may act for it at all. */
async function requireOwnedWorkspace(db: Db, uid: string, requested: unknown): Promise<{ workspaceId: string; workspace: Data }> {
  let workspaceId = typeof requested === "string" && requested.trim() ? requested.trim() : null;
  if (!workspaceId) {
    const user = await db.doc(`users/${uid}`).get();
    const personal = user.get("personalWorkspaceId");
    workspaceId = typeof personal === "string" ? personal : null;
  }
  if (!workspaceId) throw new HttpsError("failed-precondition", "No workspace for this account.");

  const snap = await db.doc(`workspaces/${workspaceId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Workspace not found.");
  // Billing is owner-only, mirroring the `billing/{orgId}` read rule. Checked
  // here because callables bypass security rules entirely.
  if (snap.get("ownerId") !== uid) throw new HttpsError("permission-denied", "Only the workspace owner can manage billing.");
  return { workspaceId, workspace: snap.data() ?? {} };
}

/**
 * The sellable catalog: for each **product** carrying a `tier` tag, that
 * product's **default price**.
 *
 * Products are the unit of tagging, not prices. A product declares which tier it
 * is, and Stripe's own `default_price` says which price to charge for it — so a
 * price needs no metadata at all, and adding a currency or running a promo price
 * doesn't mean re-tagging anything. It also removes the ambiguity of the old
 * "first active price matching the tier" scan, where two prices under one tier
 * resolved arbitrarily.
 *
 * Listing rather than the Search API because search is eventually consistent and
 * would miss a just-created product.
 *
 * Both the Checkout lookup and the plans form read this, so what is advertised
 * and what is charged come from one resolution (PL14).
 */
async function tierCatalog(stripe: Stripe): Promise<{ tier: PlanTier; price: Stripe.Price }[]> {
  const products = await stripe.products.list({ active: true, limit: 100, expand: ["data.default_price"] });
  const out: { tier: PlanTier; price: Stripe.Price }[] = [];
  for (const product of products.data) {
    const tier = readTier(product.metadata);
    if (!tier) continue;
    const price = product.default_price;
    if (typeof price !== "object" || price === null) {
      // Tagged for a tier but unsellable — worth saying out loud, because the
      // symptom downstream is "no price for tier" with no clue why.
      log(FN, "tier product has no default price set", { productId: product.id, tier });
      continue;
    }
    if (!price.active || price.type !== "recurring") continue;
    // Two products claiming one tier is a catalog mistake; take the first and
    // say so rather than picking silently.
    if (out.some((x) => x.tier === tier)) {
      log(FN, "duplicate tier product ignored", { productId: product.id, tier });
      continue;
    }
    out.push({ tier, price });
  }
  return out;
}

/** The price Checkout should bill for a tier — its product's default price. */
async function priceForTier(stripe: Stripe, tier: PlanTier): Promise<Stripe.Price | null> {
  return (await tierCatalog(stripe)).find((x) => x.tier === tier)?.price ?? null;
}

/**
 * SF3b — the live catalog, for the plans form (Plans-Spec PL14).
 *
 * `TIER_PRICE_USD` in the app was a hardcoded 6/12, and it drifted the moment the
 * live catalog moved to MXN: the plans form advertised "$6 USD" while Checkout
 * charged pesos — a mismatch in both amount *and* currency, on the screen
 * immediately before payment. This makes Stripe the single source of truth for
 * what is displayed, exactly as it already is for what is charged.
 *
 * Reads the same prices `priceForTier` resolves, so the figure shown is the
 * figure billed by construction rather than by discipline.
 *
 * Public pricing, so this needs no auth — it exposes nothing a checkout page
 * wouldn't. It is still a callable rather than a client-side Stripe read because
 * the secret key must not reach the browser.
 *
 * Amounts are returned in **minor units** (600 = $6.00) exactly as Stripe holds
 * them; the client formats with Intl.NumberFormat, which needs the currency code
 * anyway. Zero-decimal currencies (JPY and friends) therefore come out right
 * without a special case here.
 */
export const listPlans = onCall({ secrets: [STRIPE_SECRET_KEY] }, async () => {
  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  try {
    // The same catalog Checkout bills from, so the advertised price and the
    // charged price cannot disagree.
    const plans = (await tierCatalog(stripe)).map(({ tier, price }) => ({
      tier,
      currency: price.currency,
      unitAmount: price.unit_amount,
    }));
    log(FN, "listed plans", { count: plans.length });
    return { plans };
  } catch (err) {
    logError(FN, "listPlans failed", err);
    // Non-fatal by design: the client falls back to its built-in figures rather
    // than rendering an empty plan picker.
    throw new HttpsError("internal", "Could not read the plan catalog from Stripe.");
  }
});

/**
 * Expire this customer's still-open Checkout sessions before starting another.
 *
 * A Stripe Customer's **presentment currency is pinned by the first live object
 * attached to it — an open Checkout session counts.** With multi-currency prices
 * (`currency_options`, PL13) that has a nasty consequence: someone who opens
 * Checkout and backs out has silently locked their customer to whatever currency
 * that session used, so every later attempt is forced into it regardless of where
 * they are. Stripe then refuses outright with "You cannot combine currencies on a
 * single customer" if the catalog has since changed.
 *
 * Abandoned sessions are worthless — they hold a currency hostage for 24h and
 * nothing else — so clearing them restores the intended behaviour: Stripe
 * geolocates the buyer, uses the matching `currency_options` entry, and falls
 * back to the price's default currency when there isn't one.
 *
 * Best-effort: a failure here must not block the purchase, which is the whole
 * point of the request. Worst case the customer keeps its pinned currency, which
 * is exactly today's behaviour.
 */
async function expireOpenSessions(stripe: Stripe, customerId: string): Promise<void> {
  try {
    const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 });
    for (const session of open.data) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {
        /* already expired or completed in a race — nothing to do */
      });
    }
    if (open.data.length) log(FN, "expired abandoned checkout sessions", { customerId, count: open.data.length });
  } catch (err) {
    logError(FN, "could not expire open sessions — continuing", err, { customerId });
  }
}

/**
 * The org's existing Stripe Customer, or null if it has never subscribed.
 *
 * **Deliberately does not create one.** A Customer's presentment currency is
 * pinned by the first live object attached to it and is **immutable once set** —
 * Stripe offers no way to change it. Creating the Customer at the moment someone
 * *clicks* upgrade therefore locked the org into whatever currency that click
 * resolved to, permanently, before any money changed hands. Observed on
 * `cus_V4KxTPRImyty89`: nine abandoned USD sessions left the org unable to ever
 * be quoted in MXN, and expiring the sessions could not undo it.
 *
 * Checkout creates the Customer itself, on completion, so the currency is
 * decided by an actual purchase rather than by a page view (PL13).
 */
function existingCustomerId(workspace: Data): string | null {
  const existing = workspace.stripeCustomerId;
  return typeof existing === "string" && existing ? existing : null;
}

export function requireSeats(raw: unknown): number {
  const seats = raw === undefined || raw === null ? 1 : Number(raw);
  if (!Number.isInteger(seats) || seats < 1 || seats > 999) {
    throw new HttpsError("invalid-argument", "Seats must be a whole number between 1 and 999.");
  }
  return seats;
}

/**
 * Create a Stripe Checkout session for a paid tier and return its URL.
 *
 * Stamps `workspaceId` onto both the session and the resulting subscription, so
 * the webhook can resolve the org from the very first delivery.
 */
export const createCheckoutSession = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage billing.");

  const tier = request.data?.tier;
  if (tier !== "pro" && tier !== "business") {
    throw new HttpsError("invalid-argument", "Choose the Pro or Business plan."); // Starter is free — never a Checkout
  }
  const seats = requireSeats(request.data?.seats);
  const returnUrl = safeReturnUrl(request.data?.returnUrl);

  const db = getFirestore();
  const { workspaceId, workspace } = await requireOwnedWorkspace(db, uid, request.data?.workspaceId);
  const stripe = new Stripe(STRIPE_SECRET_KEY.value());

  const price = await priceForTier(stripe, tier);
  if (!price) {
    logError(FN, "no active price for tier", new Error("missing price"), { tier });
    throw new HttpsError("failed-precondition", `No active Stripe price is tagged with tier "${tier}".`);
  }
  // Reuse the Customer only if the org already has one; a first-time subscriber
  // gets theirs created by Checkout, on completion (see existingCustomerId).
  const customerId = existingCustomerId(workspace);
  if (customerId) await expireOpenSessions(stripe, customerId);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Returning subscriber → the same Customer, so cards and history carry
      // over. First-timer → an email to prefill, and Stripe mints the Customer
      // when they actually pay. `customer_update` is only valid alongside
      // `customer`, so the new-customer branch asks Checkout to collect the
      // address instead — Stripe Tax needs one either way.
      ...(customerId
        ? { customer: customerId, customer_update: { address: "auto" as const, name: "auto" as const } }
        : {
            ...(request.auth?.token?.email ? { customer_email: request.auth.token.email } : {}),
            billing_address_collection: "required" as const,
          }),
      line_items: [{ price: price.id, quantity: seats }],
      client_reference_id: workspaceId,
      metadata: { workspaceId },
      // Read first by SF3 — the most direct org resolution there is.
      subscription_data: { metadata: { workspaceId } },
      // Stripe Tax computes IVA for MX customers, VAT-inclusive (Plans-Spec §9.5,
      // Billing-and-Backend-Build-Plan "Mexico specifics"). It needs a customer
      // address, collected by whichever branch above applies.
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      // Stripe's default session lifetime is 24h, and closing the browser tab
      // tells it nothing — the session stays `open` server-side, holding a
      // reference to the price and (for an existing Customer) its currency.
      // 30 minutes is Stripe's floor and far past any real checkout, so an
      // abandoned attempt frees its locks in half an hour instead of a day.
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`,
    });
    if (!session.url) throw new HttpsError("internal", "Stripe returned a session without a URL.");
    log(FN, "created checkout session", { workspaceId, tier, seats, sessionId: session.id });
    return { url: session.url };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logError(FN, "checkout session failed", err, { workspaceId, tier, seats });
    // Report what Stripe actually said rather than guessing at a cause. This
    // message used to assert "check that Stripe Tax is enabled" — the likeliest
    // cause on a fresh account — and it then misdirected twice on live setup:
    // once when the key was invalid, once on a currency mismatch. Stripe's
    // own text for an invalid-request error names the real problem and is
    // configuration detail, not customer data, so it is safe to pass through.
    const detail = err instanceof Stripe.errors.StripeError ? err.message : null;
    throw new HttpsError("internal", detail ? `Stripe could not start Checkout: ${detail}` : "Could not start Stripe Checkout. Check the function logs for the cause.");
  }
});

/**
 * The Customer Portal configuration to open, pinned rather than left to Stripe's
 * account default.
 *
 * ⚠️ **This id is live-mode only.** Stripe configurations, like every other
 * object, do not cross modes — so if the secrets are ever rolled back to test
 * keys (Stripe-Go-Live-Runbook §7), this call fails with "No such configuration"
 * until the id is swapped for a test-mode one. That is the cost of pinning; the
 * benefit is that the portal can't silently change because someone re-pointed
 * the account default.
 */
const PORTAL_CONFIGURATION_ID = "bpc_1U4ACFIlKqCVxfmVO5vwpkxN";

/** How long a Checkout session stays open. Stripe's minimum is 30 minutes and
 * its default is 24 hours; the default is far too long for a session that holds
 * a price reference and pins a Customer's currency the moment it is created. */
const CHECKOUT_TTL_SECONDS = 30 * 60;

/**
 * Create a Stripe Customer Portal session — where an existing subscriber updates
 * their card, changes seat quantity, or cancels. Requires a Customer, so it is
 * only reachable once the org has been through Checkout at least once.
 */
export const createPortalSession = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage billing.");

  const returnUrl = safeReturnUrl(request.data?.returnUrl);
  const db = getFirestore();
  const { workspaceId, workspace } = await requireOwnedWorkspace(db, uid, request.data?.workspaceId);

  const customerId = workspace.stripeCustomerId;
  if (typeof customerId !== "string" || !customerId) {
    throw new HttpsError("failed-precondition", "This workspace has no Stripe customer yet — subscribe first.");
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY.value());
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: PORTAL_CONFIGURATION_ID,
      return_url: returnUrl,
    });
    log(FN, "created portal session", { workspaceId, customerId, configuration: PORTAL_CONFIGURATION_ID });
    return { url: session.url };
  } catch (err) {
    // The configuration id is logged because the two likely causes look
    // identical from the client: a portal never configured in this mode, and a
    // configuration id that belongs to the other mode.
    logError(FN, "portal session failed", err, { workspaceId, customerId, configuration: PORTAL_CONFIGURATION_ID });
    // Same reasoning as Checkout above: Stripe's own message beats our guess.
    const detail = err instanceof Stripe.errors.StripeError ? err.message : null;
    throw new HttpsError("internal", detail ? `Stripe could not open the billing portal: ${detail}` : "Could not open the Stripe billing portal. Check the function logs for the cause.");
  }
});
