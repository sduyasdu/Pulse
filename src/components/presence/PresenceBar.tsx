import { useEffect, useState } from "react";
import type { PresenceEntry } from "@/types";
import { subscribePresence, heartbeatPresence, clearPresence } from "@/services/firestore/presence";
import { colorForName } from "@/domain/constants";

const STALE_MS = 45_000;
const BEAT_MS = 25_000;

function initials(email: string): string {
  const local = (email.split("@")[0] || email).replace(/[^a-zA-Z0-9]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

/** Live presence: heartbeats the current user and returns everyone currently
 * viewing (fresh within STALE_MS). */
function usePresence(pulseId: string | undefined, uid: string | undefined, email: string): PresenceEntry[] {
  const [entries, setEntries] = useState<PresenceEntry[]>([]);
  useEffect(() => {
    if (!pulseId || !uid) return;
    void heartbeatPresence(pulseId, uid, email);
    const beat = window.setInterval(() => {
      if (!document.hidden) void heartbeatPresence(pulseId, uid, email);
    }, BEAT_MS);
    const unsub = subscribePresence(pulseId, (list) => {
      const cutoff = Date.now() - STALE_MS;
      setEntries(list.filter((p) => p.lastSeen > cutoff));
    });
    const onVis = () => {
      if (document.hidden) void clearPresence(pulseId, uid);
      else void heartbeatPresence(pulseId, uid, email);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(beat);
      unsub();
      document.removeEventListener("visibilitychange", onVis);
      void clearPresence(pulseId, uid);
    };
  }, [pulseId, uid, email]);
  return entries;
}

/** Avatar stack of who else is viewing this Pulse right now. */
export function PresenceBar({ pulseId, uid, email, dark }: { pulseId?: string; uid?: string; email: string; dark?: boolean }) {
  const entries = usePresence(pulseId, uid, email);
  const others = entries.filter((p) => p.uid !== uid);
  if (others.length === 0) return null;
  const shown = others.slice(0, 4);
  const ring = dark ? "#123359" : "#FFFFFF";
  return (
    <div className="flex items-center" title={`${others.length} other${others.length === 1 ? "" : "s"} viewing`}>
      {shown.map((p, i) => (
        <span
          key={p.uid}
          title={p.email}
          className="mono flex items-center justify-center"
          style={{ width: 22, height: 22, borderRadius: "50%", background: colorForName(p.uid), color: "#fff", fontSize: 8, fontWeight: 700, border: `2px solid ${ring}`, marginLeft: i === 0 ? 0 : -7, flexShrink: 0 }}
        >
          {initials(p.email)}
        </span>
      ))}
      {others.length > shown.length && (
        <span className="mono flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: "50%", background: dark ? "#1B3A63" : "#E2E8F0", color: dark ? "#F0A875" : "#475569", fontSize: 8, fontWeight: 700, border: `2px solid ${ring}`, marginLeft: -7 }}>
          +{others.length - shown.length}
        </span>
      )}
    </div>
  );
}
