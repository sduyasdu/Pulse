import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

/**
 * Connection state as a header icon: a cloud when Pulse can reach the server,
 * a struck-through cloud when it can't.
 *
 * This replaced a fixed banner, for two reasons that are really one. The banner
 * appeared on every page load — the reachability probe's first snapshot is
 * cache-served while the SDK is still connecting, so it read as "unreachable"
 * until the channel opened (fixed at the source in `reachability.ts`, but the
 * shape of the thing made it worse). And once it was up it *stayed* up, sitting
 * over the canvas for as long as the connection was down, which is exactly when
 * someone is most likely to be working around it.
 *
 * An always-present icon inverts both. It says nothing while things are fine
 * because a quiet cloud is not a message, it is a state you can look up; and
 * when the connection drops it never grows past the space it already occupies.
 * The detail that used to be banner copy — that edits are queued locally and
 * will sync — moves into the tooltip, where it is available at the moment
 * someone wonders rather than pushed at them while they don't.
 */
export function ConnectionStatus({ uid, size = 14 }: { uid?: string | null; size?: number }) {
  const t = useT();
  const status = useNetworkStatus(uid);
  const connected = status === "online";

  // Offline and unreachable are genuinely different facts and the tooltip says
  // which, but they carry the same icon and the same instruction — there is
  // nothing you would do differently.
  const label = connected
    ? t("net.connected")
    : `${status === "offline" ? t("net.offline") : t("net.unreachable")} ${t("net.editsQueued")}`;

  return (
    // A live region, so a connection dropping while you are typing is announced
    // rather than only being visible. The text is the announcement; the icon is
    // aria-hidden by default (no `title`), so it isn't read twice.
    <span
      role="status"
      title={label}
      className="flex items-center justify-center"
      style={{ width: size + 12, height: size + 12, flexShrink: 0 }}
    >
      <Icon
        name={connected ? "cloud_done" : "cloud_off"}
        size={size}
        // Quiet when connected — it is the state you are in ~always, and an
        // accent colour there would compete with the real controls beside it.
        style={{ color: connected ? "#94A3B8" : "#F59E0B" }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
