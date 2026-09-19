/**
 * Toggle a whole set of ids at once: all present means clear them, anything
 * else means add them all.
 *
 * Two features want exactly this and would otherwise each grow their own copy —
 * the status filter's cycle headings (select the whole cycle) and the board's
 * collapse-all. The shared rule is the part worth stating once: a **partial**
 * selection completes rather than clears, because half-on means "I want more of
 * this", and clearing there throws away a choice made one click ago.
 *
 * Ids outside `groupIds` are untouched, so acting on what is visible never
 * disturbs what is not.
 */
export function toggleGroup(selected: Set<string>, groupIds: string[]): Set<string> {
  const next = new Set(selected);
  // No `length > 0` guard. `[].every()` is true, which looks like it would make
  // an empty group read as "all on" — but the loop below then iterates nothing,
  // so the answer is the same either way. A mutation removing the guard changed
  // no test result, which is the tell for a branch that cannot be reached.
  const allOn = groupIds.every((id) => next.has(id));
  for (const id of groupIds) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}
