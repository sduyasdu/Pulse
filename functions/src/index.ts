import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { DEFAULTS, log } from "./lib/conventions";

// Pulse Cloud Functions entry point (Server-Functions-Spec.md).
//
// One Admin SDK app for every function — the Admin SDK bypasses security rules,
// which is why a function is the *authoritative* writer of the fields it owns
// (Server-Functions-Spec §1). Region + concurrency are set once, globally, and
// co-located with Firestore (see conventions.REGION).
initializeApp();
setGlobalOptions(DEFAULTS);

/**
 * Lightweight health check — proves deploy + invoke works end to end. Cheap to
 * keep around as a smoke test.
 */
export const ping = onCall((req) => {
  log("ping", "invoked", { uid: req.auth?.uid ?? null });
  return { ok: true, at: Date.now() };
});

// SF1 — feature denormalization maintainer (Phase 1). Owns Feature.assignedUids
// / leadUid and the linkedUid fan-out.
export { onFeatureWriteDenorm, onResourceWriteFanout } from "./denorm";

// SF6–SF9 — cross-user integrity & cleanup on delete (Phase 2).
export { onPulseDelete, onMemberRemoved, onResourceDelete, onEpicDelete } from "./cascade";

// SF3 — billing / plan sync (Phase 3). The only writer of `billing/{orgId}`, and
// the server-side half of the PL4 downgrade. The two callables mint hosted
// Stripe URLs (Checkout / Customer Portal); payment details never touch the app.
export { stripeWebhook, createCheckoutSession, createPortalSession } from "./billing";
