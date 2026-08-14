// Stripe test → live cutover cleanup (Stripe-Go-Live-Runbook.md §4).
//
// Pulse runs ONE Firebase project, so test-mode Stripe residue lives in the same
// Firestore that serves real users. Those ids are invalid against a live key, and
// the failure is not transient: ensureCustomer() (functions/src/billing.ts:514)
// short-circuits when workspaces/{id}.stripeCustomerId is already set, so a live
// Checkout is handed a TEST customer and fails "No such customer" — permanently,
// for every workspace that ever touched test billing.
//
// DRY RUN BY DEFAULT. It writes nothing unless you pass --apply.
//
//   node functions/scripts/stripe-cutover-cleanup.mjs            # report only
//   node functions/scripts/stripe-cutover-cleanup.mjs --apply    # actually clean
//
// It lives under functions/ (not a repo-root scripts/) because ESM resolves
// imports from the script's own location, and firebase-admin is installed in
// functions/node_modules. Credentials come from Application Default Credentials
// (gcloud auth application-default login).
//
// ── The one thing this script cannot determine for you ──────────────────────
// Stripe object ids do NOT encode their mode: a test cus_… and a live cus_… are
// indistinguishable by inspection. So this cannot tell test residue from real
// live data by looking at it. It is safe ONLY before the first live Checkout,
// when everything present is necessarily test residue. After that, cleaning
// blindly would sever real paying customers from their subscriptions.
//
// The guard below enforces that: anything modified after CUTOVER_ISO is treated
// as possibly-live, reported separately, and never touched — not even with
// --apply. Review those by hand against the Stripe dashboard.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const PROJECT_ID = "pulse-b9d96";

/** When live secrets were bound (functions redeployed onto sk_live_…). Anything
 * touched at or after this instant might be a real live customer, so the script
 * refuses to clean it. Timestamps in this app are epoch millis. */
const CUTOVER_ISO = "2026-08-13T00:00:00Z";
const CUTOVER_MS = Date.parse(CUTOVER_ISO);

const APPLY = process.argv.includes("--apply");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

/** Epoch millis from whatever shape a timestamp field happens to be in. */
function millis(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Newest signal of activity on a doc, or null when it carries none. */
function touchedAt(data) {
  const candidates = [data.updatedAt, data.pastDueSince, data.createdAt].map(millis).filter((n) => typeof n === "number");
  return candidates.length ? Math.max(...candidates) : null;
}

const fmt = (ms) => (typeof ms === "number" ? new Date(ms).toISOString().slice(0, 10) : "—");

async function main() {
  console.log(`\nStripe cutover cleanup — project ${PROJECT_ID}`);
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log(`Cutover guard: anything touched on/after ${CUTOVER_ISO} is left alone.\n`);

  const workspaces = await db.collection("workspaces").get();
  const billing = await db.collection("billing").get();

  const clearable = [];   // workspaces holding pre-cutover Stripe ids
  const protectedWs = []; // workspaces touched after the cutover
  const collapsed = [];   // editorUids that look like a PL4 downgrade left them

  for (const doc of workspaces.docs) {
    const d = doc.data();
    const hasStripeIds = Boolean(d.stripeCustomerId || d.stripeSubscriptionId);
    const when = touchedAt(d);
    const isProtected = typeof when === "number" && when >= CUTOVER_MS;

    if (hasStripeIds) {
      (isProtected ? protectedWs : clearable).push({
        id: doc.id,
        name: d.name ?? "(unnamed)",
        customer: d.stripeCustomerId ?? null,
        subscription: d.stripeSubscriptionId ?? null,
        when,
      });
    }

    // A single-editor roster is normal for a solo workspace, so this is reported
    // for review and never auto-changed — the script cannot know who the editors
    // were meant to be.
    const editors = Array.isArray(d.editorUids) ? d.editorUids : null;
    if (editors && editors.length === 1 && d.ownerId && editors[0] === d.ownerId) {
      collapsed.push({ id: doc.id, name: d.name ?? "(unnamed)", ownerId: d.ownerId });
    }
  }

  const billingClearable = [];
  const billingProtected = [];
  for (const doc of billing.docs) {
    const d = doc.data();
    const when = touchedAt(d);
    const row = { id: doc.id, tier: d.tier ?? "—", status: d.status ?? "—", seats: d.seats ?? "—", when };
    (typeof when === "number" && when >= CUTOVER_MS ? billingProtected : billingClearable).push(row);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`Scanned ${workspaces.size} workspace(s), ${billing.size} billing doc(s).\n`);

  console.log(`1. workspaces with Stripe ids to clear — ${clearable.length}`);
  for (const w of clearable) {
    console.log(`   ${w.id}  "${w.name}"  customer=${w.customer ?? "—"}  sub=${w.subscription ?? "—"}  touched=${fmt(w.when)}`);
  }

  console.log(`\n2. billing docs to delete — ${billingClearable.length}`);
  for (const b of billingClearable) {
    console.log(`   billing/${b.id}  tier=${b.tier}  status=${b.status}  seats=${b.seats}  touched=${fmt(b.when)}`);
  }

  console.log(`\n3. editorUids collapsed to [ownerId] — ${collapsed.length} (review only, never auto-changed)`);
  for (const w of collapsed) {
    console.log(`   ${w.id}  "${w.name}"  ownerId=${w.ownerId}`);
  }

  if (protectedWs.length || billingProtected.length) {
    console.log(`\n⚠  PROTECTED — touched on/after the cutover, possibly real live data. Not cleaned, even with --apply:`);
    for (const w of protectedWs) console.log(`   workspaces/${w.id}  customer=${w.customer ?? "—"}  touched=${fmt(w.when)}`);
    for (const b of billingProtected) console.log(`   billing/${b.id}  tier=${b.tier}  status=${b.status}  touched=${fmt(b.when)}`);
    console.log(`   → Check each against the live Stripe dashboard before doing anything to it.`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply to perform ${clearable.length + billingClearable.length} change(s).\n`);
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  if (!clearable.length && !billingClearable.length) {
    console.log(`\nNothing to do.\n`);
    return;
  }

  const writer = db.bulkWriter();
  for (const w of clearable) {
    writer.update(db.doc(`workspaces/${w.id}`), {
      stripeCustomerId: FieldValue.delete(),
      stripeSubscriptionId: FieldValue.delete(),
    });
  }
  // billing/{orgId} is `write: if false` in firestore.rules; the Admin SDK
  // bypasses rules, which is the only way this is reachable at all.
  for (const b of billingClearable) writer.delete(db.doc(`billing/${b.id}`));
  await writer.close();

  console.log(`\n✔ Cleared ${clearable.length} workspace(s), deleted ${billingClearable.length} billing doc(s).\n`);
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err, "\n");
  process.exit(1);
});
