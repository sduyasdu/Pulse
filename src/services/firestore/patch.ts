/**
 * Firestore's updateDoc() throws on any `undefined` field value rather than
 * ignoring it, which takes the *entire* write down — so one stray optional
 * field (e.g. a `lead` that was never set) can silently kill an unrelated
 * mutation, with the rejection swallowed by a fire-and-forget caller.
 *
 * In a patch, `undefined` already means "leave this field alone", so
 * dropping those keys is exactly the intended semantics. Use `null` to
 * actually clear a field — see the nullable optionals in types/index.ts.
 */
export function stripUndefined<T extends object>(patch: T): T {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Cycles with every `undefined` dropped, two levels down — which is where they
 * live. The editor clears `i18nKey` by setting it to `undefined` when a seeded
 * name is edited (SCT4), and `stripUndefined` only cleans the top level, so
 * renaming any cycle or stage took the whole cycles write down with it.
 */
export function cleanCycles<T extends { statuses: object[] }>(cycles: T[]): T[] {
  return cycles.map((c) => ({ ...stripUndefined(c), statuses: c.statuses.map((s) => stripUndefined(s)) }));
}
