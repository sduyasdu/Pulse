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

/** Read one document as the customer. Null when rules refuse or it is gone —
 * both mean "you cannot see this", which is the same answer to a tool. */
async function getAsUser(caller: Caller, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${REST_ROOT}/${path}`, { headers: { Authorization: `Bearer ${caller.idToken}` } });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as { name: string; fields?: Record<string, Record<string, unknown>> };
  return { id: d.name.split("/").pop(), ...decodeFields(d.fields ?? {}) };
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
// Shaping (§5): return what a reader can use, not what the database stores.
// ---------------------------------------------------------------------------

/** Pulse stores a task's start as an integer day offset from a fixed epoch, so
 * the canvas can do arithmetic. `x: 2400` means nothing to an assistant, and it
 * cannot convert without knowing the epoch — so every date crosses this boundary
 * as ISO. Mirrors EPOCH_MS in src/domain/dateUtils.ts; the two must agree, which
 * is why the constant is named rather than inlined. */
const EPOCH_MS = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;
export const dayToISO = (day: number) => new Date(EPOCH_MS + day * DAY_MS).toISOString().slice(0, 10);
export const isoToDay = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - EPOCH_MS) / DAY_MS);

/** Weekdays in a span — the same "elapsed" the app shows, so an assistant's
 * arithmetic matches what the customer sees on screen. */
export function businessDays(startDay: number, span: number, useWeekends: boolean): number {
  if (useWeekends) return span;
  let n = 0;
  for (let i = 0; i < span; i++) {
    const dow = new Date(EPOCH_MS + (startDay + i) * DAY_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

interface Lookups {
  epics: Map<string, string>;
  resources: Map<string, { name: string; capacity: number }>;
  statuses: Map<string, string>;
}

/** One task, in the vocabulary the customer uses: real dates, names instead of
 * ids, and the allocation percentages that drive everything else. */
function shapeTask(f: Record<string, unknown>, look: Lookups) {
  const x = Number(f.x ?? 0);
  const duration = Number(f.duration ?? 1);
  const resourceIds = Array.isArray(f.resources) ? (f.resources as string[]) : [];
  const alloc = (f.alloc ?? {}) as Record<string, number>;
  const statusId = String(f.status ?? "");
  return {
    taskId: f.id,
    title: f.title || "Untitled task",
    status: look.statuses.get(statusId) ?? statusId,
    epic: f.epicId ? (look.epics.get(String(f.epicId)) ?? null) : null,
    startDate: dayToISO(x),
    endDate: dayToISO(x + duration),
    calendarDays: duration,
    workingDays: businessDays(x, duration, !!f.useWeekends),
    assignees: resourceIds.map((id) => ({
      name: look.resources.get(id)?.name ?? id,
      allocationPercent: alloc[id] ?? 100,
      isLead: f.lead === id,
    })),
    finishedOn: f.finishedAt ?? null,
    // Only surfaced when set — a baseline nobody froze is not "on plan", it is
    // absent, and an assistant should not report the difference as zero.
    plan: f.plannedX != null
      ? { startDate: dayToISO(Number(f.plannedX)), startDeltaDays: x - Number(f.plannedX) }
      : null,
  };
}

/** The three lookup tables every task-shaped tool needs. One fetch each,
 * bounded, rather than a read per task. */
async function loadLookups(caller: Caller, pulseId: string): Promise<Lookups> {
  const [epics, resources, pulse] = await Promise.all([
    listAsUser(caller, `pulses/${pulseId}/epics`, MAX_LIMIT),
    listAsUser(caller, `pulses/${pulseId}/resources`, MAX_LIMIT),
    getAsUser(caller, `pulses/${pulseId}`),
  ]);
  const statuses = (pulse?.statuses as { id: string; label: string }[] | undefined) ?? [];
  return {
    epics: new Map(epics.map((e) => [String(e.id), String(e.name ?? "Untitled epic")])),
    resources: new Map(
      resources.map((r) => [String(r.id), { name: String(r.name || r.initials || r.id), capacity: Number(r.capacity ?? 100) }]),
    ),
    statuses: new Map(
      statuses.length
        ? statuses.map((st) => [st.id, st.label])
        : [["planned", "Planned"], ["in-progress", "In progress"], ["blocked", "Blocked"], ["done", "Done"]],
    ),
  };
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
  {
    name: "get_pulse",
    description:
      "One Pulse in full: its epics, its tasks with real dates and assignees, and its people. " +
      "Dates are ISO; a task's length is given in both calendar and working days.",
    inputSchema: {
      type: "object",
      properties: {
        pulseId: { type: "string", description: "From list_pulses." },
        limit: { type: "number", description: `Max tasks (default 100, max ${MAX_LIMIT}).` },
      },
      required: ["pulseId"],
    },
  },
  {
    name: "search_tasks",
    description:
      "Find tasks in a Pulse by text, status, epic or assignee. Text matches the title, " +
      "case- and accent-insensitively. Combine filters to narrow.",
    inputSchema: {
      type: "object",
      properties: {
        pulseId: { type: "string" },
        query: { type: "string", description: "Text to find in the task title." },
        status: { type: "string", description: "Status id or label, e.g. 'blocked'." },
        epic: { type: "string", description: "Epic name." },
        assignee: { type: "string", description: "Person's name." },
        limit: { type: "number" },
      },
      required: ["pulseId"],
    },
  },
  {
    name: "get_schedule",
    description:
      "Tasks active in a date window, earliest first — what is running now, what lands this month, " +
      "what is late. A task counts if any part of it falls inside the window.",
    inputSchema: {
      type: "object",
      properties: {
        pulseId: { type: "string" },
        from: { type: "string", description: "ISO date, inclusive. Defaults to today." },
        to: { type: "string", description: "ISO date, inclusive. Defaults to 30 days after `from`." },
        limit: { type: "number" },
      },
      required: ["pulseId"],
    },
  },
  {
    name: "get_people_load",
    description:
      "Per-person allocation across a date window, against their capacity. Use it to find who is " +
      "over-committed. Allocation is summed across every task overlapping the window.",
    inputSchema: {
      type: "object",
      properties: {
        pulseId: { type: "string" },
        from: { type: "string", description: "ISO date. Defaults to today." },
        to: { type: "string", description: "ISO date. Defaults to 30 days after `from`." },
      },
      required: ["pulseId"],
    },
  },
  {
    name: "get_costs",
    description:
      "Recorded costs for a Pulse, grouped by model, by person or by task. Only visible to users " +
      "whose role permits it — an empty result may mean no access rather than no costs.",
    inputSchema: {
      type: "object",
      properties: {
        pulseId: { type: "string" },
        groupBy: { type: "string", enum: ["model", "person", "task"], description: "Default 'model'." },
        limit: { type: "number" },
      },
      required: ["pulseId"],
    },
  },
  {
    name: "get_activity",
    description: "Recent changes in a Pulse — who changed what, and when. Newest first.",
    inputSchema: {
      type: "object",
      properties: {
        pulseId: { type: "string" },
        limit: { type: "number", description: `Default 30, max ${MAX_LIMIT}.` },
      },
      required: ["pulseId"],
    },
  },
] as const;

/** Accent- and case-insensitive contains, so "analisis" finds "análisis" — the
 * same folding the in-app help search uses, for the same reason. */
export const fold = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** The window every date-ranged tool shares. Defaults to the next 30 days,
 * because "what's happening" almost always means "soon", and an unbounded
 * default would read the whole roadmap. */
function windowOf(args: Record<string, unknown>) {
  const todayDay = Math.floor((Date.now() - EPOCH_MS) / DAY_MS);
  const from = typeof args.from === "string" ? isoToDay(args.from) : todayDay;
  const to = typeof args.to === "string" ? isoToDay(args.to) : from + 30;
  return { from, to };
}

/** Does a task overlap the window at all? Inclusive at both ends — a task
 * finishing on the first day of the window is still in it. */
export const overlaps = (f: Record<string, unknown>, from: number, to: number) => {
  const x = Number(f.x ?? 0);
  return x <= to && x + Number(f.duration ?? 1) >= from;
};

async function callTool(caller: Caller, name: string, args: Record<string, unknown>): Promise<unknown> {
  const pulseId = typeof args.pulseId === "string" ? args.pulseId : "";

  switch (name) {
    case "list_pulses": {
      const limit = clampLimit(args.limit, 50);
      // The customer's own dashboard index — the same list their browser reads,
      // and the only listable view of "Pulses I can access" (see the note at the
      // top of firestore.rules on why this is an index rather than a query).
      const rows = await listAsUser(caller, `users/${caller.uid}/myPulses`, limit);
      const visible = args.includeHidden ? rows : rows.filter((r) => !r.hidden);
      return {
        pulses: visible.map((r) => ({
          pulseId: r.pulseId ?? r.id,
          name: r.name || "Untitled Pulse",
          role: r.role,
          archived: r.archivedAt != null,
        })),
        count: visible.length,
      };
    }

    case "get_pulse": {
      const limit = clampLimit(args.limit, 100);
      const look = await loadLookups(caller, pulseId);
      const features = await listAsUser(caller, `pulses/${pulseId}/features`, limit);
      return {
        epics: [...look.epics.values()],
        people: [...look.resources.values()].map((r) => ({ name: r.name, capacityPercent: r.capacity })),
        tasks: features.map((f) => shapeTask(f, look)),
        taskCount: features.length,
        truncated: features.length === limit ? `Only the first ${limit} tasks are shown.` : undefined,
      };
    }

    case "search_tasks": {
      const limit = clampLimit(args.limit, 50);
      const look = await loadLookups(caller, pulseId);
      const features = await listAsUser(caller, `pulses/${pulseId}/features`, MAX_LIMIT);
      const q = fold(args.query);
      const wantStatus = fold(args.status);
      const wantEpic = fold(args.epic);
      const wantWho = fold(args.assignee);

      const hits = features.filter((f) => {
        const shaped = shapeTask(f, look);
        if (q && !fold(shaped.title).includes(q)) return false;
        // Matches either the id or the label, because an assistant may have
        // seen either — "blocked" and "Blocked" both work.
        if (wantStatus && !fold(shaped.status).includes(wantStatus) && !fold(f.status).includes(wantStatus)) return false;
        if (wantEpic && !fold(shaped.epic).includes(wantEpic)) return false;
        if (wantWho && !shaped.assignees.some((a) => fold(a.name).includes(wantWho))) return false;
        return true;
      });
      return {
        tasks: hits.slice(0, limit).map((f) => shapeTask(f, look)),
        matched: hits.length,
        truncated: hits.length > limit ? `${hits.length} matched; showing ${limit}.` : undefined,
      };
    }

    case "get_schedule": {
      const limit = clampLimit(args.limit, 100);
      const { from, to } = windowOf(args);
      const look = await loadLookups(caller, pulseId);
      const features = await listAsUser(caller, `pulses/${pulseId}/features`, MAX_LIMIT);
      const inWindow = features
        .filter((f) => overlaps(f, from, to))
        .sort((a, b) => Number(a.x ?? 0) - Number(b.x ?? 0));
      return {
        window: { from: dayToISO(from), to: dayToISO(to) },
        tasks: inWindow.slice(0, limit).map((f) => shapeTask(f, look)),
        count: inWindow.length,
      };
    }

    case "get_people_load": {
      const { from, to } = windowOf(args);
      const look = await loadLookups(caller, pulseId);
      const features = await listAsUser(caller, `pulses/${pulseId}/features`, MAX_LIMIT);

      const load = new Map<string, { name: string; capacityPercent: number; allocatedPercent: number; tasks: string[] }>();
      for (const [id, r] of look.resources) {
        load.set(id, { name: r.name, capacityPercent: r.capacity, allocatedPercent: 0, tasks: [] });
      }
      for (const f of features) {
        if (!overlaps(f, from, to)) continue;
        const alloc = (f.alloc ?? {}) as Record<string, number>;
        for (const rid of Array.isArray(f.resources) ? (f.resources as string[]) : []) {
          const row = load.get(rid);
          if (!row) continue;
          row.allocatedPercent += alloc[rid] ?? 100;
          row.tasks.push(String(f.title ?? "Untitled task"));
        }
      }
      return {
        window: { from: dayToISO(from), to: dayToISO(to) },
        // Simultaneous allocation against capacity — the same comparison the
        // Capacity tab makes. Not effort: two tasks at 50% each is a full
        // person, however long they run.
        people: [...load.values()]
          .filter((p) => p.allocatedPercent > 0)
          .sort((a, b) => b.allocatedPercent - a.allocatedPercent)
          .map((p) => ({ ...p, overCapacity: p.allocatedPercent > p.capacityPercent })),
        note: "Allocation sums every task overlapping the window, so it shows simultaneous commitment rather than total effort.",
      };
    }

    case "get_costs": {
      const limit = clampLimit(args.limit, 100);
      const groupBy = args.groupBy === "person" || args.groupBy === "task" ? args.groupBy : "model";
      const look = await loadLookups(caller, pulseId);
      const [costs, features] = await Promise.all([
        listAsUser(caller, `pulses/${pulseId}/costs`, MAX_LIMIT),
        listAsUser(caller, `pulses/${pulseId}/features`, MAX_LIMIT),
      ]);
      const titles = new Map(features.map((f) => [String(f.id), String(f.title ?? "Untitled task")]));

      const groups = new Map<string, { usd: number; entries: number }>();
      for (const c of costs.slice(0, limit)) {
        const attrs = (c.attrs ?? {}) as Record<string, string | null>;
        const key =
          groupBy === "task"
            ? (titles.get(String(c.featureId)) ?? "Unknown task")
            : groupBy === "person"
              ? (look.resources.get(String(attrs.resourceId))?.name ?? "Unattributed")
              : (attrs.model ?? "Unnamed model");
        const row = groups.get(key) ?? { usd: 0, entries: 0 };
        // Amounts are stored in micros to keep them exact; divide once, here.
        row.usd += Number(c.amountMicros ?? 0) / 1_000_000;
        row.entries += 1;
        groups.set(key, row);
      }
      const rows = [...groups].map(([key, v]) => ({ [groupBy]: key, usd: Math.round(v.usd * 100) / 100, entries: v.entries }));
      return {
        groupBy,
        rows: rows.sort((a, b) => b.usd - a.usd),
        totalUsd: Math.round(rows.reduce((n, r) => n + r.usd, 0) * 100) / 100,
        // An empty result is ambiguous, and the ambiguity matters: costs are
        // role-gated, so say so rather than letting it read as "nothing spent".
        note: costs.length === 0 ? "No costs returned. This may mean none are recorded, or that your role cannot see them." : undefined,
      };
    }

    case "get_activity": {
      const limit = clampLimit(args.limit, 30);
      const rows = await listAsUser(caller, `pulses/${pulseId}/activity`, MAX_LIMIT);
      const recent = rows
        .sort((a, b) => Number(b.at ?? b.createdAt ?? 0) - Number(a.at ?? a.createdAt ?? 0))
        .slice(0, limit);
      return {
        entries: recent.map((e) => ({
          when: e.at ? new Date(Number(e.at)).toISOString() : null,
          who: e.actorEmail ?? e.actorUid ?? "someone",
          what: e.summary ?? e.verb ?? "changed something",
          target: e.entityName ?? null,
        })),
        count: recent.length,
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
