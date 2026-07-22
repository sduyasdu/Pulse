import {
  collection,
  deleteDoc,
  doc,
  type DocumentReference,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MyPulseIndexEntry, Pulse, PulseMember, PulseRole } from "@/types";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import { stripUndefined } from "./patch";

/**
 * Creates a Pulse and grants the creator 'owner'. These are three
 * SEQUENTIAL writes, not a writeBatch — see createPersonalWorkspace()'s
 * doc comment for why: the pulseMembers.create rule's `get()` on the pulse
 * doc (to check `createdBy`) can't see a same-batch, not-yet-committed
 * write, so batching this together gets denied outright.
 */
export async function createPulse(uid: string, workspaceId: string, name: string): Promise<string> {
  const pulseRef = doc(collection(db, "pulses"));
  const pulse: Pulse = {
    id: pulseRef.id,
    workspaceId,
    name,
    createdBy: uid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    graphConfig: DEFAULT_GRAPH_CONFIG,
    resourceTypes: [],
  };
  await setDoc(pulseRef, pulse);

  const member: PulseMember = { uid, email: "", role: "owner", joinedAt: Date.now() };
  await setDoc(doc(db, "pulses", pulseRef.id, "pulseMembers", uid), member);

  const indexEntry: MyPulseIndexEntry = {
    pulseId: pulseRef.id,
    name,
    workspaceId,
    role: "owner",
    joinedAt: Date.now(),
  };
  await setDoc(doc(db, "users", uid, "myPulses", pulseRef.id), indexEntry);

  return pulseRef.id;
}

export function subscribeMyPulses(uid: string, cb: (entries: MyPulseIndexEntry[]) => void): () => void {
  const q = query(collection(db, "users", uid, "myPulses"), orderBy("joinedAt", "desc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as MyPulseIndexEntry)));
}

export async function getPulse(pulseId: string): Promise<Pulse | null> {
  const snap = await getDoc(doc(db, "pulses", pulseId));
  return snap.exists() ? (snap.data() as Pulse) : null;
}

/** Self-heal: drop a stale dashboard entry pointing at a Pulse this user
 * can no longer access (deleted, or their membership was revoked) — see
 * deletePulse()'s doc comment for why other members' entries aren't
 * cleaned up at delete time. */
export async function removeMyPulseEntry(uid: string, pulseId: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid, "myPulses", pulseId)).catch(() => {});
}

/** Per-user archive toggle. Archiving lives on the user's own myPulses index
 * entry (which only they can write), so it hides the Pulse from their
 * dashboard's main sections without touching the shared Pulse or anyone else's
 * view — and keeps all the data intact, unlike delete. */
export async function setMyPulseArchived(uid: string, pulseId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(db, "users", uid, "myPulses", pulseId), { archived });
}

/** Self-heal: an owner may have changed this user's role (in the authoritative
 * pulseMembers doc) but can't touch this user's own dashboard index entry —
 * so the client reconciles the cached role label itself. Self-write only. */
export async function updateMyPulseRole(uid: string, pulseId: string, role: PulseRole): Promise<void> {
  await updateDoc(doc(db, "users", uid, "myPulses", pulseId), { role }).catch(() => {});
}

export function subscribePulse(pulseId: string, cb: (pulse: Pulse | null) => void): () => void {
  return onSnapshot(doc(db, "pulses", pulseId), (snap) => cb(snap.exists() ? (snap.data() as Pulse) : null));
}

export async function renamePulse(pulseId: string, name: string): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId), { name, updatedAt: Date.now() });
}

export async function updateGraphConfig(pulseId: string, graphConfig: Pulse["graphConfig"]): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId), { graphConfig, updatedAt: Date.now() });
}

export async function updateResourceTypes(pulseId: string, resourceTypes: string[]): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId), { resourceTypes, updatedAt: Date.now() });
}

/** Generic field-level patch of the Pulse doc — used by the undo/redo engine
 * to restore prior values of pulse-level fields (name/graphConfig/
 * resourceTypes). Always bumps updatedAt so the change propagates. */
export async function patchPulse(pulseId: string, patch: Partial<Pulse>): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId), { ...stripUndefined(patch), updatedAt: Date.now() });
}

/** Deletes a Pulse and every doc in its subcollections. Firestore doesn't
 * cascade-delete subcollections on its own, and leaving them behind would
 * mean former members could still read epics/features/resources directly
 * by path (their pulseMembers doc — the thing the read rules actually
 * check — would still exist). Other members' own `users/{uid}/myPulses`
 * entries are NOT cleaned up here (this user's write permissions don't
 * extend to another user's index); the dashboard self-heals those by
 * dropping any entry whose Pulse fails to load. */
export async function deletePulse(pulseId: string, uid: string): Promise<void> {
  // pulseMembers must be deleted LAST: every other subcollection's write
  // rule (canEditPulse) and the pulse doc's own delete rule (isPulseOwner)
  // both check the caller's own pulseMembers doc — delete that first and
  // every subsequent step in this function would deny itself.
  const subcollections = ["invites", "epics", "features", "resources"];
  for (const name of subcollections) {
    const snap = await getDocs(collection(db, "pulses", pulseId, name));
    await deleteInChunks(snap.docs.map((d) => d.ref));
  }
  await deleteDoc(doc(db, "pulses", pulseId));

  const membersSnap = await getDocs(collection(db, "pulses", pulseId, "pulseMembers"));
  await deleteInChunks(membersSnap.docs.map((d) => d.ref));

  await deleteDoc(doc(db, "users", uid, "myPulses", pulseId)).catch(() => {});
}

async function deleteInChunks(refs: DocumentReference[]): Promise<void> {
  const CHUNK = 450; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + CHUNK)) batch.delete(ref);
    await batch.commit();
  }
}
