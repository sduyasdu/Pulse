// Comp the Business plan to a user's Organization(s), no Stripe involved.
// Dry run by default; pass --apply to write.
//   node scripts/grant-business.cjs santiago@yasdu.com            # show what would change
//   node scripts/grant-business.cjs santiago@yasdu.com --apply    # write billing/{orgId}
//   node scripts/grant-business.cjs santiago@yasdu.com --apply <workspaceId>   # just one org
// Run from the repo root (uses functions/node_modules/firebase-admin + gcloud ADC).
const admin = require(process.cwd() + "/functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "pulse-b9d96" });
const db = admin.firestore();

const [email, flag, onlyWs] = process.argv.slice(2);
const apply = flag === "--apply";

(async () => {
  const user = await admin.auth().getUserByEmail(email);
  console.log(`user ${email} → uid ${user.uid}`);
  const owned = await db.collection("workspaces").where("ownerId", "==", user.uid).get();
  if (owned.empty) throw new Error("user owns no workspace");

  for (const ws of owned.docs) {
    if (onlyWs && ws.id !== onlyWs) continue;
    const ref = db.doc(`billing/${ws.id}`);
    const cur = await ref.get();
    const prev = cur.exists ? cur.data() : null;
    console.log(`\nworkspace ${ws.id} "${ws.data().name}" personal=${ws.data().isPersonal}`);
    console.log("  current billing:", JSON.stringify(prev));
    if (prev?.source === "stripe" && prev?.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(prev.status)) {
      console.log("  ⚠ has a live Stripe subscription — skipping; the webhook would overwrite a manual grant");
      continue;
    }
    // source "manual" is the BillingDoc's own non-Stripe shape (src/types/index.ts:194).
    // No `seats`: editorSeatLimit treats a paid tier with no count as unlimited.
    // The free month's and referrals' marks are history, not plan state: a grant must
    // not erase that this org had its trial or who invited it (Trials-and-Referrals-Spec
    // TR1, TR9), or removing the grant later would offer a second free month.
    const KEEP = ["trialUsedAt", "trialSubscription", "trialEnd", "paidSince", "paidFingerprints", "livemode", "referredBy"];
    const kept = Object.fromEntries(KEEP.filter((k) => prev && prev[k] !== undefined).map((k) => [k, prev[k]]));
    const next = { ...kept, tier: "business", status: "active", source: "manual", updatedAt: Date.now() };
    console.log("  →", JSON.stringify(next));
    if (apply) {
      await ref.set(next); // full replace: drops stale seats/period/pastDueSince, keeps KEEP
      console.log("  ✓ written");
    }
  }
  if (!apply) console.log("\n(dry run — re-run with --apply to write)");
})().catch((e) => { console.error(e); process.exit(1); });
