import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphConfig } from "@/types";
import {
  CASCADE_STEP_DAYS,
  cascadeStepPx,
  lowestFreeSlot,
  reconcileClaims,
  type CascadeClaim,
  type CascadeFeature,
} from "@/domain/taskCascade";

/**
 * Stacks successive new tasks down-and-right instead of on top of each other.
 *
 * See `domain/taskCascade.ts` for the slot rules. This is the React half: hold
 * the claims, and reconcile them against the live feature list on every change
 * so that moving, resizing or deleting a freshly-added task hands its slot back.
 *
 * It also **anchors** the cascade. The caller's `baseY` is the middle of the
 * viewport, which moves — not least because adding a task deep in the cascade
 * scrolls to reveal it. Recomputing the origin each time would let the stack
 * walk down the canvas and, worse, drop a later task back on top of an earlier
 * one, which is the bug this exists to fix. So the origin is fixed by the first
 * task of a run and released once the run is fully dispersed, at which point the
 * next add re-anchors wherever you are then looking.
 */
export function useTaskCascade(features: CascadeFeature[], graph: GraphConfig): {
  /** Absolute placement for the next task, given where the viewport currently
   * is. `baseY` is only consulted when no cascade is in progress. */
  nextPlacement: (baseY: number) => { slot: number; dx: number; y: number };
  /** Record where a newly created task was actually put. */
  claim: (id: string, slot: number, geom: { x: number; y: number; duration: number; work: number }) => void;
} {
  const [claims, setClaims] = useState<CascadeClaim[]>([]);
  const [anchorY, setAnchorY] = useState<number | null>(null);

  // Read through refs so these never go stale between renders — they are read
  // from an imperative handle, not from the render that would refresh a closure.
  const claimsRef = useRef(claims);
  claimsRef.current = claims;
  const anchorRef = useRef(anchorY);
  anchorRef.current = anchorY;

  useEffect(() => {
    setClaims((cur) => {
      const next = reconcileClaims(cur, features);
      // Same-value bail-out: this runs on every feature change, and returning a
      // fresh array each time would re-render the canvas on every keystroke
      // typed into a task title.
      if (next.length === cur.length && next.every((c, i) => c === cur[i])) return cur;
      // A run that has been fully placed lets go of its origin, so the next add
      // starts from wherever the user is looking rather than from a viewport
      // they have long since scrolled away from.
      if (next.length === 0) setAnchorY(null);
      return next;
    });
  }, [features]);

  const nextPlacement = useCallback(
    (baseY: number) => {
      const slot = lowestFreeSlot(claimsRef.current);
      const origin = anchorRef.current ?? baseY;
      return { slot, dx: slot * CASCADE_STEP_DAYS, y: origin + slot * cascadeStepPx(graph) };
    },
    [graph],
  );

  const claim = useCallback(
    (id: string, slot: number, geom: { x: number; y: number; duration: number; work: number }) => {
      setClaims((cur) => [...cur.filter((c) => c.id !== id && c.slot !== slot), { id, slot, ...geom, seen: false }]);
      // Recover the origin this placement was derived from, so a run that began
      // at slot 0 and one that resumed at slot 2 anchor to the same line.
      setAnchorY((cur) => (cur === null ? geom.y - slot * cascadeStepPx(graph) : cur));
    },
    [graph],
  );

  return { nextPlacement, claim };
}
