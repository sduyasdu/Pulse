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
 * The active recurring price for a tier, found by the `tier` metadata on its
 * product — the same metadata SF3 reads back off the subscription, so the two
 * directions can't drift. Listing and filtering rather than using the Search API
 * because search is eventually consistent and would miss a just-created price.
 */
async function priceForTier(stripe: Stripe, tier: PlanTier): Promise<Stripe.Price | null> {
  const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 100, expand: ["data.product"] });
  for (const price of prices.data) {
    const product = price.product;
    if (typeof product !== "object" || product === null) continue;
    if ("deleted" in product && product.deleted) continue;
    const p = product as Stripe.Product;
    if (p.active && readTier(p.metadata) === tier) return price;
  }
  return null;
}

/** Reuse the org's Stripe Customer, creating one (once) if it has never had one. */
async function ensureCustomer(db: Db, stripe: Stripe, workspaceId: string, workspace: Data, email: string | undefined): Promise<string> {
  const existing = workspace.stripeCustomerId;
  if (typeof existing === "string" && existing) return existing;

  const customer = await stripe.customers.create(
    {
      email,
      name: typeof workspace.name === "string" ? workspace.name : undefined,
      // Read first by SF3's resolveOrgId — without it a dashboard-created
      // subscription could only be matched by the reverse lookup below.
      metadata: { workspaceId },
    },
    // Keyed on the workspace so a double-click (or a retry) reuses the same
    // Customer instead of silently creating a second one.
    { idempotencyKey: `pulse-customer-${workspaceId}` },
  );
  await db.doc(`workspaces/${workspaceId}`).set({ stripeCustomerId: customer.id }, { merge: true });
  log(FN, "created Stripe customer", { workspaceId, customerId: customer.id });
  return customer.id;
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
  const customerId = await ensureCustomer(db, stripe, workspaceId, workspace, request.auth?.token?.email);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.id, quantity: seats }],
      client_reference_id: workspaceId,
      metadata: { workspaceId },
      // Read first by SF3 — the most direct org resolution there is.
      subscription_data: { metadata: { workspaceId } },
      // Stripe Tax computes IVA for MX customers, VAT-inclusive (Plans-Spec §9.5,
      // Billing-and-Backend-Build-Plan "Mexico specifics"). Needs a customer
      // address, which `customer_update` lets Checkout collect and save.
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      allow_promotion_codes: true,
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`,
    });
    if (!session.url) throw new HttpsError("internal", "Stripe returned a session without a URL.");
    log(FN, "created checkout session", { workspaceId, tier, seats, sessionId: session.id });
    return { url: session.url };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logError(FN, "checkout session failed", err, { workspaceId, tier, seats });
    // Most likely cause on a fresh account is Stripe Tax not being activated,
    // which `automatic_tax` requires — say so rather than a bare "internal".
    throw new HttpsError("internal", "Could not start Stripe Checkout. Check that Stripe Tax is enabled for this account.");
  }
});

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
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    log(FN, "created portal session", { workspaceId, customerId });
    return { url: session.url };
  } catch (err) {
    logError(FN, "portal session failed", err, { workspaceId, customerId });
    // The portal 400s until its configuration is saved once in the dashboard.
    throw new HttpsError("internal", "Could not open the Stripe billing portal. Check that the Customer Portal is configured.");
  }
});
