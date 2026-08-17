import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { liveConnection, touchConnection } from "./mcp";
import { log, logError } from "./lib/conventions";

// MCP — the service (MCP-Spec.md §1, §3, §5). Phase 0, read-only.
//
// MCP over HTTP is JSON-RPC 2.0, and the server half we need is three methods.
// That is implemented here rather than with @modelcontextprotocol/sdk: the SDK
// pulls seventeen dependencies — two web frameworks, a stdio process-spawner and
// the CLIENT side of SSE — into a Cloud Function that already has req/res, and
// Firebase installs from package.json without tree-shaking, so all of it lands
// in cold-start time. The trade is that protocol drift is now ours to track;
// the mitigation is testing against a real client early rather than at the end.

const FN = "MCP.server";

/** Protocol versions we knowingly speak. We echo the client's if it is one of
 * these, because our surface (tools only) is identical across them; otherwise we
 * answer with our newest and let the client decide whether to continue. */
export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0];

const SERVER_INFO = { name: "pulse", version: "0.1.0" };

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

interface Caller {
  uid: string;
  connectionId: string;
  scope: string;
  idToken: string;
}

/**
 * Who is calling, or null.
 *
 * Three things must all hold: the bearer verifies, it was minted for MCP (an
 * ordinary browser session token must not work here — it would be a way to use
 * a customer's login as an API key), and the connection is still alive.
 */
async function authenticate(authorization: string | undefined): Promise<Caller | null> {
  const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!idToken) return null;

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
  } catch {
    return null;
  }
  const connectionId = typeof decoded.connectionId === "string" ? decoded.connectionId : null;
  if (!decoded.mcp || !connectionId) return null;

  const connection = await liveConnection(getFirestore(), decoded.uid, connectionId);
  if (!connection) return null;

  return {
    uid: decoded.uid,
    connectionId,
    scope: typeof decoded.scope === "string" ? decoded.scope : "read",
    idToken,
  };
}

// ---------------------------------------------------------------------------
// Firestore, read AS THE CUSTOMER (§1)
//
// Through the REST API with the customer's own ID token, so `firestore.rules`
// evaluates exactly as it does for their browser. The Admin SDK is never used
// for customer data — using it here would silently bypass every rule and make
// this service a second, weaker copy of the permission model.
// ---------------------------------------------------------------------------

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "pulse-b9d96";
const REST_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Firestore REST wraps every value in a type tag. Unwrap to plain JSON so the
 * tools return something a reader can use rather than something a parser must. */
export function decode(value: Record<string, unknown>): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const arr = (value.arrayValue as { values?: Record<string, unknown>[] }).values ?? [];
    return arr.map(decode);
  }
  if ("mapValue" in value) {
    return decodeFields((value.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {});
  }
  return null;
}

export function decodeFields(fields: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));
}

/** List a collection as the customer. A rules denial surfaces as 403, which is
 * the correct answer and not an error to retry. */
async function listAsUser(caller: Caller, path: string, pageSize: number): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${REST_ROOT}/${path}?pageSize=${pageSize}`, {
    headers: { Authorization: `Bearer ${caller.idToken}` },
  });
  if (res.status === 403) return [];
  if (!res.ok) throw new Error(`firestore ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { documents?: { name: string; fields?: Record<string, Record<string, unknown>> }[] };
  return (body.documents ?? []).map((d) => ({
    id: d.name.split("/").pop(),
    ...decodeFields(d.fields ?? {}),
  }));
}

// ---------------------------------------------------------------------------
// Tools (§5). Every one is bounded — an assistant asked to "look at my roadmap"
// will enumerate it, and Firestore bills per document read.
// ---------------------------------------------------------------------------

const MAX_LIMIT = 200;
export const clampLimit = (raw: unknown, fallback: number) =>
  Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(Number(raw)) ? Number(raw) : fallback));

export const TOOLS = [
  {
    name: "list_pulses",
    description:
      "List the Pulses (project roadmaps) this user can access, with their role in each. " +
      "Use this first to find a pulseId for the other tools.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: `Max Pulses to return (default 50, max ${MAX_LIMIT}).` },
        includeHidden: { type: "boolean", description: "Include Pulses the user has hidden from their dashboard." },
      },
    },
  },
] as const;

async function callTool(caller: Caller, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_pulses": {
      const limit = clampLimit(args.limit, 50);
      // The customer's own dashboard index — the same list their browser reads,
      // and the only listable view of "Pulses I can access" (see the note at the
      // top of firestore.rules on why this is an index rather than a query).
      const rows = await listAsUser(caller, `users/${caller.uid}/myPulses`, limit);
      const visible = args.includeHidden ? rows : rows.filter((r) => !r.hidden && r.archived === undefined);
      return {
        pulses: visible.map((r) => ({
          pulseId: r.pulseId ?? r.id,
          name: r.name || "Untitled Pulse",
          role: r.role,
          archived: r.archivedAt != null,
        })),
        count: visible.length,
        note: visible.length === limit ? "Result was truncated at the limit." : undefined,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });

export const mcp = onRequest({ invoker: "public", cors: true }, async (req, res) => {
  // Discovery: point an unauthenticated client at where to get a token, in the
  // header OAuth clients look for. Without this they cannot start the flow.
  const authenticateHeader = `Bearer resource_metadata="https://pulse.yasdu.com/.well-known/oauth-protected-resource"`;

  if (req.method === "GET") {
    // Some clients probe with GET before POSTing. Answer plainly rather than
    // with a 405 they may treat as "server broken".
    res.status(200).json({ name: SERVER_INFO.name, version: SERVER_INFO.version, transport: "http" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json(rpcError(null, INVALID_REQUEST, "POST only"));
    return;
  }

  const body = req.body as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> } | undefined;
  if (!body || typeof body.method !== "string") {
    res.status(400).json(rpcError(body?.id, PARSE_ERROR, "Malformed JSON-RPC request"));
    return;
  }
  const { id, method, params = {} } = body;
  // A notification has no id and must get NO response body — answering one is a
  // protocol error that some clients treat as fatal.
  const isNotification = id === undefined;

  try {
    // `initialize` is answered before authenticating, so a client can discover
    // the server and then be told, in OAuth's own vocabulary, how to get a token.
    if (method === "initialize") {
      const asked = (params.protocolVersion as string) ?? LATEST_PROTOCOL;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST_PROTOCOL;
      res.json(rpcResult(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO }));
      return;
    }
    if (isNotification) {
      res.status(202).send("");
      return;
    }

    const caller = await authenticate(req.header("authorization"));
    if (!caller) {
      // 401 with WWW-Authenticate is what makes a client start the OAuth flow
      // rather than simply failing.
      res.set("WWW-Authenticate", authenticateHeader).status(401).json(rpcError(id, INVALID_REQUEST, "Not authenticated"));
      return;
    }

    if (method === "tools/list") {
      res.json(rpcResult(id, { tools: TOOLS }));
      return;
    }

    if (method === "tools/call") {
      const name = params.name as string;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        res.json(rpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${name}`));
        return;
      }
      // Phase 2: writes gate on caller.scope here as well as in rules.
      const out = await callTool(caller, name, (params.arguments as Record<string, unknown>) ?? {});
      void touchConnection(getFirestore(), caller.uid, caller.connectionId);
      log(FN, "tool called", { uid: caller.uid, connectionId: caller.connectionId, tool: name });
      // Tool results are content blocks, not raw JSON — text is what every
      // client renders, and the assistant reads JSON in it perfectly well.
      res.json(rpcResult(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] }));
      return;
    }

    res.json(rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`));
  } catch (err) {
    logError(FN, "request failed", err, { method });
    res.status(500).json(rpcError(id, INTERNAL_ERROR, "Internal error"));
  }
});

// ---------------------------------------------------------------------------
// OAuth discovery (MCP-Spec §8)
//
// A client that gets our 401 follows `WWW-Authenticate` to these documents to
// learn where to send the customer and where to exchange the code. Without them
// the 401 is a dead end — which is exactly what it was until the live probe
// showed this URL returning the SPA's index.html.
//
// Served from a function rather than `public/.well-known/`, because hosting's
// ignore rule (`**/.*`) silently drops dot-directories from the deploy: the
// files would exist in the repo, pass review, and never ship.
// ---------------------------------------------------------------------------

// Everything on ONE origin. Hosting rewrites map these to the functions, so a
// client sees a single authorization server and a customer sees only the
// product's own domain. An issuer whose token endpoint lives somewhere else is
// an arrangement some clients reject rather than follow.
const ISSUER = "https://pulse.yasdu.com";
const MCP_URL = `${ISSUER}/mcp`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const REGISTER_URL = `${ISSUER}/oauth/register`;

export const mcpMetadata = onRequest({ invoker: "public", cors: true }, (req, res) => {
  res.set("Cache-Control", "public, max-age=3600");

  if (req.path.endsWith("/oauth-protected-resource")) {
    res.json({ resource: MCP_URL, authorization_servers: [ISSUER], scopes_supported: ["read"] });
    return;
  }

  if (req.path.endsWith("/oauth-authorization-server")) {
    res.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: TOKEN_URL,
      registration_endpoint: REGISTER_URL,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // S256 only. Advertising `plain` would let a client downgrade PKCE to
      // nothing, which is the whole protection on a code that travels through a
      // browser redirect.
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read"],
    });
    return;
  }

  // Dynamic client registration (RFC 7591). Stubbed on purpose: client identity
  // is not a boundary here — consent, PKCE and the redirect allowlist are — and
  // we already accept any client_id. Issuing one without storing it is therefore
  // honest rather than lax, and it is what lets clients that require DCR
  // complete discovery at all.
  if (req.path.endsWith("/register")) {
    const body = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
    res.status(201).json({
      client_id: `pulse-mcp-${Date.now().toString(36)}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
    });
    return;
  }

  res.status(404).json({ error: "not_found" });
});
