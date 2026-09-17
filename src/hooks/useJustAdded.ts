import { useCallback, useEffect, useState } from "react";

/** Shared empty set, so "nothing is exempt" is always the same object and the
 * memos downstream don't invalidate on every clear. */
const NONE: ReadonlySet<string> = new Set();

/**
 * Keeps the things you just created visible while a filter is running.
 *
 * Used twice, once for tasks and once for epics — the ids are opaque to it, and
 * a new epic disappears under a filter for the same reason a new task does: it
 * is empty, so it matches nothing.
 *
 * A new task matches almost no filter by construction — no resources, no epic,
 * status `planned`, titled "New task" — so adding one with a filter active
 * created it, selected it, opened it in the Details tab, and left the canvas
 * behind it showing nothing. The canvas hides rather than dims by default
 * (`compactFilter` starts on), so it was genuinely absent, not just faint.
 *
 * **Every task added since the filter last changed is exempt, not just the
 * newest.** This began as a single id, which quietly undid itself the moment
 * the cascade landed: adding a second task moved the exemption onto it and the
 * first vanished again, so a run of new tasks was arranged carefully and then
 * shown one at a time.
 *
 * Changing a filter is the only thing that ends it. That is the moment the user
 * restates what they want to see, and it is the only moment where continuing to
 * show a pile of non-matching tasks would be contradicting them rather than
 * helping. Selecting elsewhere used to clear it too, back when one task was
 * exempt at a time; with a set that would mean adding three tasks and keeping
 * only whichever you clicked last.
 */
export function useJustAdded(filterSignature: string): {
  /** Ids exempt from the filters. Referentially stable between changes, because
   * it feeds the canvas's match memo. */
  justAddedIds: ReadonlySet<string>;
  /** Call when a task has just been created. */
  markAdded: (id: string) => void;
} {
  const [justAddedIds, setJustAddedIds] = useState<ReadonlySet<string>>(NONE);

  // Keyed on the filters ALONE. Adding `justAddedIds` here — which looks like
  // the missing dependency, and which a linter may well suggest — would clear
  // the exemption on the render that granted it, and the feature would quietly
  // stop working with every test still green.
  useEffect(() => {
    setJustAddedIds((cur) => (cur.size === 0 ? cur : NONE));
  }, [filterSignature]);

  const markAdded = useCallback((id: string) => {
    setJustAddedIds((cur) => (cur.has(id) ? cur : new Set(cur).add(id)));
  }, []);

  return { justAddedIds, markAdded };
}

/** One string standing for "what the user asked to see", for the hook above.
 * Sets are sorted so that re-selecting the same statuses in a different order
 * doesn't read as a change. */
export function filterSignatureOf(parts: {
  query: string;
  statuses: Set<string>;
  epics: Set<string>;
  /** Cycles-Spec CY13. A filter left out of this signature still hides tasks,
   * but stops clearing the just-added exemption — so creating a task, filtering
   * it away and creating another would leave the first one stranded on screen. */
  cycles: Set<string>;
  resource: string | null;
  mineOnly: boolean;
}): string {
  return [
    parts.query.trim(),
    [...parts.statuses].sort().join(","),
    [...parts.epics].sort().join(","),
    [...parts.cycles].sort().join(","),
    parts.resource ?? "",
    parts.mineOnly ? "mine" : "",
  ].join("|");
}
