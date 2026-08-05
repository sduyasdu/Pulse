import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { DEFAULTS, isNoOp, log } from "./lib/conventions";

// Pulse Cloud Functions entry point (Server-Functions-Spec.md).
//
// One Admin SDK app for every function — the Admin SDK bypasses security rules,
// which is why a function is the *authoritative* writer of the fields it owns
// (Server-Functions-Spec §1). Region + concurrency are set once, globally, and
// co-located with Firestore (see conventions.REGION).
initializeApp();
setGlobalOptions(DEFAULTS);

/**
 * Phase 0 pipeline check — a trivial callable that proves deploy + invoke works
 * end to end (emulator and pulse-b9d96). Remove once real functions have shipped
 * (Billing-and-Backend-Build-Plan.md, Phase 0).
 */
export const ping = onCall((req) => {
  log("ping", "invoked", { uid: req.auth?.uid ?? null });
  return { ok: true, at: Date.now() };
});

/**
 * Phase 0 no-op Firestore trigger — proves write-triggered functions deploy and
 * fire, and demonstrates the no-op/loop guard every real trigger uses. Logs and
 * returns; writes nothing. Replaced by SF1 (the denorm maintainer) in Phase 1.
 */
export const onFeatureWriteNoop = onDocumentWritten("pulses/{pulseId}/features/{featureId}", (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (isNoOp(before, after)) return;
  log("onFeatureWriteNoop", "feature write observed", {
    pulseId: event.params.pulseId,
    featureId: event.params.featureId,
  });
});
