import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Resource } from "@/types";
import { stripUndefined } from "./patch";

export function newResourceId(pulseId: string): string {
  return doc(collection(db, "pulses", pulseId, "resources")).id;
}

export function subscribeResources(pulseId: string, cb: (resources: Resource[]) => void): () => void {
  return onSnapshot(collection(db, "pulses", pulseId, "resources"), (snap) =>
    cb(snap.docs.map((d) => d.data() as Resource)),
  );
}

export async function createResource(pulseId: string, resource: Resource): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "resources", resource.id), resource);
}

export async function updateResource(pulseId: string, resourceId: string, patch: Partial<Resource>): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "resources", resourceId), stripUndefined(patch));
}

export async function deleteResource(pulseId: string, resourceId: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "resources", resourceId));
}

/** 2-3 letter initials, de-duplicated against the current roster — matches
 * the prototype's makeInitials(), but the returned value is only ever used
 * as a *display* field now (see Resource.initials doc comment in types). */
export function makeInitials(name: string, existing: Resource[]): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const base = (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
  let candidate = base;
  let n = 1;
  while (existing.some((r) => r.initials === candidate)) {
    candidate = base + n;
    n++;
  }
  return candidate;
}
