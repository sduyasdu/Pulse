import { collection, doc, getDocs, limit as qLimit, onSnapshot, orderBy, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ActivityEntry } from "@/types";
import { stripUndefined } from "./patch";

// Client interim for the per-Pulse activity log (Changelog-Spec.md §4.4;
// server-authoritative later — Server-Functions-Spec SF4). The client that made
// a change appends one immutable entry at the same logical-action boundary the
// undo engine records at. Rules pin `actorUid` to the caller and make entries
// append-only.

export function newActivityId(pulseId: string): string {
  return doc(collection(db, "pulses", pulseId, "activity")).id;
}

/** When anything last changed in a Pulse, or null if nothing ever has.
 *
 * One ordered document — deliberately not a `lastActivityAt` denormalized onto
 * the Pulse doc, which would cost a write on every task edit and turn that
 * document into a contention point for everyone working in the Pulse, to serve
 * a field only the dashboard and the MCP read.
 *
 * Returns null on a read failure too: a My-Beat Viewer's unconstrained read of
 * this collection is refused by the rules, and "unknown" is the honest answer
 * there rather than an error the card cannot act on. */
export async function fetchLatestActivityAt(pulseId: string): Promise<number | null> {
  try {
    const snap = await getDocs(query(collection(db, "pulses", pulseId, "activity"), orderBy("at", "desc"), qLimit(1)));
    const at = snap.docs[0]?.data()?.at;
    return typeof at === "number" ? at : null;
  } catch {
    return null;
  }
}

/** Append one entry. Create-only: never updated or deleted (rules enforce it).
 * A dropped write silently loses a single entry (the log gates nothing, so it
 * fails open — SF4 closes this). */
export async function logActivity(pulseId: string, entry: ActivityEntry): Promise<void> {
  await setDoc(doc(db, "pulses", pulseId, "activity", entry.id), stripUndefined(entry as unknown as Record<string, unknown>));
}

/**
 * Live activity feed, newest first. Full readers get the whole log; pass
 * `beatUid` for a My-Beat Viewer — the rules require the scoped `array-contains`
 * query (only feature entries carrying their uid in `scopeUids`), and an
 * unconstrained read would be rejected wholesale (Changelog-Spec §4.3, §5.2).
 */
export function subscribeActivity(
  pulseId: string,
  cb: (entries: ActivityEntry[]) => void,
  opts?: { beatUid?: string; max?: number },
): () => void {
  const base = collection(db, "pulses", pulseId, "activity");
  const max = opts?.max ?? 200;
  const q = opts?.beatUid
    ? query(base, where("scopeUids", "array-contains", opts.beatUid), orderBy("at", "desc"), qLimit(max))
    : query(base, orderBy("at", "desc"), qLimit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as ActivityEntry)), () => cb([]));
}

/**
 * Live activity for a single feature — the inline "history" on a task's Details.
 * A My-Beat Viewer must add the `scopeUids` array-contains constraint (the read
 * rule can't otherwise prove every matching entry is theirs to see), so pass
 * their uid as `beatUid` exactly as with {@link subscribeActivity}.
 */
export function subscribeFeatureActivity(
  pulseId: string,
  featureId: string,
  cb: (entries: ActivityEntry[]) => void,
  opts?: { beatUid?: string; max?: number },
): () => void {
  const base = collection(db, "pulses", pulseId, "activity");
  const max = opts?.max ?? 50;
  const q = opts?.beatUid
    ? query(base, where("entityId", "==", featureId), where("scopeUids", "array-contains", opts.beatUid), orderBy("at", "desc"), qLimit(max))
    : query(base, where("entityId", "==", featureId), orderBy("at", "desc"), qLimit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as ActivityEntry)), () => cb([]));
}
