import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BillingDoc } from "@/types";

// Read-only access to the plan doc `billing/{workspaceId}` (Plans-Spec §4). The
// client NEVER writes it — the tier is set only by the Stripe webhook (SF3).
// Readable only by the org's admins (workspace owners) per firestore.rules; a
// rejected read resolves to `null` (⇒ Free via domain/entitlements).

export function subscribeBilling(workspaceId: string, cb: (billing: BillingDoc | null) => void): () => void {
  return onSnapshot(
    doc(db, "billing", workspaceId),
    (snap) => cb(snap.exists() ? (snap.data() as BillingDoc) : null),
    () => cb(null), // permission-denied / offline → treat as no plan (Free)
  );
}

export async function fetchBilling(workspaceId: string): Promise<BillingDoc | null> {
  try {
    const snap = await getDoc(doc(db, "billing", workspaceId));
    return snap.exists() ? (snap.data() as BillingDoc) : null;
  } catch {
    return null;
  }
}
