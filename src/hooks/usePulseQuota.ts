import { useEffect, useState } from "react";
import { useBilling } from "@/hooks/useBilling";
import { subscribeWorkspace } from "@/services/firestore/workspaces";
import { entitlementsFor } from "@/domain/entitlements";
import type { Workspace } from "@/types";

export interface PulseQuota {
  /** Pulses the org holds — archived and hidden included (PL12). */
  used: number;
  /** The tier's cap, or `null` for unlimited (Business). */
  limit: number | null;
  /** No room for another Pulse. `false` while the counter is still unknown, so
   * the UI never blocks on missing data. */
  atLimit: boolean;
  /** SF11 hasn't written a counter for this org yet, so `used` is a guess.
   * Callers should soften their copy rather than assert a number. */
  unknown: boolean;
}

/**
 * The signed-in user's Pulse quota, live.
 *
 * This is **UX, not enforcement** — `firestore.rules` is the boundary, and it
 * reads the same `workspaces/{id}.pulseCount` that SF11 maintains. The point of
 * doing it here too is that a rules denial surfaces as
 * "Missing or insufficient permissions", which is a poor way to meet a paywall.
 *
 * `pulseCount` is absent until SF11 first writes it (or the backfill runs), and
 * an absent counter is reported as `unknown` rather than 0 — claiming "0 of 3
 * used" to an org with four Pulses would be worse than saying nothing. The rule
 * treats absent as 0 and lets one create through; this hook simply declines to
 * put a confident number on screen in that window.
 */
export function usePulseQuota(): PulseQuota {
  const { workspaceId, billing } = useBilling();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setWorkspace(null);
      return;
    }
    return subscribeWorkspace(workspaceId, setWorkspace);
  }, [workspaceId]);

  const limit = entitlementsFor(billing).maxPulses;
  const stored = workspace?.pulseCount;
  const unknown = typeof stored !== "number";
  const used = unknown ? 0 : stored;

  return { used, limit, atLimit: !unknown && limit !== null && used >= limit, unknown };
}
