import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { DEFAULTS, log } from "./lib/conventions";

// Beat Cloud Functions entry point (Server-Functions-Spec.md).
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

// SF11 — quota counters (Phase 3). The only writer of `workspace.pulseCount`,
// which the Beat-create rule gates on.
export { onPulseCreateCount, onPulseDeleteCount } from "./counters";

// RM10 — per-Beat resource counter (Resource-Master-Spec §8). The writer for
// the rule that gates `maxResourcesPerPulse`, and it ships BEFORE that rule:
// a gate reading a field nothing writes yet is inert and looks deployed.
export { onResourceCreateCount, onResourceDeleteCount, reconcileResourceCounts } from "./counters";

// SF3 — billing / plan sync (Phase 3). The only writer of `billing/{orgId}`, and
// the server-side half of the PL4 downgrade. The two callables mint hosted
// Stripe URLs (Checkout / Customer Portal); payment details never touch the app.
export { stripeWebhook, createCheckoutSession, createPortalSession, listPlans } from "./billing";

// MCP — the OAuth half (MCP-Spec.md §2/§2.1, Phase 0). The MCP service itself
// acts as the customer; the Admin SDK appears here only to mint their token.
export { approveMcpConnection, mcpOauthToken } from "./mcp";

// The MCP service itself (MCP-Spec §1/§5). JSON-RPC over HTTP, reading Firestore
// as the customer through the REST API so security rules still apply.
export { mcp, mcpMetadata } from "./mcpServer";

// MCP retention sweep (MCP-Privacy-Disclosure §5). The project's first scheduled
// function — deploying it needs the Cloud Scheduler API enabled. Exists to make
// a retention claim in the privacy policy true, not to close an exploit.
export { mcpCleanup } from "./mcpCleanup";

// RM16 — resource master link resolution (Resource-Master-Spec §5). The ONLY
// writer of `MasterResource.linkedUid`: the email is the durable intent a client
// sets, the uid is derived from real membership.
export { onMasterResourceWriteResolve, onWorkspaceMemberJoinResolve, onWorkspaceMemberLeaveUnresolve } from "./roster";

// The same resolution one level down, against a Beat's own membership. A
// resource copied from the roster arrives with an email and no uid — the
// master's uid means "in the workspace" and says nothing about THIS Beat.
export { onPulseResourceWriteResolve, onPulseMemberJoinResolve } from "./roster";

// RM13 — deleting a roster entry detaches its copies rather than deleting them.
// Server-side because the workspace owner doing the deleting is routinely not a
// member of the Beats holding those copies.
export { onMasterResourceDeletedDetach } from "./roster";

// RM2/RM22 — identity changes on a roster entry reach its copies. Name,
// initials, org role and linked email only; capacity is per-Beat and linkedUid
// is resolved locally.
export { onMasterResourceWritePropagate } from "./roster";

// RM15 — bulk copy from the roster into a Beat. A callable rather than a client
// loop because the resource counter is async: parallel creates all see the same
// stale count, so the rule would stop the next OPERATION and none of the writes
// inside this one.
export { copyRosterToPulse } from "./rosterCopy";

// RM7 — the "where is this person" index. Server-owned, so the rule that guards
// it is "workspace members read" rather than a collection-group query nobody can
// scope safely.
export { onPulseResourceUsage, onPulseRenameSyncUsage } from "./roster";

// RM7 — catching the usage index up on copies that predate its trigger, and
// repairing a missed delivery. A maintainer without a way to catch up existing
// rows is half a feature.
export { rebuildRosterUsage, reconcileRosterUsage } from "./roster";

// SF15 — self-service account deletion. A callable pair rather than an Auth
// lifecycle trigger: 2nd-gen has no after-delete event, and a trigger would run
// once the identity is already gone, leaving a failed teardown with no signed-in
// user able to retry it. Teardown drives SF6 and SF7 by deleting the documents
// they watch, instead of copying their logic.
export { previewAccountDeletion, deleteAccount } from "./account";
