import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * How long the probe must stay cache-served before we call it unreachable.
 *
 * Not cosmetic damping. With `persistentLocalCache` the *first* snapshot of any
 * document is served from disk, with `fromCache === true`, while the SDK is
 * still opening its channel — so a bare read of that flag reports "unreachable"
 * on every single page load, for as long as the connection takes to establish.
 * That is what the status indicator showed on startup, every time, and a status
 * that is wrong at exactly the moment everyone looks at it teaches people to
 * ignore it.
 *
 * A device that is genuinely offline is not made slower by this: `navigator.
 * onLine` reports that immediately and outranks the probe (see
 * `networkStatusOf`). What this delay covers is the case only the probe can
 * see — a network that exists but cannot reach Firestore — where a few seconds
 * of "connected" before the truth lands costs nothing.
 */
export const REACHABILITY_SETTLE_MS = 4000;

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
 *
 * Reaching the server is reported the instant it happens; losing it is reported
 * only after `REACHABILITY_SETTLE_MS` of continuous cache-served snapshots. The
 * asymmetry is deliberate — see that constant.
 */
export function subscribeServerReachable(uid: string, cb: (reachable: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** What we last told the caller, so a run of identical snapshots is quiet. */
  let reported: boolean | null = null;

  const unsub = onSnapshot(
    doc(db, "users", uid),
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.metadata.fromCache) {
        clearTimeout(timer);
        timer = undefined;
        if (reported !== true) {
          reported = true;
          cb(true);
        }
        return;
      }
      // Cache-served. That is either a connection we have lost or one we have
      // not opened yet, and the two are indistinguishable from here — so wait
      // and see rather than guessing.
      if (reported === false || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        reported = false;
        cb(false);
      }, REACHABILITY_SETTLE_MS);
    },
    // A refused probe says nothing about the network, so don't report it as
    // unreachable — that would put an offline indicator in front of someone
    // whose connection is fine. The read-failure paths elsewhere cover real
    // denials.
    () => {},
  );

  return () => {
    clearTimeout(timer);
    unsub();
  };
}
