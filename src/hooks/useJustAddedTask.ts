import { useCallback, useEffect, useState } from "react";

/**
 * Keeps the task you just created visible while a filter is running.
 *
 * A new task matches almost no filter by construction — no resources, no epic,
 * status `planned`, titled "New task" — so adding one with a filter active
 * created it, selected it, opened it in the Details tab, and left the canvas
 * behind it showing nothing. The canvas hides rather than dims by default
 * (`compactFilter` starts on), so it was genuinely absent, not just faint.
 *
 * The exemption is scoped rather than permanent, and both ends of it are the
 * user telling you they've moved on:
 *
 * - **The filter changes.** They have restated what they want to see, and a
 *   leftover exemption would show a task that contradicts it.
 * - **Something else is selected.** They are done with the new task.
 *
 * `filterSignature` is a plain string on purpose. The filters include two
 * `Set`s, and comparing those by identity works only for as long as nobody
 * rebuilds one during a render — a signature can't develop that fault
 * silently.
 */
export function useJustAddedTask(filterSignature: string): {
  /** The exempt task id, or null. */
  justAddedId: string | null;
  /** Call when a task has just been created. */
  markAdded: (id: string) => void;
  /** Call on every selection change, including to null. */
  noteSelection: (id: string | null) => void;
} {
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  // Keyed on the filters ALONE. Adding `justAddedId` here — which looks like
  // the missing dependency, and which a linter may well suggest — would clear
  // the exemption on the render that granted it, and the feature would quietly
  // stop working with every test still green.
  useEffect(() => {
    setJustAddedId(null);
  }, [filterSignature]);

  const markAdded = useCallback((id: string) => setJustAddedId(id), []);

  // A functional update so the current value never has to be a dependency:
  // `noteSelection` stays referentially stable, which matters because it is
  // called from the selection callback the whole page passes around.
  const noteSelection = useCallback(
    (id: string | null) => setJustAddedId((cur) => (cur === id ? cur : null)),
    [],
  );

  return { justAddedId, markAdded, noteSelection };
}

/** One string standing for "what the user asked to see", for the hook above.
 * Sets are sorted so that re-selecting the same statuses in a different order
 * doesn't read as a change. */
export function filterSignatureOf(parts: {
  query: string;
  statuses: Set<string>;
  epics: Set<string>;
  resource: string | null;
  mineOnly: boolean;
}): string {
  return [
    parts.query.trim(),
    [...parts.statuses].sort().join(","),
    [...parts.epics].sort().join(","),
    parts.resource ?? "",
    parts.mineOnly ? "mine" : "",
  ].join("|");
}
