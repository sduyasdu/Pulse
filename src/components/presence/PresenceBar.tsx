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
    let raw: PresenceEntry[] = [];
    const apply = () => {
      const cutoff = Date.now() - STALE_MS;
      setEntries(raw.filter((p) => p.lastSeen > cutoff));
    };
    void heartbeatPresence(pulseId, uid, email);
    // Keep the heartbeat going while this view is mounted (even if the window
    // is in the background), so others keep seeing you; re-filter on a timer so
    // people who closed their tab drop off even without a new snapshot.
    const beat = window.setInterval(() => {
      void heartbeatPresence(pulseId, uid, email);
      apply();
    }, BEAT_MS);
    const unsub = subscribePresence(pulseId, (list) => {
      raw = list;
      apply();
    });
    // Best-effort clear when the tab actually closes.
    const onUnload = () => void clearPresence(pulseId, uid);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.clearInterval(beat);
      unsub();
      window.removeEventListener("pagehide", onUnload);
      void clearPresence(pulseId, uid);
    };
  }, [pulseId, uid, email]);
  return entries;
}

/** Avatar stack of who else is viewing this Pulse right now. Hovering (pointer
 * devices) highlights it; clicking toggles a list of names — the tap-reachable
 * equivalent of the hover, so who's present is available on touch too. */
export function PresenceBar({ pulseId, uid, email, dark }: { pulseId?: string; uid?: string; email: string; dark?: boolean }) {
  const entries = usePresence(pulseId, uid, email);
  const others = entries.filter((p) => p.uid !== uid);
  const [open, setOpen] = useState(false);
  if (others.length === 0) return null;
  const shown = others.slice(0, 4);
  const ring = dark ? "#123359" : "#FFFFFF";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="presence-stack hoverable--ring no-press flex items-center"
        style={{ background: "transparent", border: "none", padding: 0 }}
        title={`${others.length} other${others.length === 1 ? "" : "s"} viewing — click for names`}
        aria-label={`${others.length} other${others.length === 1 ? "" : "s"} viewing`}
      >
        {shown.map((p) => (
          <span
            key={p.uid}
            className="presence-avatar mono flex items-center justify-center"
            style={{ width: 22, height: 22, borderRadius: "50%", background: colorForName(p.uid), color: "#fff", fontSize: 8, fontWeight: 700, border: `2px solid ${ring}`, flexShrink: 0 }}
          >
            {initials(p.email)}
          </span>
        ))}
        {others.length > shown.length && (
          <span className="presence-avatar mono flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: "50%", background: dark ? "#1B3A63" : "#E2E8F0", color: dark ? "#F0A875" : "#475569", fontSize: 8, fontWeight: 700, border: `2px solid ${ring}`, flexShrink: 0 }}>
            +{others.length - shown.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setOpen(false)} />
          <div className="absolute rounded-lg border" style={{ top: "100%", right: 0, marginTop: 6, zIndex: 61, width: 220, maxHeight: 320, overflowY: "auto", background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.16)" }}>
            <div className="mono px-3 py-2 border-b" style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em", borderColor: "#F1F5F9" }}>
              Viewing now · {others.length}
            </div>
            {others.map((p) => (
              <div key={p.uid} className="flex items-center gap-2 px-3 py-1.5">
                <span className="mono flex items-center justify-center" style={{ width: 20, height: 20, borderRadius: "50%", background: colorForName(p.uid), color: "#fff", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                  {initials(p.email)}
                </span>
                <span className="text-xs truncate" style={{ color: "#334155" }}>{p.email}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
