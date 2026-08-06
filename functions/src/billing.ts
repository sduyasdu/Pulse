import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
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
export type PlanTier = "pro" | "teams" | "business";
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
 * "no live plan" and resolves to Pro downstream.
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

/** A `tier` metadata value, validated. Only the two paid products carry it; Pro
 * is the absence of a subscription, never a Stripe product. */
export function readTier(meta: Stripe.Metadata | null | undefined): PlanTier | null {
  const t = meta?.tier?.trim().toLowerCase();
  return t === "teams" || t === "business" ? t : null;
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
    const product = item.price.product;
    const expanded = typeof product === "object" && product !== null && !("deleted" in product && product.deleted);
    const tier = (expanded ? readTier((product as Stripe.Product).metadata) : null) ?? readTier(item.price.metadata);
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
  const paidTier = tier === "teams" || tier === "business";
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
 * PL4 downgrade (Plans-Spec §5.1) — run when an org's plan flips to Pro.
 * **Graceful, never destructive:** nothing is deleted and nobody loses access;
 * every editor/owner across the org's Pulses **except the org owner** is demoted
 * to full viewer, because Pro allows exactly one editor seat. They keep their
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
  // Pro = 1 editor seat, and it belongs to the org owner.
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
    // Recorded as unpaid so the org falls back to Pro rather than silently
    // inheriting a stale paid tier.
    logError(FN, "subscription has no tier metadata on any item", new Error("missing tier metadata"), {
      orgId,
      subscriptionId,
    });
  }
  const tier: PlanTier = licensed?.tier ?? "pro";
  const status = mapStatus(sub.status);

  const doc: Data = {
    tier,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currency: sub.currency,
    source: "stripe",
    updatedAt: Timestamp.now(),
    stripeEventId: event.id,
    stripeEventCreated: event.created,
  };
  if (licensed) {
    doc.seats = licensed.item.quantity ?? 1;
    doc.currentPeriodEnd = Timestamp.fromMillis(licensed.item.current_period_end * 1000);
  }
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
async function linkCheckoutSession(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.workspaceId?.trim() || session.client_reference_id?.trim();
  const customer = session.customer;
  const customerId = typeof customer === "string" ? customer : (customer?.id ?? null);
  if (!orgId || !customerId) return;
  await db.doc(`workspaces/${orgId}`).set({ stripeCustomerId: customerId }, { merge: true });
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
        await linkCheckoutSession(getFirestore(), event.data.object as Stripe.Checkout.Session);
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
