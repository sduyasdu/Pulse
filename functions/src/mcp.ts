import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { log, logError } from "./lib/conventions";

// MCP — the OAuth half (MCP-Spec.md §2, §2.1, §3). Phase 0.
//
// The spine (§1): the MCP service acts as the CUSTOMER, never as an admin, so
// `firestore.rules` stays the only authorization boundary. The Admin SDK appears
// here and nowhere else in the MCP surface — to mint a custom token for the user
// who just consented, and to write the server-owned fields of their connection
// record.
//
// The customer's AI client keeps the refresh token; Beat stores only a hash of
// it (§2.1), so a breach of this project yields nothing replayable.

type Db = FirebaseFirestore.Firestore;

const FN = "MCP.oauth";

/** The Firebase **Web** API key — the one already shipped in the browser bundle
 * and therefore public. Needed to exchange a custom token for an ID token
 * (`issueTokens`), because Identity Toolkit's REST endpoint is keyed. Declared
 * as a param rather than hardcoded so it travels with configuration, not code.
 *
 * `PULSE_` not `FIREBASE_`: the latter is a reserved prefix and makes the entire
 * functions .env fail to load. */
const WEB_API_KEY = defineString("PULSE_WEB_API_KEY");

/** How long an unused authorization code lives. Short on purpose: it is a
 * single-use bearer that sits in a redirect URL, i.e. in browser history. */
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/** Access tokens are Firebase ID tokens, which expire in an hour regardless.
 * Stated here because §3's revocation guarantee is expressed in terms of it. */
const ACCESS_TOKEN_TTL_S = 3600;

/** Where a consenting browser is allowed to send the customer afterwards.
 * Same reasoning as billing's return-URL allowlist: an unvalidated redirect
 * hands an attacker a way to bounce a customer — with a live authorization code
 * — to somewhere they don't control.
 *
 * Hosts we will hand a live authorization code to (MCP-Publishing-Spec MP6).
 *
 * **Copied from each vendor, never guessed.** A wrong origin in a security
 * control is worse than a missing one: it looks handled. Google's is absent
 * because it is not published — take it from the submission portal when there
 * is one, and add it here.
 *
 * Exact hostnames, so `claude.ai.evil.test` is not a match. */
const ALLOWED_REDIRECT_HOSTS = new Set([
  "claude.ai",
  "claude.com",
  "chatgpt.com", // e.g. /connector_platform_oauth_redirect — path varies per connector
]);

/** Desktop and CLI clients complete the loop on a port they own. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Is this somewhere we will send the customer, carrying a code?
 *
 * **Parsed, not prefix-matched.** The old form was `uri.startsWith(...)`, which
 * is the standard way to end up accepting `https://claude.ai.evil.test/...`;
 * comparing a parsed `hostname` removes the class rather than the instance.
 *
 * It pins the host and no longer the path, because ChatGPT mints a distinct
 * callback path per connector and a path-pinned list cannot express that. The
 * exact-match against registered redirect URIs (MP3, in approveMcpConnection) is
 * what compensates.
 */
export function isAllowedRedirect(uri: unknown): boolean {
  if (typeof uri !== "string" || !uri) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // URL keeps IPv6 brackets
  // Loopback is http, per RFC 8252 §7.3 for native apps — and an existing test
  // pins it. The parsed rewrite briefly allowed https here too; nothing asked
  // for it, and widening a redirect rule for no caller is how one drifts open.
  if (LOOPBACK_HOSTS.has(host)) return url.protocol === "http:";
  if (url.protocol !== "https:") return false;
  return ALLOWED_REDIRECT_HOSTS.has(url.hostname);
}

/**
 * The redirect URIs a client declared when it registered (RFC 7591), or null if
 * it never registered.
 *
 * Null is NOT a failure: clients using a fixed `client_id` never call the
 * registration endpoint, and requiring it would be a flag day for them. So this
 * strengthens the clients that do register — which is all three vendor
 * directories — without breaking the ones that don't. Consent and PKCE remain
 * the boundary; this is depth behind them.
 */
export async function registeredRedirectUris(db: Db, clientId: unknown): Promise<string[] | null> {
  if (typeof clientId !== "string" || !clientId) return null;
  const snap = await db.doc(`mcpClients/${encodeURIComponent(clientId)}`).get();
  if (!snap.exists) return null;
  const uris = snap.data()?.redirectUris;
  return Array.isArray(uris) && uris.length ? (uris as string[]) : null;
}

// ---------------------------------------------------------------------------
// Entitlement (MC10)
//
// Connecting an assistant is open to every tier today. The check exists anyway,
// wired into the consent path from the start, because the alternative is adding
// it later — and the consent path is the one place a mistake locks customers out
// of a connection they have already approved.
//
// **To gate it, edit MCP_TIERS. That is the whole change.**
//
// Note the tension to resolve before doing so: Plans-Spec §3 says every tier has
// every feature and tiers differ only by quantity. A tier allow-list here would
// be the first feature gate in the product. A per-tier **limit on connected
// assistants** would fit the existing model instead, and this function gives you
// the tier either way.
// ---------------------------------------------------------------------------

type Tier = "starter" | "pro" | "business";

/** Which tiers may connect an assistant. Every tier, deliberately (MC10). */
const MCP_TIERS: Tier[] = ["starter", "pro", "business"];

const TIER_RANK: Record<Tier, number> = { starter: 0, pro: 1, business: 2 };

/** A subscription only confers its tier while it is holding. Mirrors
 * `planTierOf` in firestore.rules — keep the two in step. */
const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

/** How many distinct workspaces we will price-check for one user. Far above any
 * real roster; present so an unusual account cannot turn consent into a hundred
 * reads. */
const MAX_WORKSPACES_CHECKED = 25;

/**
 * The best tier this user has access to, across every workspace they belong to.
 *
 * **Best, not personal.** A connection is per-user and its tools span every Beat
 * the user can reach, which may cross workspaces — so someone on a paid team
 * should not be judged by their own free personal workspace. Generosity is also
 * the safer error here: wrongly denying consent breaks a feature the customer is
 * entitled to, wrongly allowing it costs bounded reads (§5).
 *
 * Workspaces are enumerated from the user's own dashboard index rather than a
 * collection-group query, so this needs no extra Firestore index.
 */
export async function bestTierFor(db: Db, uid: string): Promise<Tier> {
  const [userSnap, myPulses] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.collection(`users/${uid}/myPulses`).limit(200).get(),
  ]);

  const workspaceIds = new Set<string>();
  const personal = userSnap.data()?.personalWorkspaceId;
  if (typeof personal === "string" && personal) workspaceIds.add(personal);
  for (const d of myPulses.docs) {
    const ws = d.data()?.workspaceId;
    if (typeof ws === "string" && ws) workspaceIds.add(ws);
  }

  const ids = [...workspaceIds].slice(0, MAX_WORKSPACES_CHECKED);
  const billing = await Promise.all(ids.map((id) => db.doc(`billing/${id}`).get()));

  let best: Tier = "starter";
  for (const snap of billing) {
    const d = snap.data();
    if (!d || !ACTIVE_STATUSES.includes(String(d.status ?? "canceled"))) continue;
    const tier = String(d.tier ?? "starter") as Tier;
    if (TIER_RANK[tier] > TIER_RANK[best]) best = tier;
  }
  return best;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Base64url, because PKCE's S256 challenge is compared in that encoding. */
export const sha256b64url = (s: string) => createHash("sha256").update(s).digest("base64url");

/** Constant-time compare of two hex digests, so a token hash can't be probed
 * a byte at a time. */
function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Step 1 — the customer consents, in the app, signed in.
 *
 * Deliberately a **callable, invoked from the `/oauth/authorize` route** rather
 * than an HTTP endpoint doing its own login: only the app knows who is signed
 * in, and re-implementing a session here would be a second auth path to keep
 * correct.
 *
 * Returns an authorization code for the client to exchange. The connection
 * record is created now, so it appears in the customer's list the moment they
 * approve — even if the client never completes the exchange.
 */
export const approveMcpConnection = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to connect an assistant.");

  const redirectUri = request.data?.redirectUri;
  if (!isAllowedRedirect(redirectUri)) {
    throw new HttpsError("invalid-argument", "That redirect target is not allowed.");
  }
  // PKCE is required, not optional: without it a stolen code is enough, and the
  // code travels through a browser redirect.
  const codeChallenge = request.data?.codeChallenge;
  if (typeof codeChallenge !== "string" || codeChallenge.length < 32) {
    throw new HttpsError("invalid-argument", "A PKCE code challenge is required.");
  }
  const name = typeof request.data?.name === "string" && request.data.name.trim()
    ? request.data.name.trim().slice(0, 60)
    : "AI assistant";
  const client = typeof request.data?.client === "string" ? request.data.client.slice(0, 120) : null;

  // v1 issues read only (MC5). Accepting the parameter now keeps the client
  // contract stable when write lands.
  const scope = request.data?.scope === "write" ? "write" : "read";
  if (scope === "write") {
    throw new HttpsError("failed-precondition", "Write access is not available yet.");
  }

  const db = getFirestore();

  // MP3: if this client registered, the redirect must be one it declared. An
  // exact string match — OAuth redirect comparison is character-for-character,
  // and "close enough" is how a code reaches somewhere it should not.
  const declared = await registeredRedirectUris(db, request.data?.clientId);
  if (declared && !declared.includes(redirectUri)) {
    log(FN, "connection refused — unregistered redirect", { uid, clientId: request.data?.clientId });
    throw new HttpsError("invalid-argument", "That redirect target is not registered for this client.");
  }

  // MC10. Passes for everyone today; the point is that the code path, the log
  // line and the error shape all exist before they are ever needed.
  const tier = await bestTierFor(db, uid);
  if (!MCP_TIERS.includes(tier)) {
    log(FN, "connection refused — tier", { uid, tier });
    // When this becomes reachable it needs an i18n key: AuthorizePage renders
    // the server's message verbatim, and an untranslated sentence on the consent
    // screen is a customer-facing English string in a six-language product.
    throw new HttpsError("permission-denied", "Connecting an AI assistant is not included in your plan.");
  }

  const connectionRef = db.collection(`users/${uid}/connections`).doc();
  const code = randomBytes(32).toString("base64url");

  await db.doc(`users/${uid}/connections/${connectionRef.id}`).set({
    id: connectionRef.id,
    name,
    ...(client ? { client } : {}),
    scope,
    createdAt: Date.now(),
    revokedAt: null,
  });

  // The code is stored hashed and server-side; only its plaintext travels.
  await db.doc(`mcpAuthCodes/${sha256(code)}`).set({
    uid,
    connectionId: connectionRef.id,
    scope,
    codeChallenge,
    redirectUri,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });

  log(FN, "connection approved", { uid, connectionId: connectionRef.id, scope, tier });
  return { code };
});

/** The connection, if it is alive. Null for missing or revoked — the two are
 * the same answer to the only question callers ask. */
export async function liveConnection(db: Db, uid: string, connectionId: string) {
  const snap = await db.doc(`users/${uid}/connections/${connectionId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return data.revokedAt ? null : data;
}

/**
 * Mint the pair the client will hold: a one-hour access token, and a refresh
 * token Beat stores **only as a hash** (§2.1).
 *
 * The custom token carries `connectionId` and `scope` as claims. They are
 * re-minted here on every refresh rather than relied upon to survive one, so
 * nothing depends on whether the SDK preserves them — see MC14 for why that
 * failure mode was worth designing out rather than testing for.
 */
async function issueTokens(db: Db, uid: string, connectionId: string, scope: string) {
  const customToken = await getAuth().createCustomToken(uid, { connectionId, scope, mcp: true });

  // Exchange it for an **ID token**, because that is what the client will send
  // back as a Bearer and what `verifyIdToken` accepts. An earlier draft returned
  // the custom token itself, reasoning that the client could exchange it via the
  // Firebase SDK — but an MCP client knows nothing about Firebase. It would have
  // sent the custom token verbatim and been rejected on every call.
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY.value()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    throw new Error(`custom-token exchange failed: ${res.status} ${await res.text()}`);
  }
  const { idToken } = (await res.json()) as { idToken: string };

  // Our own refresh token, not Firebase's: it rotates on every use (§2.1) and is
  // stored only as a hash, so what Beat holds cannot be replayed.
  const refreshToken = randomBytes(48).toString("base64url");
  await db.doc(`mcpRefreshTokens/${sha256(refreshToken)}`).set({
    uid,
    connectionId,
    scope,
    createdAt: Date.now(),
  });

  return {
    access_token: idToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope,
  };
}

/**
 * Step 2 — the token endpoint. Issues on `authorization_code`, re-mints on
 * `refresh_token`.
 *
 * Public by necessity (the client is not a Firebase caller yet) and safe: every
 * grant is proved by a secret the caller already holds, and PKCE binds the code
 * to the client that started the flow.
 */
export const mcpOauthToken = onRequest({ invoker: "public", cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "invalid_request", error_description: "POST only" });
    return;
  }
  const db = getFirestore();
  const grant = req.body?.grant_type;

  try {
    if (grant === "authorization_code") {
      const code = req.body?.code;
      const verifier = req.body?.code_verifier;
      if (typeof code !== "string" || typeof verifier !== "string") {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const ref = db.doc(`mcpAuthCodes/${sha256(code)}`);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      const d = snap.data() ?? {};
      // Single use, whatever happens next.
      await ref.delete();

      if (typeof d.expiresAt === "number" && Date.now() > d.expiresAt) {
        res.status(400).json({ error: "invalid_grant", error_description: "code expired" });
        return;
      }
      if (sha256b64url(verifier) !== d.codeChallenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
      // Consent can be revoked between approving and exchanging.
      if (!(await liveConnection(db, d.uid, d.connectionId))) {
        res.status(400).json({ error: "invalid_grant", error_description: "connection revoked" });
        return;
      }

      log(FN, "code exchanged", { uid: d.uid, connectionId: d.connectionId });
      res.json(await issueTokens(db, d.uid, d.connectionId, d.scope));
      return;
    }

    if (grant === "refresh_token") {
      const presented = req.body?.refresh_token;
      if (typeof presented !== "string") {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const key = sha256(presented);
      const ref = db.doc(`mcpRefreshTokens/${key}`);
      const snap = await ref.get();
      if (!snap.exists || !hashesMatch(snap.id, key)) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      const d = snap.data() ?? {};

      // §2.1: revocation bites HERE. A revoked connection cannot renew, which is
      // what actually ends a session — the outstanding access token simply runs
      // out its remaining hour.
      const connection = await liveConnection(db, d.uid, d.connectionId);
      if (!connection) {
        await ref.delete();
        log(FN, "refresh refused — connection revoked", { uid: d.uid, connectionId: d.connectionId });
        res.status(400).json({ error: "invalid_grant", error_description: "connection revoked" });
        return;
      }

      // Rotate: the presented token dies with this response. A refresh token
      // that is replayable is a refresh token that is worth stealing.
      await ref.delete();
      // Scope is read from the connection, not from the old token — which is
      // what lets Phase 2 upgrade a read connection without re-approval.
      const scope = typeof connection.scope === "string" ? connection.scope : "read";
      res.json(await issueTokens(db, d.uid, d.connectionId, scope));
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  } catch (err) {
    logError(FN, "token endpoint failed", err, { grant: typeof grant === "string" ? grant : null });
    res.status(500).json({ error: "server_error" });
  }
});

// ---------------------------------------------------------------------------
// Rate limiting (MC29)
//
// An assistant in a loop is the plausible abuse case: it spends Beat's compute
// and the customer's Firestore reads at machine speed, and nothing else here
// stops it.
//
// The counters live on the **connection document**, which is the cheap place:
// `authenticate()` already reads it on every request, and marking the
// connection used already writes it, so a limiter costs no extra read and no
// extra write — the increment folds into the write that was happening anyway.
// `recordCall` below replaced the old `touchConnection`: one writer for this
// document, so the timestamp and the counters cannot drift apart.
//
// `FieldValue.increment` is doing real work — it is an atomic server-side
// operation, so two concurrent calls cannot both read 5 and both write 6. A
// transaction would be correct too and would cost a round trip on every call.
//
// **Known and accepted:** the count is read at the start of a request and
// written without waiting, so a genuine burst can overshoot the cap before it
// bites. That is the right trade for abuse prevention — this bounds runaway
// usage, it is not a billing quota and must not be described as one.
// ---------------------------------------------------------------------------

/** Two windows, because one is always the wrong one. A per-minute cap alone
 * lets a caller sit just under it forever; an hourly cap alone lets a loop burn
 * the whole allowance in seconds.
 *
 * These numbers are a starting point, not a measurement. An assistant answering
 * one question makes roughly 5–20 tool calls, so a minute's worth permits a fast
 * human asking repeatedly and stops a loop within a second or two. Revisit them
 * against the `tool called` log lines before treating them as tuned. */
export const RATE_PER_MINUTE = 60;
export const RATE_PER_HOUR = 1000;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface RateState {
  minuteKey?: number;
  minuteCount?: number;
  hourKey?: number;
  hourCount?: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Which window refused, for the message and the log. */
  window?: "minute" | "hour";
  /** Seconds until the refusing window rolls over. */
  retryAfterSeconds?: number;
  /** The merge payload to fold into the next write. Present even when refused —
   * a refused call still counts, or a caller in a loop would reset its own
   * budget by hammering the limit. */
  patch: Record<string, unknown>;
}

/**
 * Decide, and produce the counter update, from state already in hand.
 *
 * Pure and separately exported so the arithmetic — the part with the off-by-one
 * and the window-rollover bugs in it — is testable without an emulator, a clock
 * or a connection.
 */
export function rateDecision(state: RateState | undefined, nowMs: number): RateDecision {
  const minuteKey = Math.floor(nowMs / MINUTE_MS);
  const hourKey = Math.floor(nowMs / HOUR_MS);
  const s = state ?? {};

  // A stale key means the window rolled over: the old count is not "0 so far",
  // it is a different window entirely, so it is replaced rather than added to.
  const minuteCount = s.minuteKey === minuteKey ? (s.minuteCount ?? 0) : 0;
  const hourCount = s.hourKey === hourKey ? (s.hourCount ?? 0) : 0;

  // A NESTED map, not dotted keys. `rate.minuteCount` is only a field path in
  // `update()`; in a `set(..., {merge:true})` it creates a literal field whose
  // name contains a dot, and the counter silently never increments. Nested maps
  // deep-merge under `merge: true`, so writing only the minute fields leaves the
  // hour fields alone.
  const bump = (key: number, count: number, field: "minute" | "hour") =>
    count === 0
      ? { [`${field}Key`]: key, [`${field}Count`]: 1 }
      : { [`${field}Count`]: FieldValue.increment(1) };

  const patch = { rate: { ...bump(minuteKey, minuteCount, "minute"), ...bump(hourKey, hourCount, "hour") } };

  if (minuteCount >= RATE_PER_MINUTE) {
    return { allowed: false, window: "minute", retryAfterSeconds: Math.ceil(((minuteKey + 1) * MINUTE_MS - nowMs) / 1000), patch };
  }
  if (hourCount >= RATE_PER_HOUR) {
    return { allowed: false, window: "hour", retryAfterSeconds: Math.ceil(((hourKey + 1) * HOUR_MS - nowMs) / 1000), patch };
  }
  return { allowed: true, patch };
}

/** Record a call against the connection's windows. Merged with `lastUsedAt` so
 * this is one write, not two.
 *
 * Also what keeps `lastUsedAt` meaningful in the customer's connection list
 * (MC12): called on use, and deliberately NOT on refresh — a client that renews
 * hourly while nobody asks it anything should still look idle. */
export async function recordCall(db: Db, uid: string, connectionId: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .doc(`users/${uid}/connections/${connectionId}`)
    .set({ lastUsedAt: FieldValue.serverTimestamp(), ...patch }, { merge: true })
    .catch(() => {
      /* best effort, as above — losing a tick must not fail a customer request */
    });
}
