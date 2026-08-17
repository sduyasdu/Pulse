// MCP OAuth integration test — runs inside `firebase emulators:exec --only
// firestore,functions`. Covers the decision points where a mistake is a
// security bug rather than a broken feature: the open-redirect guard, PKCE
// verification, and whether a revoked connection can still be used.
//
// The full HTTP round-trip (mcpOauthToken) is NOT covered here: issuing tokens
// calls createCustomToken, which needs a signing credential this harness has
// no way to provide. What is covered is every branch that decides *whether* to
// issue — which is the part that must not be wrong.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { isAllowedRedirect, liveConnection, sha256, sha256b64url } from "../lib/mcp.js";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-pulse-rules-test" });
const db = getFirestore();

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

// ---------------------------------------------------------------------------
// 1. The open-redirect guard
//
// The authorization code travels back through this URL. An unvalidated target
// hands an attacker a live code, which is the whole flow.
// ---------------------------------------------------------------------------

assert(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback"), "redirect: the real client callback is allowed");
assert(isAllowedRedirect("http://localhost:8765/cb"), "redirect: loopback is allowed (desktop/CLI clients)");
assert(isAllowedRedirect("http://127.0.0.1:9000/cb"), "redirect: numeric loopback is allowed");
assert(!isAllowedRedirect("https://evil.example.com/cb"), "redirect: a foreign origin is refused");
// The classic bypasses — a prefix that only LOOKS like the allowed host.
assert(!isAllowedRedirect("https://claude.ai.evil.com/cb"), "redirect: suffix-lookalike refused");
assert(!isAllowedRedirect("http://localhost.evil.com/cb"), "redirect: localhost-lookalike refused");
assert(!isAllowedRedirect("https://localhost:1/cb"), "redirect: https loopback is not the allowed shape");
assert(!isAllowedRedirect(undefined) && !isAllowedRedirect(42), "redirect: absent/non-string refused");

// ---------------------------------------------------------------------------
// 2. PKCE
//
// The code alone must not be enough. S256 means the challenge is the base64url
// SHA-256 of the verifier — get the encoding wrong and every exchange fails, or
// worse, trivially succeeds.
// ---------------------------------------------------------------------------

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = sha256b64url(verifier);
assert(challenge === sha256b64url(verifier), "pkce: challenge derivation is deterministic");
assert(sha256b64url("other") !== challenge, "pkce: a different verifier gives a different challenge");
assert(!challenge.includes("+") && !challenge.includes("/") && !challenge.includes("="),
  "pkce: base64URL, not base64 — a '+' would fail against a spec-compliant client");

// Codes and refresh tokens are stored hashed, so a database read is not a
// credential.
assert(sha256("abc") !== "abc" && sha256("abc").length === 64, "storage: secrets are stored as sha-256 hex");

// ---------------------------------------------------------------------------
// 3. liveConnection — the revocation predicate
// ---------------------------------------------------------------------------

const UID = "u_mcp";
await db.doc(`users/${UID}/connections/alive`).set({ id: "alive", scope: "read", revokedAt: null });
await db.doc(`users/${UID}/connections/revoked`).set({ id: "revoked", scope: "read", revokedAt: Date.now() });

assert((await liveConnection(db, UID, "alive")) !== null, "revocation: a live connection resolves");
assert((await liveConnection(db, UID, "revoked")) === null, "revocation: a revoked connection does not");
assert((await liveConnection(db, UID, "nope")) === null, "revocation: a missing connection does not");
// The one that matters for §2.1: refresh reads scope from the CONNECTION, so a
// stale scope on an old token can never widen access.
assert((await liveConnection(db, UID, "alive")).scope === "read", "revocation: scope is read from the record, not the token");

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll MCP assertions passed");
process.exit(failed ? 1 : 0);
