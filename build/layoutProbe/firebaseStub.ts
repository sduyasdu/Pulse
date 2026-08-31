/**
 * Stands in for `@/lib/firebase` while the probe runs.
 *
 * The Toolbar reaches Firebase only transitively (through the i18n and auth
 * stores), but `lib/firebase` throws on import without a config — so without
 * this the probe dies before React mounts and reports "no measurements", which
 * looks identical to a probe that measured nothing.
 *
 * Nothing here is called: the probe renders one component and reads its
 * geometry. If a future probe needs real data, that is the point to stop
 * stubbing rather than to grow this file.
 */
export const db = {};
export const auth = { currentUser: null, onAuthStateChanged: () => () => {} };
export const googleProvider = {};
export const analytics = null;
