import { collection, deleteDoc, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PulseMember, PulseRole } from "@/types";

export function subscribePulseMembers(pulseId: string, cb: (members: PulseMember[]) => void): () => void {
  return onSnapshot(collection(db, "pulses", pulseId, "pulseMembers"), (snap) =>
    cb(snap.docs.map((d) => d.data() as PulseMember)),
  );
}

/** Reads the caller's own membership doc for a Pulse. A user may always read
 * their *own* pulseMembers doc (firestore.rules: `memberUid == request.auth.uid`),
 * even after being removed or if the Pulse was deleted, so this is a reliable
 * "am I still a member?" check the dashboard uses to prune stale index entries.
 * Returns null when the doc doesn't exist (removed / deleted Pulse). */
export async function fetchMembership(pulseId: string, uid: string): Promise<PulseMember | null> {
  const snap = await getDoc(doc(db, "pulses", pulseId, "pulseMembers", uid));
  return snap.exists() ? (snap.data() as PulseMember) : null;
}

/** Owner-only (enforced by firestore.rules). */
export async function setMemberRole(pulseId: string, uid: string, role: PulseRole): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), { role });
}

/** Owner-only (enforced by firestore.rules). */
export async function removeMember(pulseId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "pulseMembers", uid));
}
