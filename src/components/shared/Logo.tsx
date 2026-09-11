import { useId } from "react";

/** Brand variants from the Beats brand kit (`public/brand/`):
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

/** The Beats mark: a disc inside a bezel, cut through by the beat trace.
 * Inlined rather than an <img> so it scales and stays crisp at header sizes;
 * the trace is a mask, so the cut always shows the surface behind it. */
export function BeatsMark({ variant = "light", size = 24, className, style, decorative }: MarkProps) {
  // Two marks on one page (e.g. header + dialog) would otherwise share a mask id.
  const maskId = `beats-mark-${useId()}`;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Beats"}
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

/**
 * The product is "Beats"; one roadmap inside it is "a Beat". They are different
 * words, so the lockup has to be told which it is standing for.
 *
 * Plural is the default because it is the product's name and covers every
 * surface that spans more than one roadmap — the dashboard, sign-in, the
 * account dialogs, the OAuth consent screen. Only the canvas toolbar, which is
 * by definition inside a single Beat, asks for the singular.
 */
export type BrandWord = "Beats" | "Beat";

interface LockupProps {
  variant?: BrandVariant;
  /** Wordmark font size in px; the mark scales with it (brand ratio 48:38). */
  size?: number;
  /** Defaults to the product name. Pass "Beat" only inside one Beat. */
  word?: BrandWord;
  className?: string;
  style?: React.CSSProperties;
}

/** Mark + name, the header default. The name is live text in Space Grotesk
 * (already loaded app-wide) rather than the baked SVG lockup, so it renders at
 * the same weight and hinting as the rest of the UI at small sizes. The kit's
 * `beats-lockup-*.svg` / `beat-lockup-*.svg` are the same drawing at the same
 * metrics, for use outside the app. */
export function BeatsLockup({ variant = "light", size = 16, word = "Beats", className, style }: LockupProps) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.34, ...style }}>
      <BeatsMark variant={variant} size={Math.round(size * 1.26)} decorative />
      <span
        className="font-display"
        style={{ color: INK[variant], fontSize: size, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1 }}
      >
        {word}
      </span>
    </span>
  );
}
