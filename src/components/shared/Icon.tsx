import { ICONS } from "./icons";

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/** A Google Material Symbol (outlined), rendered inline so it inherits color
 * via `currentColor` and scales to any `size`. Icon data is baked into
 * icons.ts (all outlined icons are plain `<path>`s), rendered as real SVG path
 * elements — no runtime font, network, or dangerouslySetInnerHTML. */
export function Icon({ name, size = 18, className, style, title }: IconProps) {
  const inner = ICONS[name];
  if (!inner) return null;
  const paths = Array.from(inner.matchAll(/\bd="([^"]+)"/g), (m) => m[1]);
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
