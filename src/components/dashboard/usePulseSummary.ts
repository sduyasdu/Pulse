import { useEffect, useState } from "react";
import type { Epic, Feature, Resource } from "@/types";
import { fetchFeatures } from "@/services/firestore/features";
import { fetchEpics } from "@/services/firestore/epics";
import { fetchResources } from "@/services/firestore/resources";
import { fetchLatestActivityAt } from "@/services/firestore/activity";

export interface PulseSummary {
  epics: Epic[];
  features: Feature[];
  resources: Resource[];
  /** Newest activity entry's timestamp, or null when nothing is recorded (or
   * the log is not readable at this role). One extra document on a fetch that
   * already pulls every feature, epic and resource. */
  lastActivityAt: number | null;
}

/** One-shot fetch of a Pulse's epics/features/resources for the dashboard card
 * (roadmap thumbnail + KPI badges). The cards aren't interactive, so a live
 * listener per card would be wasted. On a read failure (Pulse deleted /
 * membership revoked) it returns empty sets so the card degrades gracefully —
 * DashboardPage separately self-heals the stale index entry. */
export function usePulseSummary(pulseId: string): PulseSummary | null {
  const [summary, setSummary] = useState<PulseSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    void (async () => {
      try {
        const [features, epics, resources, lastActivityAt] = await Promise.all([
          fetchFeatures(pulseId),
          fetchEpics(pulseId),
          fetchResources(pulseId),
          fetchLatestActivityAt(pulseId),
        ]);
        if (!cancelled) setSummary({ features, epics, resources, lastActivityAt });
      } catch {
        if (!cancelled) setSummary({ features: [], epics: [], resources: [], lastActivityAt: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pulseId]);
  return summary;
}
