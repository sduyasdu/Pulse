/**
 * Same-origin paths the service worker must NOT answer with the SPA shell.
 *
 * The worker's navigation fallback exists so that a reload with no connection
 * gets index.html out of the cache instead of the browser's "This site can't be
 * reached". But a fallback is indiscriminate by nature: every same-origin
 * navigation it does not recognise becomes index.html, and this origin serves
 * several things that are emphatically not the app.
 *
 * Getting this wrong fails silently and badly — the app looks perfectly healthy
 * while sign-in or the customer-facing MCP surface stops working — so the list
 * lives here, next to a test, rather than inline in the build config.
 */
export const NAVIGATION_DENYLIST: RegExp[] = [
  // Firebase Auth's handler and helper iframe, served by Hosting under the
  // reserved namespace. `signInWithPopup` navigates the popup to
  // /__/auth/handler; answer that with index.html and Google sign-in breaks.
  /^\/__\//,
  // The MCP server and the OAuth endpoints it needs, all Cloud Functions behind
  // hosting rewrites (firebase.json). These are customer-facing.
  /^\/mcp/,
  /^\/oauth\/(register|token)/,
  /^\/\.well-known\//,
];

/**
 * Would a navigation to `path` be served the SPA shell?
 *
 * Note what is deliberately NOT denied: `/oauth/authorize`. It looks like the
 * sibling of /oauth/token and /oauth/register, and it is not — it is an SPA
 * route (the consent screen the user sees), and firebase.json says so at its
 * own catch-all. A denylist of `/^\/oauth/` would take the app's own page away
 * from it.
 */
export function servesAppShell(path: string): boolean {
  return !NAVIGATION_DENYLIST.some((re) => re.test(path));
}
