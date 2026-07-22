import type { Epic, Feature } from "@/types";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import { boxHeight } from "@/domain/graphEffort";
import { epicBandsFor } from "@/domain/layout";
import { STATUS_META, hexA } from "@/domain/constants";
import { todayIndex } from "@/domain/dateUtils";

// SVG user-space canvas the roadmap is squashed into. The x-axis is in days
// and the y-axis in px, so the fit is deliberately non-uniform — this is a
// glanceable mini-map of the roadmap's shape, not a scale drawing.
const W = 100;
const H = 40;
const PAD = 2;
const MIN_BOX = 1.2;

interface PulseThumbnailProps {
  features: Feature[];
  epics: Epic[];
}

export function PulseThumbnail({ features, epics }: PulseThumbnailProps) {
  const frame = { background: "#FDFCF8", border: "1px solid #EEF1F4", borderRadius: 6 };

  if (features.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ ...frame, height: 56 }}>
        <span className="mono" style={{ fontSize: 9, color: "#B4BECC" }}>empty roadmap</span>
      </div>
    );
  }

  // Thumbnails always render at the default Graph Effort scale rather than
  // the Pulse's own — the relative shape is what matters here, and it saves
  // a second read per card just to fetch graphConfig.
  const graph = DEFAULT_GRAPH_CONFIG;
  const bands = epicBandsFor(epics, features, graph).filter((b) => b.count > 0);

  // Show a fixed window centered on today rather than the whole roadmap, so
  // boxes stay a readable size as the timeline grows. Anything outside the
  // window is clipped by the viewBox.
  const SPAN = 45; // days on each side of today
  const today = todayIndex();
  let winStart = today - SPAN;
  let winEnd = today + SPAN;
  let visible = features.filter((f) => f.x + f.duration > winStart && f.x < winEnd);

  // Nothing near today (e.g. a purely historical or future roadmap)? Fall back
  // to fitting everything so the card isn't blank.
  if (visible.length === 0) {
    visible = features;
    winStart = Math.min(...features.map((f) => f.x));
    winEnd = Math.max(...features.map((f) => f.x + f.duration));
  }

  const visibleBands = bands.filter((b) => (b.maxX ?? 0) > winStart && (b.minX ?? 0) < winEnd);

  const minX = winStart;
  const maxX = winEnd;
  const minY = Math.min(...visible.map((f) => f.y), ...visibleBands.map((b) => b.y0));
  const maxY = Math.max(...visible.map((f) => f.y + boxHeight(f, graph)), ...visibleBands.map((b) => b.y1));

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const sx = (W - PAD * 2) / spanX;
  const sy = (H - PAD * 2) / spanY;
  const px = (x: number) => PAD + (x - minX) * sx;
  const py = (y: number) => PAD + (y - minY) * sy;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ ...frame, height: 56, width: "100%", display: "block" }} role="img" aria-label="Roadmap preview">
      {visibleBands.map((b) => (
        <rect
          key={b.id}
          x={px(b.minX ?? minX)}
          y={py(b.y0)}
          width={Math.max(MIN_BOX, ((b.maxX ?? minX) - (b.minX ?? minX)) * sx)}
          height={Math.max(MIN_BOX, (b.y1 - b.y0) * sy)}
          fill={hexA(b.color, 0.08)}
          stroke={hexA(b.color, 0.35)}
          strokeWidth={0.4}
          rx={1}
        />
      ))}
      {visible.map((f) => {
        const meta = STATUS_META[f.status] ?? STATUS_META.planned;
        return (
          <rect
            key={f.id}
            x={px(f.x)}
            y={py(f.y)}
            width={Math.max(MIN_BOX, f.duration * sx)}
            height={Math.max(MIN_BOX, boxHeight(f, graph) * sy)}
            fill={meta.border}
            stroke="#FFFFFF"
            strokeWidth={0.3}
            rx={0.8}
          />
        );
      })}
      {today >= minX && today <= maxX && (
        <line x1={px(today)} y1={0} x2={px(today)} y2={H} stroke="#EE7240" strokeWidth={0.5} opacity={0.7} />
      )}
    </svg>
  );
}
