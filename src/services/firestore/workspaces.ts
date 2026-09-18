import { collection, doc, getDoc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Cycle, Workspace, WorkspaceMember } from "@/types";
import { emailKey } from "./emailKey";
import { DEFAULT_ORG_CYCLES } from "@/domain/constants";

/**
 * Creates a personal workspace for a brand-new user and grants them
 * 'owner'. These must be two SEQUENTIAL writes, not a single writeBatch:
 * the workspaceMembers.create rule does `get()` on the workspace doc to
 * check `ownerId`, and within one batch, Firestore evaluates every
 * operation's rules against the pre-commit state — the batched workspace
 * write isn't visible to that get() yet, so the whole batch gets denied.
 * Committing the workspace doc first (and awaiting it) makes it visible
 * to the second write's rule evaluation.
 */
export async function createPersonalWorkspace(uid: string, displayName: string | null, email?: string | null): Promise<string> {
  const workspaceRef = doc(db, "workspaces", `personal-${uid}`);
  const workspace: Workspace = {
    id: workspaceRef.id,
    name: displayName ? `${displayName}'s Workspace` : "My Workspace",
    isPersonal: true,
    ownerId: uid,
    createdAt: Date.now(),
    // CY12. Templates, copied when chosen — nothing reads them at render time,
    // so seeding them here costs one field and no behaviour. Only NEW
    // workspaces get them: an existing one has no cycles and `cyclesOf`
    // computes its single implicit cycle (CY11), which is the whole point of
    // not migrating.
    cycles: DEFAULT_ORG_CYCLES,
  };
  await setDoc(workspaceRef, workspace);

  // `email` is denormalized here so the roster can resolve a linked email to a
  // uid in one query (RM16). Normalized on the way in, because it is compared
  // against `MasterResource.linkedEmail`, which is stored the same way.
  const member: WorkspaceMember = { uid, role: "owner", joinedAt: Date.now(), ...(email ? { email: emailKey(email) } : {}) };
  await setDoc(doc(db, "workspaces", workspaceRef.id, "workspaceMembers", uid), member);

  return workspaceRef.id;
}

/**
 * Live workspace doc — used for the server-maintained quota counters SF11
 * writes (`pulseCount`). Maps a permission-denied to `null` rather than
 * throwing, exactly as `subscribeBilling` does: a non-member has nothing to
 * show, and a quota display is not worth an unhandled rejection.
 */
export function subscribeWorkspace(
  workspaceId: string,
  cb: (ws: Workspace | null) => void,
  onError?: (message: string) => void,
): () => void {
  return onSnapshot(
    doc(db, "workspaces", workspaceId),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as Workspace) : null),
    (err) => onError?.(err.message),
  );
}

/**
 * Backfill `email` onto the caller's own workspace membership.
 *
 * `WorkspaceMember.email` arrived with the roster (RM16), and a personal
 * workspace's member document is written **once**, at first sign-in — so every
 * account that existed before it has no email, and the roster resolver has
 * nothing to match on. Every roster entry would sit at "Waiting" forever, which
 * is exactly how this was found.
 *
 * Self-heal rather than a migration script, for the reason recorded in
 * `Resource-Master-Spec` §8.1 about SF11's backfill: a script somebody has to
 * remember to run is a script that does not get run.
 *
 * Owner-only by the rules, which today covers everyone — a personal workspace is
 * owned by its user. A shared workspace's non-owner members will need this done
 * server-side; there are none yet.
 *
 * Idempotent and silent on failure: it writes only when the value is missing or
 * stale, and a denial here must never break the dashboard.
 */
export async function backfillMyWorkspaceEmail(workspaceId: string, uid: string, email: string | null): Promise<void> {
  if (!email) return;
  const key = emailKey(email);
  const ref = doc(db, "workspaces", workspaceId, "workspaceMembers", uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data()?.email === key) return;
    await updateDoc(ref, { email: key });
  } catch {
    /* not the owner, or offline — the roster simply keeps showing "waiting" */
  }
}

/** Live workspace membership — the roster reads it to put a real face on a
 * linked person, and to know who a linked email resolved to. */
export function subscribeWorkspaceMembers(
  workspaceId: string,
  cb: (rows: WorkspaceMember[]) => void,
  onError?: (message: string) => void,
): () => void {
  return onSnapshot(
    collection(db, "workspaces", workspaceId, "workspaceMembers"),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as WorkspaceMember)),
    (err) => onError?.(err.message),
  );
}

/** Self-sync the caller's avatar onto their own workspace membership, so other
 * members can render it. Exactly what `syncMyMemberPhoto` does for a Pulse, and
 * allowed by the same shape of rule: a member may write their own doc as long as
 * identity and access fields are unchanged.
 *
 * Writes only on a real difference, so it converges rather than looping. */
export async function syncMyWorkspacePhoto(workspaceId: string, uid: string, photoURL: string | null): Promise<void> {
  const ref = doc(db, "workspaces", workspaceId, "workspaceMembers", uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists() || (snap.data()?.photoURL ?? null) === photoURL) return;
    await updateDoc(ref, { photoURL });
  } catch {
    /* not permitted, or offline — the roster falls back to initials */
  }
}

/** Replace the org's managed role list (RM22). Owner-only by the rules.
 *
 * Renaming a role rewrites it on every roster entry that used it — the same
 * cascade a Pulse already does for its `resourceTypes`, and for the same reason:
 * a rename that leaves the old string behind on the people who had it is not a
 * rename, it is a fork. */
export async function updateResourceRoles(workspaceId: string, resourceRoles: string[]): Promise<void> {
  await updateDoc(doc(db, "workspaces", workspaceId), { resourceRoles });
}

/**
 * The org's cycle templates, once, for the Beat-level "Add from organisation"
 * (Cycles-Spec CY1).
 *
 * A one-shot read, not a subscription: these are templates copied at the moment
 * they are chosen, so a live view of them would suggest a link that CY1
 * deliberately does not create.
 *
 * **A permission error resolves to an empty list, on purpose.** Beat membership
 * is independent of workspace membership (RM1), so an invited collaborator
 * editing a Beat's cycles is very often not a member of the org that owns it
 * and the rules refuse them this document. For them "your organisation has no
 * templates" is the truth — there is no organisation they can see. This is the
 * documented exception to the rule in CLAUDE.md that a refused read must reach
 * the screen as a fault; it is the same call `rates` makes, where the refusal
 * *is* the mechanism.
 */
export async function getWorkspaceCycles(workspaceId: string): Promise<Cycle[]> {
  try {
    const snap = await getDoc(doc(db, "workspaces", workspaceId));
    return (snap.data()?.cycles as Cycle[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/** Replace the org's cycle templates (Cycles-Spec CY1). Owner-only by the rules,
 * which already allow an owner any non-counter field on the workspace doc.
 *
 * Unlike `updateResourceRoles` above, this cascades to **nothing**. Org cycles
 * are templates copied into a Beat at the moment they are chosen (CY1), so a
 * Beat that took one holds its own copy and renaming the template here must not
 * relabel a historical task in twenty Beats. That is the whole reason CY1 chose
 * copy over reference. */
export async function updateWorkspaceCycles(workspaceId: string, cycles: Cycle[]): Promise<void> {
  await updateDoc(doc(db, "workspaces", workspaceId), { cycles });
}
