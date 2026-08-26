import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

/**
 * Says when the app has lost touch with the server.
 *
 * Fixed to the bottom rather than pushing the layout: the canvas sizes itself
 * to the viewport, and a banner that reflowed it would move every task box
 * sideways the moment a connection wobbled.
 *
 * The wording tracks what is actually true, which changed: Firestore now runs
 * on `persistentLocalCache`, so the cache and the queue of unsent writes are on
 * disk and an offline edit survives a reload. This message used to say "keep
 * this tab open", which was accurate against the memory-only default and would
 * have quietly become a lie the moment persistence was switched on.
 */
export function NetworkBanner({ uid }: { uid?: string | null }) {
  const t = useT();
  const status = useNetworkStatus(uid);

  if (status === "online") return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 flex items-center gap-2 rounded-lg px-3 py-2 shadow-lg"
      style={{
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 120, // above the canvas hover cards (100), below nothing else
        background: "#123359",
        border: "1px solid #EE7240",
        color: "#F7F6F2",
        maxWidth: "min(92vw, 420px)",
      }}
    >
      <Icon name="cloud_off" size={16} style={{ color: "#F0A875", flexShrink: 0 }} />
      <span className="text-xs">
        {status === "offline" ? t("net.offline") : t("net.unreachable")}
        <span className="block opacity-80">{t("net.editsQueued")}</span>
      </span>
    </div>
  );
}
