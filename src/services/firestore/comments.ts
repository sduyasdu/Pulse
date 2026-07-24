import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Comment, CommentRef } from "@/types";

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

export async function addComment(
  pulseId: string,
  targetId: string | null,
  parentId: string | null,
  authorUid: string,
  authorEmail: string,
  text: string,
  opts?: { targetKind?: "task" | "resource"; mentions?: CommentRef[] },
): Promise<void> {
  // Firestore rejects `undefined` field values, so only include the optional
  // fields when they carry information.
  const data: Record<string, unknown> = { targetId, parentId, authorUid, authorEmail, text, createdAt: Date.now() };
  if (targetId && opts?.targetKind === "resource") data.targetKind = "resource";
  if (opts?.mentions && opts.mentions.length > 0) data.mentions = opts.mentions;
  await setDoc(doc(col(pulseId)), data);
}

export async function editComment(pulseId: string, id: string, text: string, mentions?: CommentRef[]): Promise<void> {
  const data: Record<string, unknown> = { text, editedAt: Date.now() };
  // Re-detected on edit; pass [] to clear removed @-mentions.
  if (mentions) data.mentions = mentions;
  await updateDoc(doc(col(pulseId), id), data);
}

export async function deleteComment(pulseId: string, id: string): Promise<void> {
  await deleteDoc(doc(col(pulseId), id));
}
