import { Icon } from "./Icon";

/**
 * The loading spinner — Google's Material Symbol `progress_activity` (the same
 * three-quarter arc Material uses for indeterminate progress), rotated with
 * Tailwind's `animate-spin`.
 *
 * Accessibility:
 *  - `motion-reduce:animate-none` stops the rotation under
 *    `prefers-reduced-motion`. The glyph is a visible arc even when still, so it
 *    still reads as "busy" rather than vanishing.
 *  - The wrapper is the live region, not the SVG: `Icon` renders `aria-hidden`
 *    unless given a title, so the label below is what a screen reader announces.
 *    `role="status"` makes it announce politely, without stealing focus.
 */
export function Spinner({
  size = 20,
  label,
  className,
  color = "#94A3B8",
}: {
  size?: number;
  /** Visible text under the spinner. Also what assistive tech announces. */
  label?: string;
  className?: string;
  color?: string;
}) {
  return (
    <div role="status" className={`flex flex-col items-center gap-2 ${className ?? ""}`}>
      <Icon name="progress_activity" size={size} className="animate-spin motion-reduce:animate-none" style={{ color }} />
      {label && <span className="font-display text-sm" style={{ color }}>{label}</span>}
    </div>
  );
}

/** Inline variant — spinner and label on one line, for use inside a row or a
 * button rather than as a centred page state. Inherits the surrounding text
 * colour by default, so it works on a coloured button without being told. */
export function InlineSpinner({ size = 14, label, color = "currentColor" }: { size?: number; label?: string; color?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5" style={{ color }}>
      <Icon name="progress_activity" size={size} className="animate-spin motion-reduce:animate-none" />
      {label}
    </span>
  );
}
