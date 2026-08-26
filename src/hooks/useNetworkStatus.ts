import { useEffect, useState } from "react";
import { subscribeServerReachable } from "@/services/firestore/reachability";

/**
 * - `online` — the browser has a network *and* Firestore is answering.
 * - `offline` — the device reports no network at all.
 * - `unreachable` — there is a network, but Firestore can't be reached. The
 *   captive portal, the dead upstream, the dropped VPN. This is the state
 *   `navigator.onLine` alone cannot see, and the one people describe as "the
 *   wifi is connected but nothing works".
 */
export type NetworkStatus = "online" | "offline" | "unreachable";

/**
 * Pure state machine, so the precedence is testable and stated once.
 *
 * `offline` outranks `unreachable` because it is the more specific fact and the
 * one with the simpler instruction. `reachable === null` means the probe has
 * not reported yet: treated as fine, because a banner that flashes on every
 * page load while the first snapshot lands would train people to ignore it.
 */
export function networkStatusOf(online: boolean, reachable: boolean | null): NetworkStatus {
  if (!online) return "offline";
  if (reachable === false) return "unreachable";
  return "online";
}

/** Live connection status. `uid` enables the Firestore probe; without one only
 * the browser's coarse signal is available. */
export function useNetworkStatus(uid?: string | null): NetworkStatus {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // Re-read on mount: the events only fire on transitions, so a tab opened
    // while already offline would otherwise start out claiming to be online.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (!uid) {
      setReachable(null);
      return;
    }
    return subscribeServerReachable(uid, setReachable);
  }, [uid]);

  return networkStatusOf(online, reachable);
}
