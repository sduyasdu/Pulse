import { useId } from "react";

/** Brand variants from the Pulse brand kit (`public/brand/`):
 *  - light: orange disc, navy bezel — light surfaces
 *  - dark:  orange disc, paper bezel — navy/dark surfaces
 *  - black / white: single colour, for when colour isn't available */
export type BrandVariant = "light" | "dark" | "white" | "black";

const RING: Record<BrandVariant, string> = {
  light: "#123359",
  dark: "#F7F6F2",
  white: "#FDFCF8",
  black: "#000B1B",
};

const DISC: Record<BrandVariant, string> = {
  light: "#E84D1B",
  dark: "#E84D1B",
  white: "#FDFCF8",
  black: "#000B1B",
};

/** Wordmark ink — pairs with the mark of the same variant. */
const INK: Record<BrandVariant, string> = {
  light: "#123359",
  dark: "#F7F6F2",
  white: "#FDFCF8",
  black: "#000B1B",
};

interface MarkProps {
  variant?: BrandVariant;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Set when the mark sits next to the name — the lockup labels itself. */
  decorative?: boolean;
}

/** The Pulse mark: a disc inside a bezel, cut through by the pulse trace.
 * Inlined rather than an <img> so it scales and stays crisp at header sizes;
 * the trace is a mask, so the cut always shows the surface behind it. */
export function PulseMark({ variant = "light", size = 24, className, style, decorative }: MarkProps) {
  // Two marks on one page (e.g. header + dialog) would otherwise share a mask id.
  const maskId = `pulse-mark-${useId()}`;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Pulse"}
      aria-hidden={decorative ? true : undefined}
    >
      <defs>
        <mask id={maskId}>
          <rect x="0" y="0" width="48" height="48" fill="#fff" />
          <path
            fill="none"
            stroke="#000"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2,24 L17,24 L21,15 L27,33 L31,24 L46,24"
          />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <circle cx="24" cy="24" r="21.5" fill="none" stroke={RING[variant]} strokeWidth="2.5" />
        <circle cx="24" cy="24" r="15.5" fill={DISC[variant]} />
      </g>
    </svg>
  );
}

interface LockupProps {
  variant?: BrandVariant;
  /** Wordmark font size in px; the mark scales with it (brand ratio 48:38). */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Mark + name, the header default. The name is live text in Space Grotesk
 * (already loaded app-wide) rather than the baked SVG lockup, so it renders at
 * the same weight and hinting as the rest of the UI at small sizes. */
export function PulseLockup({ variant = "light", size = 16, className, style }: LockupProps) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.34, ...style }}>
      <PulseMark variant={variant} size={Math.round(size * 1.26)} decorative />
      <span
        className="font-display"
        style={{ color: INK[variant], fontSize: size, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1 }}
      >
        Pulse
      </span>
    </span>
  );
}
