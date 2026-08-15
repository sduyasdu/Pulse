// One-off backfill for SF11's `workspaces/{id}.pulseCount` (Plans-Spec §5, PL5).
//
// SF11 (functions/src/counters.ts) maintains the counter from the moment it is
// deployed, but only on a Pulse create or delete. Workspaces that predate it
// carry no counter at all, and the quota rule reads an absent counter as 0 —
// so each such org gets exactly one create past its cap before the counter
// materializes and enforcement starts. This closes that window immediately.
//
// DRY RUN BY DEFAULT — writes nothing unless you pass --apply.
//
//   node functions/scripts/backfill-pulse-counts.mjs            # report only
//   node functions/scripts/backfill-pulse-counts.mjs --apply
//
// Needs credentials: GOOGLE_APPLICATION_CREDENTIALS pointing at a service
// account key, or working Application Default Credentials. Under functions/ so
// ESM resolves firebase-admin from functions/node_modules.
//
// Safe to re-run: it recounts from the collection, exactly as SF11 does, so it
// is idempotent and converges rather than accumulating.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "pulse-b9d96";
const APPLY = process.argv.includes("--apply");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

console.log(`\nSF11 pulseCount backfill — project ${PROJECT_ID}`);
console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}\n`);

const workspaces = await db.collection("workspaces").get();
let changed = 0;

for (const ws of workspaces.docs) {
  const agg = await db.collection("pulses").where("workspaceId", "==", ws.id).count().get();
  const actual = agg.data().count;
  const stored = ws.get("pulseCount");
  const needsWrite = stored !== actual;
  if (needsWrite) changed++;
  console.log(
    `${needsWrite ? "→" : " "} ${ws.id}  stored=${stored ?? "(absent)"}  actual=${actual}  "${ws.get("name") ?? ""}"`,
  );
  if (needsWrite && APPLY) await ws.ref.set({ pulseCount: actual }, { merge: true });
}

console.log(
  `\n${APPLY ? `✔ Updated ${changed}` : `DRY RUN — ${changed} workspace(s) would change`} of ${workspaces.size} workspace(s).\n`,
);
