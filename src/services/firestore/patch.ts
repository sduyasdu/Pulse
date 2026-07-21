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
