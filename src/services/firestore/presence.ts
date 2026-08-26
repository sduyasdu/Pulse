import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PresenceEntry } from "@/types";

/**
 * Who else is looking at this Pulse right now.
 *
 * Deliberately has no error path, unlike every other live read in this folder
 * (see `subscriptionErrors.test.ts`). Presence is ephemeral and decorative: the
 * entries expire on their own, a dropped listener re-attaches on reconnect, and
 * an empty presence bar claims only that nobody else is here — which is both
 * the common case and harmless to get briefly wrong. Nothing is hidden by it
 * and there is nothing for the user to do about it, so a banner would be noise.
 *
 * That is a judgement about presence, not a licence to copy: for anything a
 * user could mistake for their own missing data, take the `onError` route.
 */
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
