import { describe, expect, it } from "vitest";
import { servesAppShell } from "./swRoutes";

/**
 * The service worker's navigation fallback turns every unrecognised same-origin
 * navigation into index.html. These fix which paths that is allowed to happen
 * to, because the failure mode is invisible: the app keeps working while
 * sign-in, or the MCP surface a customer's assistant talks to, quietly returns
 * an HTML page to something expecting JSON.
 */

describe("paths the service worker must leave alone", () => {
  // The one that breaks sign-in. signInWithPopup navigates the popup here.
  it.each([
    "/__/auth/handler",
    "/__/auth/iframe",
    "/__/firebase/init.json",
  ])("passes %s through to Firebase Auth", (p) => {
    expect(servesAppShell(p)).toBe(false);
  });

  // Cloud Functions behind hosting rewrites — customer-facing.
  it.each([
    "/mcp",
    "/oauth/token",
    "/oauth/register",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openai-apps",
  ])("passes %s through to its function", (p) => {
    expect(servesAppShell(p)).toBe(false);
  });
});

describe("paths that are the app", () => {
  // The trap: it sits among /oauth/token and /oauth/register but is an SPA
  // route — the consent screen. firebase.json calls this out at its own
  // catch-all, and a denylist of /^\/oauth/ would take the page away from it.
  it("still serves the app for /oauth/authorize", () => {
    expect(servesAppShell("/oauth/authorize")).toBe(true);
    expect(servesAppShell("/oauth/authorize?client_id=x&state=y")).toBe(true);
  });

  it.each([
    "/",
    "/login",
    "/p/abc123",
    "/join/tok3n",
    "/invite/pulse1",
    "/people",
  ])("serves the app shell for %s", (p) => {
    expect(servesAppShell(p)).toBe(true);
  });
});
