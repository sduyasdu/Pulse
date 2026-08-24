import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { McpConnection, PendingInviteEntry, UserDoc } from "@/types";

/** Update the signed-in user's own profile fields (name / avatar / language).
 * `language: null` clears the stored override (revert to browser detection). */
export async function updateUserProfile(uid: string, patch: { displayName?: string | null; photoURL?: string | null; language?: string | null }): Promise<void> {
  await updateDoc(doc(db, "users", uid), patch);
}
import { createPersonalWorkspace } from "./workspaces";
import { emailKey } from "./emailKey";
import { acceptInvite } from "./invites";

/** Idempotent: creates users/{uid} + a personal workspace the first time a
 * user signs in; a no-op on every subsequent sign-in. */
export async function ensureUserDoc(uid: string, email: string, displayName: string | null, photoURL: string | null): Promise<void> {
  const userRef = doc(db, "users", uid);
  const existing = await getDoc(userRef);
  if (existing.exists()) return;

  const personalWorkspaceId = await createPersonalWorkspace(uid, displayName, email);
  const user: UserDoc = {
    uid,
    email,
    displayName,
    photoURL,
    personalWorkspaceId,
    createdAt: Date.now(),
  };
  await setDoc(userRef, user);
}

/**
 * Resolves every pending invite addressed to `email` into real Pulse
 * membership. Safe to call on every sign-in / dashboard load — it's a
 * no-op once the pending list is empty. See firestore.rules for why this
 * reads from `inviteIndex/{email}/pending` instead of a collection-group
 * query, and why the pulseMembers write is independently re-validated
 * against the authoritative `pulses/{pulseId}/invites/{email}` doc
 * regardless of what this client-side code claims.
 */
export async function resolvePendingInvites(uid: string, email: string): Promise<number> {
  const key = emailKey(email);

  // Denied, not empty — and here that distinction is already resolved rather
  // than lost: reading this index needs a confirmed address, so a refusal means
  // exactly one thing and the caller knows it from `emailVerified` without
  // being told. What must not happen is the throw escaping: this runs inside
  // sign-in bootstrap, so an uncaught denial would leave every unconfirmed
  // account — including one that registered thirty seconds ago — staring at an
  // error instead of the app, over an optional sweep for invitations they may
  // not even have. `UnverifiedBanner` is what surfaces the state.
  let pendingSnap;
  try {
    pendingSnap = await getDocs(collection(db, "inviteIndex", key, "pending"));
  } catch {
    return 0;
  }
  if (pendingSnap.empty) return 0;

  let resolved = 0;
  for (const pendingDoc of pendingSnap.docs) {
    const pulseId = pendingDoc.id;
    const pending = pendingDoc.data() as PendingInviteEntry;
    try {
      await acceptInvite(pulseId, uid, key, pending.role);
      resolved++;
    } catch {
      // Leave the pointer. It used to be deleted here, which the comment above
      // it already said it should not be — and the two disagreed silently
      // because every failure looked alike.
      //
      // They are not alike. A revoked invite and a REFUSED one fail the same
      // way from here, and refusals are now routine: accepting an emailed invite
      // requires a confirmed address, so anyone who has not confirmed theirs
      // fails this write every time they sign in. Deleting on failure would
      // destroy a valid invitation because its recipient had not clicked a link
      // yet — and the invite link is the route that then can't work either.
      //
      // The cost of keeping it is one failed write per sign-in for a genuinely
      // revoked invite. The cost of removing it was losing invitations.
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// MCP connections (MCP-Spec §3) — AI assistants the user has connected.
//
// Read-only from the client except for revoking. The OAuth flow creates them
// server-side and the MCP service maintains `lastUsedAt`; rules reject any
// client write other than setting `revokedAt`, because a client that could edit
// `scope` could widen its own assistant's access.
// ---------------------------------------------------------------------------

/** Live list of the user's connected assistants, newest first.
 *
 * `onError` is not optional politeness. Collapsing a failed read into an empty
 * list makes "nothing is connected" and "I cannot read this" identical on
 * screen — which is exactly how an undeployed rules change hid itself here: the
 * list was denied, rendered as empty, and looked like a working feature with no
 * data. */
export function subscribeMcpConnections(
  uid: string,
  cb: (rows: McpConnection[]) => void,
  onError?: (message: string) => void,
): () => void {
  return onSnapshot(
    collection(db, "users", uid, "connections"),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as McpConnection);
      rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      cb(rows);
    },
    (err) => onError?.(err.message),
  );
}

/** Revoke. The connection is kept rather than deleted, so the list can show it
 * was revoked rather than silently losing it — and the MCP service refuses the
 * next request and every refresh after it (§2.1). */
export async function revokeMcpConnection(uid: string, connectionId: string): Promise<void> {
  await updateDoc(doc(db, "users", uid, "connections", connectionId), { revokedAt: Date.now() });
}

/** Clear a revoked connection off the list.
 *
 * Only ever called for a connection that is already revoked — the rules enforce
 * that too, because deleting a live one would work as a partial disconnect and
 * take the record of it away at the same time. This is tidying, not an off
 * switch, and the UI only offers it once the off switch has been used. */
export async function deleteMcpConnection(uid: string, connectionId: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid, "connections", connectionId));
}
