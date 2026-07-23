import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PresenceEntry } from "@/types";

export function subscribePresence(pulseId: string, cb: (entries: PresenceEntry[]) => void): () => void {
  return onSnapshot(collection(db, "pulses", pulseId, "presence"), (snap) =>
    cb(snap.docs.map((d) => d.data() as PresenceEntry)),
  );
}

/** Write/refresh the caller's own presence heartbeat. Self-write only. */
export async function heartbeatPresence(pulseId: string, uid: string, email: string): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "presence", uid), { uid, email, lastSeen: Date.now() } satisfies PresenceEntry).catch(() => {});
}

export async function clearPresence(pulseId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "presence", uid)).catch(() => {});
}
