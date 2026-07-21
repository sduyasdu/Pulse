import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MyPulseIndexEntry, PendingInviteEntry, PulseMember, UserDoc } from "@/types";
import { createPersonalWorkspace } from "./workspaces";
import { emailKey } from "./emailKey";

/** Idempotent: creates users/{uid} + a personal workspace the first time a
 * user signs in; a no-op on every subsequent sign-in. */
export async function ensureUserDoc(uid: string, email: string, displayName: string | null, photoURL: string | null): Promise<void> {
  const userRef = doc(db, "users", uid);
  const existing = await getDoc(userRef);
  if (existing.exists()) return;

  const personalWorkspaceId = await createPersonalWorkspace(uid, displayName);
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
  const pendingSnap = await getDocs(collection(db, "inviteIndex", key, "pending"));
  if (pendingSnap.empty) return 0;

  let resolved = 0;
  for (const pendingDoc of pendingSnap.docs) {
    const pulseId = pendingDoc.id;
    const pending = pendingDoc.data() as PendingInviteEntry;
    try {
      const member: PulseMember = { uid, email: key, role: pending.role, joinedAt: Date.now() };
      await setDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), member);

      const pulseSnap = await getDoc(doc(db, "pulses", pulseId));
      const pulseName = pulseSnap.exists() ? (pulseSnap.data().name as string) : "Untitled Pulse";
      const pulseWorkspaceId = pulseSnap.exists() ? (pulseSnap.data().workspaceId as string) : "";
      const indexEntry: MyPulseIndexEntry = {
        pulseId,
        name: pulseName,
        workspaceId: pulseWorkspaceId,
        role: pending.role,
        joinedAt: Date.now(),
      };
      await setDoc(doc(db, "users", uid, "myPulses", pulseId), indexEntry);

      const cleanup = writeBatch(db);
      cleanup.delete(doc(db, "pulses", pulseId, "invites", key));
      cleanup.delete(doc(db, "inviteIndex", key, "pending", pulseId));
      await cleanup.commit();

      resolved++;
    } catch {
      // The authoritative invite doc may have been revoked between listing
      // the index and accepting it — skip and leave the stale pointer for
      // the user to clean up (or a future run) rather than failing the
      // whole batch of invites.
      await deleteDoc(doc(db, "inviteIndex", key, "pending", pulseId)).catch(() => {});
    }
  }
  return resolved;
}
