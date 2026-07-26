import { collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { CostEntry } from "@/types";
import { stripUndefined } from "./patch";

export function newCostId(pulseId: string): string {
  return doc(collection(db, "pulses", pulseId, "costs")).id;
}

/** One-shot read, for surfaces that don't need a live listener. Returns [] on a
 * rejected read (a My-Beat Viewer can't run the unconstrained list). */
export async function fetchCosts(pulseId: string): Promise<CostEntry[]> {
  try {
    const snap = await getDocs(collection(db, "pulses", pulseId, "costs"));
    return snap.docs.map((d) => d.data() as CostEntry);
  } catch {
    return [];
  }
}

/**
 * Live costs. Full readers get the whole collection; pass `beatUid` for a
 * My-Beat Viewer — costs carry the same `scopeUids` denorm features carry in
 * `assignedUids`, and the rules likewise require the scoped `array-contains`
 * query (Costs-Spec §7, Permissions-Spec §4.3).
 */
export function subscribeCosts(pulseId: string, cb: (costs: CostEntry[]) => void, beatUid?: string): () => void {
  const base = collection(db, "pulses", pulseId, "costs");
  const q = beatUid ? query(base, where("scopeUids", "array-contains", beatUid)) : base;
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as CostEntry)), () => cb([]));
}

export async function createCost(pulseId: string, cost: CostEntry): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "costs", cost.id), stripUndefined(cost as unknown as Record<string, unknown>));
}

export async function updateCost(pulseId: string, costId: string, patch: Partial<CostEntry>): Promise<void> {
  await updateDoc(doc(db, "pulses", pulseId, "costs", costId), stripUndefined(patch));
}

export async function deleteCost(pulseId: string, costId: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "costs", costId));
}
