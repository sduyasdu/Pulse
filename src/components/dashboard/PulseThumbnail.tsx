import { useEffect, useState } from "react";
import type { Epic, Feature } from "@/types";
import { DEFAULT_GRAPH_CONFIG } from "@/types";
import { fetchFeatures } from "@/services/firestore/features";
import { fetchEpics } from "@/services/firestore/epics";
import { boxHeight } from "@/domain/graphEffort";
import { epicBandsFor } from "@/domain/layout";
import { STATUS_META, hexA } from "@/domain/constants";

// SVG user-space canvas the roadmap is squashed into. The x-axis is in days
// and the y-axis in px, so the fit is deliberately non-uniform — this is a
// glanceable mini-map of the roadmap's shape, not a scale drawing.
const W = 100;
const H = 40;
const PAD = 2;
const MIN_BOX = 1.2;

interface PulseThumbnailProps {
  pulseId: string;
}

export function PulseThumbnail({ pulseId }: PulseThumbnailProps) {
  const [data, setData] = useState<{ features: Feature[]; epics: Epic[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [features, epics] = await Promise.all([fetchFeatures(pulseId), fetchEpics(pulseId)]);
        if (!cancelled) setData({ features, epics });
      } catch {
        // A card for a Pulse we can no longer read (deleted, membership
        // revoked) shouldn't break the dashboard — the empty state below
        // is a fine fallback, and DashboardPage self-heals the stale entry.
        if (!cancelled) setData({ features: [], epics: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pulseId]);

  const frame = { background: "#FDFCF8", border: "1px solid #EEF1F4", borderRadius: 6 };

  if (!data) {
    return <div style={{ ...frame, height: 56 }} />;
  }

  const { features, epics } = data;
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

  const minX = Math.min(...features.map((f) => f.x));
  const maxX = Math.max(...features.map((f) => f.x + f.duration));
  const minY = Math.min(...features.map((f) => f.y), ...bands.map((b) => b.y0));
  const maxY = Math.max(...features.map((f) => f.y + boxHeight(f, graph)), ...bands.map((b) => b.y1));

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const sx = (W - PAD * 2) / spanX;
  const sy = (H - PAD * 2) / spanY;
  const px = (x: number) => PAD + (x - minX) * sx;
  const py = (y: number) => PAD + (y - minY) * sy;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ ...frame, height: 56, width: "100%", display: "block" }} role="img" aria-label="Roadmap preview">
      {bands.map((b) => (
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
      {features.map((f) => {
        const meta = STATUS_META[f.status] ?? STATUS_META.planned;
        return (
          <rect
            key={f.id}
            x={px(f.x)}
            y={py(f.y)}
            width={Math.max(MIN_BOX, f.duration * sx)}
            height={Math.max(MIN_BOX, boxHeight(f, graph) * sy)}
            fill={meta.bg}
            stroke={meta.border}
            strokeWidth={0.5}
            rx={0.8}
          />
        );
      })}
    </svg>
  );
}
