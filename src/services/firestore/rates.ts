import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ResourceRate } from "@/types";

/**
 * Hourly rates, at pulses/{pulseId}/rates/{resourceId} — Costs-Spec §8.3.
 *
 * A separate collection rather than a field on `Resource`, because Firestore
 * security is per document and the resource doc has to stay member-readable.
 * These documents are admin-only in firestore.rules, so a non-admin's listener is
 * rejected — which is why `subscribeRates` reports an empty set on error instead of
 * throwing: their client then derives no labour cost at all (§8.7).
 */
export function subscribeRates(pulseId: string, cb: (rates: ResourceRate[]) => void): () => void {
  return onSnapshot(
    collection(db, "pulses", pulseId, "rates"),
    (snap) => cb(snap.docs.map((d) => d.data() as ResourceRate)),
    () => cb([]),
  );
}

export async function setResourceRate(pulseId: string, rate: ResourceRate): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "rates", rate.resourceId), rate);
}

export async function deleteResourceRate(pulseId: string, resourceId: string): Promise<void> {
  await deleteDoc(doc(db, "pulses", pulseId, "rates", resourceId));
}
