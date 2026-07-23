import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Comment } from "@/types";

function col(pulseId: string, featureId: string) {
  return collection(db, "pulses", pulseId, "features", featureId, "comments");
}

export function subscribeComments(pulseId: string, featureId: string, cb: (comments: Comment[]) => void): () => void {
  return onSnapshot(query(col(pulseId, featureId), orderBy("createdAt", "asc")), (snap) =>
    cb(snap.docs.map((d) => ({ ...(d.data() as Comment), id: d.id }))),
  );
}

export async function addComment(pulseId: string, featureId: string, authorUid: string, authorEmail: string, text: string): Promise<void> {
  const ref = doc(col(pulseId, featureId));
  await setDoc(ref, { authorUid, authorEmail, text, createdAt: Date.now() });
}

export async function editComment(pulseId: string, featureId: string, commentId: string, text: string): Promise<void> {
  await updateDoc(doc(col(pulseId, featureId), commentId), { text, editedAt: Date.now() });
}

export async function deleteComment(pulseId: string, featureId: string, commentId: string): Promise<void> {
  await deleteDoc(doc(col(pulseId, featureId), commentId));
}
