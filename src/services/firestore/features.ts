import { collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Feature } from "@/types";
import { stripUndefined } from "./patch";

export function newFeatureId(pulseId: string): string {
  return doc(collection(db, "pulses", pulseId, "features")).id;
}

/**
 * Live features. Full readers get the whole collection; pass `beatUid` for a
 * My-Beat Viewer — the rules require the scoped `array-contains` query, and an
 * unconstrained read would be rejected wholesale (Permissions-Spec §4.3).
 */
export function subscribeFeatures(pulseId: string, cb: (features: Feature[]) => void, beatUid?: string): () => void {
  const base = collection(db, "pulses", pulseId, "features");
  const q = beatUid ? query(base, where("assignedUids", "array-contains", beatUid)) : base;
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as Feature)), () => cb([]));
}

/** One-shot read — for the dashboard's card thumbnails, where a live
 * listener per card would be wasted (the cards aren't interactive). Returns []
 * on a rejected read (a My-Beat Viewer can't run the unconstrained list — their
 * card just shows no task thumbnail rather than failing the whole summary). */
export async function fetchFeatures(pulseId: string): Promise<Feature[]> {
  try {
    const snap = await getDocs(collection(db, "pulses", pulseId, "features"));
    return snap.docs.map((d) => d.data() as Feature);
  } catch {
    return [];
  }
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
