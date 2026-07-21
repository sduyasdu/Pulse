import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Feature } from "@/types";
import { stripUndefined } from "./patch";

export function newFeatureId(pulseId: string): string {
  return doc(collection(db, "pulses", pulseId, "features")).id;
}

export function subscribeFeatures(pulseId: string, cb: (features: Feature[]) => void): () => void {
  return onSnapshot(collection(db, "pulses", pulseId, "features"), (snap) =>
    cb(snap.docs.map((d) => d.data() as Feature)),
  );
}

/** One-shot read — for the dashboard's card thumbnails, where a live
 * listener per card would be wasted (the cards aren't interactive). */
export async function fetchFeatures(pulseId: string): Promise<Feature[]> {
  const snap = await getDocs(collection(db, "pulses", pulseId, "features"));
  return snap.docs.map((d) => d.data() as Feature);
}

export async function createFeature(pulseId: string, feature: Feature): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "features", feature.id), feature);
}

/** Whole-document patch (subtasks/attachments/alloc are embedded arrays and
 * maps, not subcollections — the prototype's shape, kept as-is). */
export async function updateFeature(pulseId: string, featureId: string, patch: Partial<Feature>): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "features", featureId), stripUndefined(patch));
}

export async function deleteFeature(pulseId: string, featureId: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "features", featureId));
}
