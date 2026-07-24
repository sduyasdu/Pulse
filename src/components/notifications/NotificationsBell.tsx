import { useEffect, useState } from "react";
import { Icon } from "@/components/shared/Icon";
import type { Notification } from "@/types";
import { subscribeMyNotifications, markNotificationRead, deleteNotification } from "@/services/firestore/notifications";

function when(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Bell with a live unread count and a dropdown of this Pulse's notifications
 * for the current user. Clicking one opens its task. */
export function NotificationsBell({ pulseId, uid, onOpenTask, dark }: { pulseId?: string; uid?: string; onOpenTask: (featureId: string) => void; dark?: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pulseId || !uid) return;
    return subscribeMyNotifications(pulseId, uid, setItems);
  }, [pulseId, uid]);

  if (!pulseId || !uid) return null;
  const unread = items.filter((n) => !n.read).length;

  const openItem = (n: Notification) => {
    setOpen(false);
    if (!n.read) void markNotificationRead(pulseId, n.id);
    if (n.featureId) onOpenTask(n.featureId);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center rounded"
        style={{ width: 26, height: 26, background: dark ? "#1B3A63" : "#F1EFE8", color: dark ? "#EE7240" : "#64748B", fontSize: 14 }}
        title="Notifications"
        aria-label="Notifications"
      >
        <Icon name="notifications" size={15} />
        {unread > 0 && (
          <span className="mono" style={{ position: "absolute", top: -4, right: -4, minWidth: 15, height: 15, borderRadius: 8, background: "#E5484D", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setOpen(false)} />
          <div className="absolute rounded-lg border" style={{ top: "100%", right: 0, marginTop: 6, zIndex: 61, width: 300, maxHeight: 380, overflowY: "auto", background: "#FFFFFF", borderColor: "#E2DFD9", boxShadow: "0 8px 24px rgba(15,23,42,0.16)" }}>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "#F1F5F9" }}>
              <span className="mono text-xs font-semibold" style={{ color: "#334155" }}>Notifications</span>
              {unread > 0 && (
                <button onClick={() => items.filter((n) => !n.read).forEach((n) => void markNotificationRead(pulseId, n.id))} className="mono" style={{ fontSize: 10, color: "#0F766E" }}>
                  Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs" style={{ color: "#94A3B8" }}>Nothing yet.</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className="flex items-start gap-2 px-3 py-2 border-b" style={{ borderColor: "#F5F5F0", background: n.read ? "#FFFFFF" : "#FFF7F1" }}>
                  <button onClick={() => openItem(n)} className="flex-1 text-left min-w-0">
                    <div className="text-xs" style={{ color: "#334155" }}>
                      <span className="font-semibold">{n.actorEmail}</span> commented on <span className="font-semibold">{n.featureTitle}</span>
                    </div>
                    <div className="text-xs truncate" style={{ color: "#64748B" }}>“{n.text}”</div>
                    <div className="mono" style={{ fontSize: 9, color: "#94A3B8" }}>{when(n.createdAt)}</div>
                  </button>
                  <button onClick={() => void deleteNotification(pulseId, n.id)} className="mono flex-shrink-0" style={{ fontSize: 10, color: "#CBD5E1" }} title="Dismiss"><Icon name="close" size={12} /></button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
