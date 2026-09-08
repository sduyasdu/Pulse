import { useId } from "react";

/**
 * A miniature of the Pulse canvas, for the sign-in page.
 *
 * Drawn rather than screenshotted, deliberately. The marketing page at
 * yasdu.com/pulse uses PNGs of the real product; a login page cannot, because
 * this app is installable and runs offline — a remote image would be a blank
 * rectangle exactly when someone is signing back in on a bad connection, and a
 * bundled one would be a second copy of the UI to keep in step with it.
 *
 * It is also the product's whole argument in one picture, so it is a literal
 * miniature and not an abstraction: time runs left to right, each box is a
 * task, boxes sit in horizontal epic bands, and — the part a Gantt chart does
 * not have — a box's HEIGHT is the daily effort. The tall amber box beside the
 * short grey one of the same length is the point being made.
 *
 * Presentational only: no data, no store, deterministic, safe to render before
 * anyone is signed in.
 */

/** The canvas's own palette (`STATUS_META` / the epic colours), not a set
 * invented here — the picture has to look like the thing it is advertising. */
const BANDS = [
  { y: 16, h: 62, color: "#8B5CF6" },
  { y: 88, h: 66, color: "#14B8A6" },
];

/** x/width in user units, y/height in the same. Heights vary on purpose: that
 * is the claim the illustration exists to make. */
const TASKS = [
  { x: 18, y: 30, w: 52, h: 26, fill: "#12A594" },
  { x: 76, y: 24, w: 40, h: 40, fill: "#F5A524" },
  { x: 122, y: 36, w: 68, h: 18, fill: "#64748B" },
  { x: 150, y: 58, w: 44, h: 14, fill: "#64748B" },
  { x: 30, y: 100, w: 46, h: 34, fill: "#12A594" },
  { x: 84, y: 106, w: 58, h: 22, fill: "#F5A524" },
  { x: 150, y: 100, w: 74, h: 40, fill: "#E5484D" },
  { x: 232, y: 112, w: 52, h: 16, fill: "#64748B" },
];

const W = 300;
const H = 170;
/** Where the marker line falls. Left of centre, so most of the picture is the
 * future — which is the direction a roadmap is read in. */
const TODAY_X = 118;

export function CanvasPreview({ className }: { className?: string }) {
  // Ids must be unique per instance, or a second copy on the page would point
  // its fill at the first one's pattern.
  const uid = useId().replace(/:/g, "");
  const dots = `dots-${uid}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <defs>
        <pattern id={dots} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="#D7DEE8" />
        </pattern>
      </defs>

      <rect x="0" y="0" width={W} height={H} rx="10" fill="#FDFCF8" />
      <rect x="0" y="0" width={W} height={H} rx="10" fill={`url(#${dots})`} />

      {/* Ruler: the time axis the whole metaphor rests on. */}
      <rect x="0" y="0" width={W} height="12" rx="10" fill="#FFFFFF" />
      <rect x="0" y="6" width={W} height="6" fill="#FFFFFF" />
      <line x1="0" y1="12" x2={W} y2="12" stroke="#E2DFD9" strokeWidth="1" />
      {[40, 80, 120, 160, 200, 240, 280].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2={H} stroke="#EDF0F4" strokeWidth="1" />
      ))}

      {BANDS.map((b) => (
        <rect
          key={b.y}
          x="8"
          y={b.y}
          width={W - 16}
          height={b.h}
          rx="7"
          fill={b.color}
          fillOpacity="0.05"
          stroke={b.color}
          strokeOpacity="0.4"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ))}

      {TASKS.map((t, i) => (
        <rect
          key={`${t.x}-${t.y}`}
          className="login-box-in"
          // Staggered so the roadmap assembles itself, left to right, the way
          // it would be built.
          style={{ animationDelay: `${140 + i * 70}ms` }}
          x={t.x}
          y={t.y}
          width={t.w}
          height={t.h}
          rx="3"
          fill={t.fill}
          fillOpacity="0.9"
          stroke="#FFFFFF"
          strokeWidth="1.2"
        />
      ))}

      {/* Today, in the brand orange — the same marker the real canvas draws. */}
      <line x1={TODAY_X} y1="0" x2={TODAY_X} y2={H} stroke="#EE7240" strokeWidth="1.5" opacity="0.8" />
      <circle cx={TODAY_X} cy="6" r="2.6" fill="#EE7240" />
    </svg>
  );
}
