import { Icon } from "@/components/shared/Icon";
import { useT } from "@/i18n";

/** The orange the add buttons use. Shared so "from the organisation" looks like
 * the button that brings people from it, and stays that way if the orange moves. */
export const ORIGIN_ORANGE = { background: "#F7E8DA", color: "#D85A28" } as const;

/**
 * Where a Pulse resource came from: the organisation's People list, or this
 * Pulse alone.
 *
 * Not decoration — it predicts what is editable. A roster person's name and role
 * are managed at workspace level and read-only here (RM22), so seeing the origin
 * at a glance beats discovering it by clicking a disabled field.
 *
 * One component rather than one per tab: the Team and Capacity tabs show the
 * same fact, and two copies is how they end up disagreeing about it.
 */
export function ResourceOriginBadge({ masterId, size = 14 }: { masterId?: string; size?: number }) {
  const t = useT();
  const fromRoster = !!masterId;
  const label = fromRoster ? t("team.fromRoster") : t("team.localOnly");
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded"
      title={label}
      aria-label={label}
      // The INVERSE of the add button, from the same constant: the button is
      // orange-on-tint, the badge is white-on-orange. One hue, two weights — the
      // badge reads as a mark rather than a second button, and the orange still
      // moves in one place if it ever changes.
      style={{ width: size, height: size, background: fromRoster ? ORIGIN_ORANGE.color : "#F4F5F7" }}
    >
      <Icon name={fromRoster ? "group" : "person"} size={Math.round(size * 0.72)} style={{ color: fromRoster ? "#FFFFFF" : "#94A3B8" }} />
    </span>
  );
}
