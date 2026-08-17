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
// The customer's AI client keeps the refresh token; Pulse stores only a hash of
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
 * — to somewhere they don't control. */
const ALLOWED_REDIRECT_PREFIXES = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  // Desktop and CLI clients complete the loop on a loopback port they own.
  "http://localhost:",
  "http://127.0.0.1:",
];

export function isAllowedRedirect(uri: unknown): boolean {
  return typeof uri === "string" && ALLOWED_REDIRECT_PREFIXES.some((p) => uri.startsWith(p));
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

  log(FN, "connection approved", { uid, connectionId: connectionRef.id, scope });
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
 * token Pulse stores **only as a hash** (§2.1).
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
  // stored only as a hash, so what Pulse holds cannot be replayed.
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

/**
 * Marks a connection used, so `lastUsedAt` means something in the customer's
 * list (MC12). Called by the MCP service, not the client.
 *
 * Separate from the token endpoint because refreshing is not using — a client
 * that renews hourly while nobody asks it anything should still look idle.
 */
export async function touchConnection(db: Db, uid: string, connectionId: string): Promise<void> {
  await db
    .doc(`users/${uid}/connections/${connectionId}`)
    .set({ lastUsedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {
      /* best effort — a missed timestamp must never fail a customer's request */
    });
}
