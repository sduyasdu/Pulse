import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PulseMember, PulseRole } from "@/types";
import { capsForRole } from "@/domain/permissions";

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

/** Self-sync the caller's denormalized avatar onto their own membership doc so
 * other members can render it (e.g. on a linked resource). Allowed by the
 * pulseMembers update rule for `memberUid == request.auth.uid`. */
export async function syncMyMemberPhoto(pulseId: string, uid: string, photoURL: string | null): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), { photoURL }).catch(() => {});
}

/** Owner-only (enforced by firestore.rules). Materializes the role's capability
 * bundle alongside the role (Permissions-Spec §4.1) so it's ready for rules
 * enforcement; the caps are inert until that phase lands. */
export async function setMemberRole(pulseId: string, uid: string, role: PulseRole): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "pulseMembers", uid), { role, caps: capsForRole(role) });
}

/** Owner-only (enforced by firestore.rules). */
export async function removeMember(pulseId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "pulseMembers", uid));
}

/** How many members a Pulse has. One read, made only when an archive
 * confirmation needs to name the consequence ("read-only for all N members" —
 * Hide-and-Archive-Spec §5.4); the dashboard has no members listener, and adding
 * one per card to support a rare click would be far more expensive. */
export async function countPulseMembers(pulseId: string): Promise<number> {
  const snap = await getDocs(collection(db, "pulses", pulseId, "pulseMembers"));
  return snap.size;
}

/** Leave a Pulse: the caller removes their OWN membership (allowed by the
 * pulseMembers delete rule for `memberUid == request.auth.uid`) and their own
 * dashboard index entry. */
export async function leavePulse(pulseId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "pulseMembers", uid));
  await deleteDoc(doc(db, "users", uid, "myPulses", pulseId)).catch(() => {});
}
