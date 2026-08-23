import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { log, logError } from "./lib/conventions";
import { emailKey } from "./roster";

// Copying roster entries into a Pulse (Resource-Master-Spec §8.3, RM15).
//
// **Why this is a callable and not a client loop.** `pulses/{id}.resourceCount`
// is written asynchronously by a trigger, so twenty parallel creates are all
// evaluated against the same stale count and all twenty pass. The rule would
// stop the twenty-FIRST copy operation and none of the writes inside it. SF11
// accepts that convergence gap for Pulse creation because a burst is an edge
// case there; here the burst IS the feature.
//
// The cost of that choice, stated rather than hidden: the Admin SDK bypasses
// firestore.rules, so every check the rules would have made has to be made here.
// That is a second copy of the authorization, which this codebase otherwise
// works hard to avoid (MCP-Spec §1). It is confined to this one function, and
// mirrors `canWriteContent` + `withinResourceQuota` deliberately closely so the
// two can be compared line by line.

const FN = "RM15.rosterCopy";

/** Mirrors TIER_ENTITLEMENTS.maxResourcesPerPulse and `maxResourcesFor` in
 * firestore.rules. Three copies of this number now exist — client, rules, here —
 * which is two too many, but the rules cannot import and neither can this. */
const MAX_RESOURCES: Record<string, number> = { starter: 20, pro: 40, business: -1 };
const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

/** Cap on one call, so a mis-click cannot ask for thousands of writes. */
const MAX_PER_CALL = 100;

export const copyRosterToPulse = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const pulseId = typeof request.data?.pulseId === "string" ? request.data.pulseId : "";
  const masterIds: string[] = Array.isArray(request.data?.masterIds)
    ? request.data.masterIds.filter((x: unknown): x is string => typeof x === "string").slice(0, MAX_PER_CALL)
    : [];
  if (!pulseId || masterIds.length === 0) {
    throw new HttpsError("invalid-argument", "A pulseId and at least one resource are required.");
  }

  const db = getFirestore();
  try {
    // ---- the checks firestore.rules would have made -----------------------
    const [pulseSnap, memberSnap] = await Promise.all([
      db.doc(`pulses/${pulseId}`).get(),
      db.doc(`pulses/${pulseId}/pulseMembers/${uid}`).get(),
    ]);
    if (!pulseSnap.exists) throw new HttpsError("not-found", "That Pulse no longer exists.");
    const pulse = pulseSnap.data() ?? {};

    // canWriteContent: an editor or owner, and not frozen by archive.
    const role = memberSnap.exists ? memberSnap.data()?.role : null;
    if (role !== "owner" && role !== "editor") {
      throw new HttpsError("permission-denied", "Only an owner or editor can add resources.");
    }
    if (pulse.archivedAt != null) {
      throw new HttpsError("failed-precondition", "This Pulse is archived and read-only.");
    }

    const workspaceId = typeof pulse.workspaceId === "string" ? pulse.workspaceId : "";
    // RM3: the roster and the Pulse must belong to the same workspace, and the
    // caller must be entitled to read that roster. Without this a Pulse member
    // who is not in the workspace could pull the org's people through a
    // function that bypasses the rule stopping them reading it directly.
    if (!workspaceId || !(await db.doc(`workspaces/${workspaceId}/workspaceMembers/${uid}`).get()).exists) {
      throw new HttpsError("permission-denied", "You do not have access to this workspace's roster.");
    }

    // ---- quota, checked ONCE against a count nobody can race --------------
    const billing = await db.doc(`billing/${workspaceId}`).get();
    const b = billing.data();
    const tier = b && ACTIVE_STATUSES.includes(String(b.status ?? "canceled")) ? String(b.tier ?? "starter") : "starter";
    const limit = MAX_RESOURCES[tier] ?? MAX_RESOURCES.starter;

    const existing = await db.collection(`pulses/${pulseId}/resources`).get();
    // Recounted here rather than read off `resourceCount`: the stored counter is
    // eventually consistent, and this is the one place that must not be.
    const used = existing.size;
    const room = limit < 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);

    // Already-copied entries are skipped rather than duplicated — copying a team
    // twice should be a no-op, not a second Ana.
    const alreadyCopied = new Set(
      existing.docs.map((d) => d.data()?.masterId).filter((x): x is string => typeof x === "string"),
    );
    const wanted = masterIds.filter((id) => !alreadyCopied.has(id));

    // ---- read the roster, resolve, write ----------------------------------
    const masters = await Promise.all(
      wanted.map((id) => db.doc(`workspaces/${workspaceId}/resources/${id}`).get()),
    );
    const found = masters.filter((m) => m.exists);

    // Membership is read once and matched in code, for the normalisation reason
    // in roster.ts: stored member emails are not reliably lowercased.
    const members = await db.collection(`pulses/${pulseId}/pulseMembers`).get();
    const uidByEmail = new Map<string, string>();
    for (const m of members.docs) {
      const e = m.data()?.email;
      if (typeof e === "string" && e) uidByEmail.set(emailKey(e), m.id);
    }

    const toCopy = found.slice(0, room);
    const batch = db.batch();
    for (const m of toCopy) {
      const data = m.data() ?? {};
      const email = typeof data.linkedEmail === "string" && data.linkedEmail ? emailKey(data.linkedEmail) : null;
      const ref = db.collection(`pulses/${pulseId}/resources`).doc();
      batch.set(ref, {
        id: ref.id,
        name: data.name ?? "Unnamed",
        initials: data.initials ?? "",
        type: data.type ?? null,
        // The master's capacity is a DEFAULT, used here and never again (RM2).
        capacity: typeof data.capacity === "number" ? data.capacity : 100,
        masterId: m.id,
        linkedEmail: email,
        // Resolved inline because this function has already read the membership
        // it would need. The trigger would get there too, but a resource that
        // flickers through "waiting" on the way to "live" reads as a bug.
        linkedUid: email ? uidByEmail.get(email) ?? null : null,
      });
    }
    await batch.commit();

    const result = {
      copied: toCopy.length,
      skippedAlreadyPresent: masterIds.length - wanted.length,
      skippedMissing: wanted.length - found.length,
      skippedOverQuota: Math.max(0, found.length - toCopy.length),
      limit,
      used: used + toCopy.length,
    };
    log(FN, "copied roster entries", { uid, pulseId, workspaceId, tier, ...result });
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logError(FN, "roster copy failed", err, { uid, pulseId });
    throw new HttpsError("internal", "Could not copy those resources.");
  }
});
