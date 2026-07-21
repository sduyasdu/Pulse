import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Epic } from "@/types";
import { stripUndefined } from "./patch";

export function newEpicId(pulseId: string): string {
  return doc(collection(db, "pulses", pulseId, "epics")).id;
}

export function subscribeEpics(pulseId: string, cb: (epics: Epic[]) => void): () => void {
  return onSnapshot(collection(db, "pulses", pulseId, "epics"), (snap) => cb(snap.docs.map((d) => d.data() as Epic)));
}

/** One-shot read — see fetchFeatures() for why the dashboard doesn't
 * subscribe. */
export async function fetchEpics(pulseId: string): Promise<Epic[]> {
  const snap = await getDocs(collection(db, "pulses", pulseId, "epics"));
  return snap.docs.map((d) => d.data() as Epic);
}

export async function createEpic(pulseId: string, epic: Epic): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "epics", epic.id), epic);
}

export async function updateEpic(pulseId: string, epicId: string, patch: Partial<Epic>): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "epics", epicId), stripUndefined(patch));
}

export async function deleteEpic(pulseId: string, epicId: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "epics", epicId));
}
