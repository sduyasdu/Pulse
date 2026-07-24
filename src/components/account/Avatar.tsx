import { Icon } from "@/components/shared/Icon";

/** The user's avatar: their uploaded picture thumbnail, or a default
 * account icon when they haven't set one. */
export function Avatar({ photoURL, name, size = 30, iconColor, className }: { photoURL?: string | null; name?: string; size?: number; iconColor?: string; className?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name ? `${name}'s avatar` : "Your avatar"}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
        className={className}
      />
    );
  }
  return <Icon name="account_circle" size={size} className={className} style={{ color: iconColor }} />;
}
