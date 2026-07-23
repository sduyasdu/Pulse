import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Notification } from "@/types";

/** Live subscription to the current user's notifications in a Pulse. Sorted
 * client-side (newest first) so no composite index is needed. */
export function subscribeMyNotifications(pulseId: string, uid: string, cb: (n: Notification[]) => void): () => void {
  const q = query(collection(db, "pulses", pulseId, "notifications"), where("targetUid", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Notification), id: d.id }));
      list.sort((a, b) => b.createdAt - a.createdAt);
      cb(list);
    },
    () => cb([]),
  );
}

export async function createNotification(pulseId: string, n: Omit<Notification, "id">): Promise<void> {
  await setDoc(doc(collection(db, "pulses", pulseId, "notifications")), n).catch(() => {});
}

export async function markNotificationRead(pulseId: string, id: string): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "notifications", id), { read: true }).catch(() => {});
}

export async function deleteNotification(pulseId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "notifications", id)).catch(() => {});
}
