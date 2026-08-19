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
import { bestTierFor, isAllowedRedirect, liveConnection, rateDecision, registeredRedirectUris, RATE_PER_MINUTE, RATE_PER_HOUR, sha256, sha256b64url } from "../lib/mcp.js";

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

// ---------------------------------------------------------------------------
// 4. The MCP service — the pieces where being wrong is silent
//
// The JSON-RPC handler itself needs a signed ID token to exercise, which this
// harness cannot mint (same limit as §3). What is covered is the decoding and
// bounding that every tool result passes through, plus the protocol versions we
// claim to speak.
// ---------------------------------------------------------------------------

const { decode, decodeFields, clampLimit, SUPPORTED_PROTOCOLS, TOOLS, stripHtml, subtaskTitleMatches } = await import("../lib/mcpServer.js");

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

// ---------------------------------------------------------------------------
// 5. Shaping — where a wrong answer is worse than an error
//
// These tools exist so an assistant can reason about a roadmap. A date it
// cannot convert, or a "working days" count that disagrees with the app, is not
// a broken feature — it is a confidently wrong answer to a customer's question.
// ---------------------------------------------------------------------------

const { dayToISO, isoToDay, businessDays, fold, overlaps } = await import("../lib/mcpServer.js");

// Day indices are offsets from 2020-01-01 UTC. An assistant seeing `x: 2400`
// has no way to convert, so every date crosses the boundary as ISO.
assert(dayToISO(0) === "2020-01-01", "dates: day 0 is the epoch");
assert(dayToISO(366) === "2021-01-01", "dates: 2020 was a leap year — 366 days, not 365");
assert(isoToDay("2020-01-01") === 0 && isoToDay(dayToISO(1234)) === 1234, "dates: the round trip is exact");

// 2026-08-17 is a Monday, so a 7-day span from it holds 5 weekdays.
const mon = isoToDay("2026-08-17");
assert(businessDays(mon, 7, false) === 5, "elapsed: a calendar week is five working days");
assert(businessDays(mon, 7, true) === 7, "elapsed: weekends count when the task opts in");
assert(businessDays(isoToDay("2026-08-22"), 2, false) === 0, "elapsed: a pure weekend is zero working days");

// Search folding, so "analisis" finds "análisis" — same rule as the help panel.
assert(fold("Análisis") === "analisis", "search: accents fold");
assert(fold("BLOCKED") === "blocked", "search: case folds");
assert(fold(null) === "" && fold(undefined) === "", "search: absent values fold to empty, not 'null'");

// Window overlap is inclusive at both ends: a task finishing on the first day
// of the window is still in it, and excluding it would silently hide work that
// is finishing right now — the thing most likely to be asked about.
const task = { x: isoToDay("2026-09-01"), duration: 10 };
assert(overlaps(task, isoToDay("2026-09-05"), isoToDay("2026-09-06")), "window: a task spanning the window is included");
assert(overlaps(task, isoToDay("2026-09-11"), isoToDay("2026-09-20")), "window: inclusive at the end — finishing today counts");
assert(overlaps(task, isoToDay("2026-08-01"), isoToDay("2026-09-01")), "window: inclusive at the start");
assert(!overlaps(task, isoToDay("2026-09-12"), isoToDay("2026-09-20")), "window: a task that ended before it is excluded");
assert(!overlaps(task, isoToDay("2026-08-01"), isoToDay("2026-08-31")), "window: a task starting after it is excluded");


// ---------------------------------------------------------------------------
// MC10 — the entitlement resolver.
//
// Unreachable as a denial today (every tier is allowed), which is exactly why it
// is worth testing: the day someone edits MCP_TIERS, this is the logic that
// decides who keeps their connection. "Best across workspaces" is the part that
// must not regress — a paid team member judged by their free personal workspace
// would be refused a feature they pay for.
// ---------------------------------------------------------------------------
{
  const mk = async (uid, personalWs, pulses, billing) => {
    await db.doc(`users/${uid}`).set({ uid, personalWorkspaceId: personalWs });
    for (const [pid, ws] of pulses) await db.doc(`users/${uid}/myPulses/${pid}`).set({ pulseId: pid, workspaceId: ws });
    for (const [ws, doc] of billing) await db.doc(`billing/${ws}`).set(doc);
  };

  await mk("t_solo", "ws_solo", [], []);
  assert((await bestTierFor(db, "t_solo")) === "starter", "tier: no billing doc is starter");

  await mk("t_paid", "ws_paid", [], [["ws_paid", { tier: "pro", status: "active" }]]);
  assert((await bestTierFor(db, "t_paid")) === "pro", "tier: an active subscription confers its tier");

  // The case the resolver exists for: free personally, on a paid team.
  await mk("t_guest", "ws_free", [["p1", "ws_team"]], [
    ["ws_free", { tier: "starter", status: "active" }],
    ["ws_team", { tier: "business", status: "active" }],
  ]);
  assert((await bestTierFor(db, "t_guest")) === "business", "tier: the best workspace wins, not the personal one");

  await mk("t_lapsed", "ws_lapsed", [], [["ws_lapsed", { tier: "business", status: "canceled" }]]);
  assert((await bestTierFor(db, "t_lapsed")) === "starter", "tier: a canceled subscription confers nothing");

  // past_due still holds — mirrors planTierOf in firestore.rules. Cutting a
  // customer off mid-dunning is a support incident, not enforcement.
  await mk("t_due", "ws_due", [], [["ws_due", { tier: "pro", status: "past_due" }]]);
  assert((await bestTierFor(db, "t_due")) === "pro", "tier: past_due still holds its tier");
}

// Subtask shaping. Notes are rich text, and markup reaching an assistant is
// noise it will try to interpret.
assert(stripHtml("<p>Ship the <b>API</b></p>") === "Ship the API", "subtasks: tags are stripped");
assert(stripHtml("a<br>b") === "a b", "subtasks: a line break becomes a space, not a join");
assert(stripHtml("R&amp;D &lt;spec&gt;") === "R&D <spec>", "subtasks: entities decode to characters");
assert(stripHtml(undefined) === "" && stripHtml(null) === "", "subtasks: absent notes are empty, not 'undefined'");

const withKids = { children: [{ title: "Diseño de API" }, { title: "Tests" }] };
assert(subtaskTitleMatches(withKids, "diseno"), "subtasks: search folds accents in subtask titles too");
assert(!subtaskTitleMatches(withKids, "deploy"), "subtasks: a non-match is a non-match");
assert(!subtaskTitleMatches({}, "x"), "subtasks: a task with no children never matches");

// ---------------------------------------------------------------------------
// MP2/MP3 — redirect validation. The one place a mistake hands a live
// authorization code to somebody else, so the near-misses matter more than the
// happy path.
// ---------------------------------------------------------------------------
assert(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback"), "redirect: Claude's callback");
assert(isAllowedRedirect("https://claude.com/api/mcp/auth_callback"), "redirect: claude.com");
assert(isAllowedRedirect("https://chatgpt.com/connector_platform_oauth_redirect"), "redirect: ChatGPT's callback");
// ChatGPT mints a distinct path per connector, which is why MP2 pins the host.
assert(isAllowedRedirect("https://chatgpt.com/connector_platform_oauth_redirect/abc123"), "redirect: any path on a known host");

// The exact reason prefix matching was replaced. Every one of these passes a
// naive startsWith against the old constants.
assert(!isAllowedRedirect("https://claude.ai.evil.test/api/mcp/auth_callback"), "redirect: a suffixed lookalike host is refused");
assert(!isAllowedRedirect("https://evil.test/?x=https://claude.ai/api/mcp/auth_callback"), "redirect: the target in a query string is refused");
assert(!isAllowedRedirect("https://notchatgpt.com/x"), "redirect: an unrelated host is refused");
assert(!isAllowedRedirect("https://sub.chatgpt.com/x"), "redirect: subdomains are not implied");
assert(!isAllowedRedirect("http://claude.ai/api/mcp/auth_callback"), "redirect: plain http on a public host is refused");
assert(!isAllowedRedirect("javascript:alert(1)"), "redirect: a non-http scheme is refused");
assert(!isAllowedRedirect("not a url"), "redirect: unparseable is refused");
assert(!isAllowedRedirect(""), "redirect: empty is refused");
assert(!isAllowedRedirect(null) && !isAllowedRedirect(undefined), "redirect: absent is refused");

// Loopback stays usable for desktop and CLI clients, http included.
assert(isAllowedRedirect("http://localhost:8976/callback"), "redirect: loopback on localhost");
assert(isAllowedRedirect("http://127.0.0.1:51000/cb"), "redirect: loopback on 127.0.0.1");
assert(isAllowedRedirect("http://[::1]:8080/cb"), "redirect: loopback on IPv6");
// http, not https — RFC 8252 §7.3, and pinned above too. Asserted from both
// directions so a future rewrite cannot quietly widen it.
assert(!isAllowedRedirect("https://127.0.0.1:8080/cb"), "redirect: https loopback stays refused");

// MP3 — a registered client is held to what it declared.
{
  await db.doc("mcpClients/c_known").set({
    clientId: "c_known",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect/one"],
  });
  const uris = await registeredRedirectUris(db, "c_known");
  assert(uris?.length === 1, "registration: declared URIs are read back");
  assert(uris.includes("https://chatgpt.com/connector_platform_oauth_redirect/one"), "registration: exact URI preserved");
  // Null means "never registered", which falls back to host policy — NOT a
  // failure, or clients with a fixed client_id could never connect.
  assert((await registeredRedirectUris(db, "c_unknown")) === null, "registration: an unknown client is null, not empty");
  assert((await registeredRedirectUris(db, "")) === null, "registration: a missing client_id is null");
  assert((await registeredRedirectUris(db, undefined)) === null, "registration: an absent client_id is null");
}

// ---------------------------------------------------------------------------
// MC29 — the rate limiter's arithmetic. Pure, so it is tested against a fixed
// clock rather than by waiting a minute.
// ---------------------------------------------------------------------------
{
  const T = 1_800_000_000_000; // fixed "now"
  const minuteKey = Math.floor(T / 60_000);
  const hourKey = Math.floor(T / 3_600_000);

  assert(rateDecision(undefined, T).allowed, "rate: a connection that has never called is allowed");
  assert(rateDecision({}, T).allowed, "rate: empty state is allowed");

  // Counting starts at 1 for a fresh window, not 0 — an off-by-one here gives
  // away a free call every minute.
  const fresh = rateDecision(undefined, T);
  assert(fresh.patch.rate.minuteCount === 1 && fresh.patch.rate.minuteKey === minuteKey, "rate: a fresh window is seeded at 1");

  const under = { minuteKey, minuteCount: RATE_PER_MINUTE - 1, hourKey, hourCount: 5 };
  assert(rateDecision(under, T).allowed, "rate: one below the cap is allowed");

  const at = { minuteKey, minuteCount: RATE_PER_MINUTE, hourKey, hourCount: 5 };
  const refused = rateDecision(at, T);
  assert(!refused.allowed && refused.window === "minute", "rate: at the cap is refused");
  assert(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 60, "rate: retry-after is inside the window");
  // A refused call still counts, or a caller in a loop resets its own budget.
  assert(refused.patch.rate.minuteCount !== undefined, "rate: a refused call is still counted");

  // A stale key is a DIFFERENT window, so the old count is replaced, not added
  // to. Getting this wrong locks a connection out permanently.
  const stale = { minuteKey: minuteKey - 5, minuteCount: 9999, hourKey, hourCount: 1 };
  const rolled = rateDecision(stale, T);
  assert(rolled.allowed, "rate: a stale minute window does not carry its count forward");
  assert(rolled.patch.rate.minuteCount === 1 && rolled.patch.rate.minuteKey === minuteKey, "rate: the rolled window reseeds at 1");

  // The hourly window catches a caller who stays just under the per-minute cap.
  const hourly = { minuteKey, minuteCount: 0, hourKey, hourCount: RATE_PER_HOUR };
  const hourRefused = rateDecision(hourly, T);
  assert(!hourRefused.allowed && hourRefused.window === "hour", "rate: the hourly cap refuses independently");
  assert(hourRefused.retryAfterSeconds > 60, "rate: the hourly retry-after reflects the longer window");

  const staleHour = { minuteKey, minuteCount: 0, hourKey: hourKey - 1, hourCount: RATE_PER_HOUR };
  assert(rateDecision(staleHour, T).allowed, "rate: a stale hour window does not carry forward either");

  // Nested map, not dotted keys — dotted keys in a set() create a literal field
  // with a dot in its name and the counter silently never moves.
  assert(typeof fresh.patch.rate === "object" && !("rate.minuteCount" in fresh.patch), "rate: the patch is a nested map");
}

console.log(failed ? `\n${failed} assertion(s) FAILED` : "\nAll MCP assertions passed");
process.exit(failed ? 1 : 0);
