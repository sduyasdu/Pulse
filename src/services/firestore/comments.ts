import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Comment } from "@/types";

function col(pulseId: string) {
  return collection(db, "pulses", pulseId, "comments");
}
const byTime = (a: Comment, b: Comment) => a.createdAt - b.createdAt;
const map = (docs: { id: string; data: () => unknown }[]) => docs.map((d) => ({ ...(d.data() as Comment), id: d.id })).sort(byTime);

/** All comments in the Pulse (for the grouped Comments tab). */
export function subscribeAllComments(pulseId: string, cb: (comments: Comment[]) => void): () => void {
  return onSnapshot(col(pulseId), (snap) => cb(map(snap.docs)), () => cb([]));
}

/** Comments for one target (a task id, or null for Pulse-level). */
export function subscribeCommentsFor(pulseId: string, targetId: string | null, cb: (comments: Comment[]) => void): () => void {
  return onSnapshot(query(col(pulseId), where("targetId", "==", targetId)), (snap) => cb(map(snap.docs)), () => cb([]));
}

export async function addComment(pulseId: string, targetId: string | null, parentId: string | null, authorUid: string, authorEmail: string, text: string): Promise<void> {
  await setDoc(doc(col(pulseId)), { targetId, parentId, authorUid, authorEmail, text, createdAt: Date.now() });
}

export async function editComment(pulseId: string, id: string, text: string): Promise<void> {
  await updateDoc(doc(col(pulseId), id), { text, editedAt: Date.now() });
}

export async function deleteComment(pulseId: string, id: string): Promise<void> {
  await deleteDoc(doc(col(pulseId), id));
}
