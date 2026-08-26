import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Can we actually reach Firestore right now?
 *
 * `navigator.onLine` answers a different and weaker question — "is there a
 * network interface" — so it is `true` on a café WiFi that never got past the
 * captive portal, on a router with no upstream, and on a VPN that has dropped.
 * Those are the cases people mean by "the wifi isn't working", and the browser
 * reports every one of them as online.
 *
 * Firestore knows the truth because it is the thing trying to connect: once the
 * SDK loses its channel it serves snapshots with `metadata.fromCache === true`.
 * `includeMetadataChanges` is what makes that observable promptly — without it
 * a snapshot only arrives when the *data* changes, so a connection lost while
 * nothing is happening would go unnoticed until the next edit.
 *
 * The probe is the caller's own user document: one doc, always readable by its
 * owner (`firestore.rules`, `users/{uid}`), already tiny. After the first read
 * the metadata events are local, so this costs one read per session rather than
 * a poll.
 */
export function subscribeServerReachable(uid: string, cb: (reachable: boolean) => void): () => void {
  return onSnapshot(
    doc(db, "users", uid),
    { includeMetadataChanges: true },
    (snap) => cb(!snap.metadata.fromCache),
    // A refused probe says nothing about the network, so don't report it as
    // unreachable — that would put an offline banner in front of someone whose
    // connection is fine. The read-failure paths elsewhere cover real denials.
    () => {},
  );
}
