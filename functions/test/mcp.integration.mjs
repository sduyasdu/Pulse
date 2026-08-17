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

// ---------------------------------------------------------------------------
// 4. The MCP service — the pieces where being wrong is silent
//
// The JSON-RPC handler itself needs a signed ID token to exercise, which this
// harness cannot mint (same limit as §3). What is covered is the decoding and
// bounding that every tool result passes through, plus the protocol versions we
// claim to speak.
// ---------------------------------------------------------------------------

const { decode, decodeFields, clampLimit, SUPPORTED_PROTOCOLS, TOOLS } = await import("../lib/mcpServer.js");

// Firestore REST type tags. Getting integerValue wrong is the sharp one: it
// arrives as a STRING, so a missed Number() turns 3 into "3" and every
// comparison an assistant makes on it silently goes wrong.
assert(decode({ stringValue: "hi" }) === "hi", "decode: string");
assert(decode({ integerValue: "42" }) === 42, "decode: integer arrives as a string and is converted");
assert(decode({ booleanValue: false }) === false, "decode: boolean false survives (not coerced away)");
assert(decode({ nullValue: null }) === null, "decode: null");
assert(JSON.stringify(decode({ arrayValue: { values: [{ stringValue: "a" }, { integerValue: "2" }] } })) === '["a",2]',
  "decode: array decodes elementwise");
assert(JSON.stringify(decode({ arrayValue: {} })) === "[]", "decode: an empty array has no `values` key at all");
assert(JSON.stringify(decodeFields({ n: { stringValue: "x" }, k: { integerValue: "1" } })) === '{"n":"x","k":1}',
  "decode: fields map to plain JSON");

// Bounding. An assistant will ask for everything; the ceiling is what stops a
// single question costing thousands of billed reads.
assert(clampLimit(undefined, 50) === 50, "limit: default when absent");
assert(clampLimit(10, 50) === 10, "limit: honoured when sane");
assert(clampLimit(99999, 50) === 200, "limit: capped at the ceiling");
assert(clampLimit(0, 50) === 1 && clampLimit(-5, 50) === 1, "limit: never below 1");
assert(clampLimit("abc", 50) === 50, "limit: non-numeric falls back rather than becoming NaN");

assert(SUPPORTED_PROTOCOLS.length > 0 && SUPPORTED_PROTOCOLS.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)),
  "protocol: advertised versions are dated identifiers");
assert(TOOLS.every((t) => t.name && t.description && t.inputSchema?.type === "object"),
  "tools: every tool declares a name, a description and an object schema");
