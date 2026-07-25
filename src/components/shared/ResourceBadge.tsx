import { usePulseStore } from "@/stores/pulseStore";
import { colorForName } from "@/domain/constants";

/** Circular resource avatar. For a resource linked to a real account whose
 * owner has set an avatar, it shows that user's picture; otherwise the
 * initials on the resource's colour. Looks the resource + linked member up by
 * id from the store. */
export function ResourceBadge({ resourceId, size = 16, title, ring, style }: { resourceId: string; size?: number; title?: string; ring?: string; style?: React.CSSProperties }) {
  const resource = usePulseStore((s) => s.resources.find((r) => r.id === resourceId));
  const members = usePulseStore((s) => s.members);
  const linkedPhoto = resource?.linkedUid ? members.find((m) => m.uid === resource.linkedUid)?.photoURL ?? null : null;

  const initials = resource?.initials ?? "?";
  const tip = title ?? resource?.name ?? initials;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    ...(ring ? { boxShadow: `0 0 0 2px ${ring}` } : {}),
    ...style,
  };

  if (linkedPhoto) {
    return <img src={linkedPhoto} alt={tip} title={tip} style={{ ...base, objectFit: "cover", display: "block" }} />;
  }
  return (
    <span className="mono flex items-center justify-center" title={tip} style={{ ...base, background: colorForName(resourceId), color: "#fff", fontWeight: 700, fontSize: Math.max(7, Math.round(size * 0.44)) }}>
      {initials}
    </span>
  );
}
