# Beats — MCP Server Spec

Status: **Phase 0 BUILT and live — read-only, customer-facing, hosted by Beats,
nine tools. MC1–MC10, MC14–MC32 decided; MC12 is the only one still open.
MC11 is superseded by MC29 (rate limiting, built). MC13 shipped as recommended.
Revised as it was built: MC2/MC4/MC6 on 2026-08-17 when remote replaced local,
MC15 by MC20 and then MC25, MC17 corrected by MC19 — see each. RM21 adds three
more tools, specified in `Resource-Master-Spec.md`.**
· Owner: product + eng ·
Related: `Permissions-Spec.md` (the roles every tool inherits),
`Plans-Spec.md` (quotas an MCP write consumes), `Server-Functions-Spec.md`
(where the three new callables live), `Collaboration-Spec.md` (activity
attribution)

## 0. What this is (and isn't)

An **MCP server for Beats**, hosted by Beats and added to an AI assistant by
URL. It lets the assistant read the customer's Beat data — "what's slipping",
"who's overloaded this month", "summarise Q3" — using the customer's own
permissions.

It is a **product feature**, not an internal tool (MC1). Any Beat user can
connect an assistant, name the connection, see it listed, and revoke it.

**Not** in scope for v1: writes of any kind (MC5 — the path is designed, not
built), billing or subscription access, member management or invitations, and
**storing any long-lived customer credential on Beats' servers** (§2 — the
refresh token lives with the customer's AI client, not with us).

## 1. The spine: the MCP acts as the user

Everything else follows from this.

Beats has exactly one authorization boundary: **`firestore.rules`**. Roles,
archive locks, the last-owner guard, plan quotas and per-Beat membership all
live there and nowhere else. A server that reached Firestore through the Admin
SDK would **bypass all of it** and have to re-implement every rule, correctly,
forever, in a second place — the precise failure this codebase is arranged to
avoid.

So every request carries a **Firebase Auth token belonging to the customer**, and
the server reads Firestore with that token (§2). Every read it makes is a read
that customer could have made in the browser. Nothing new is authorized; the
assistant simply gets the same window the user already has.

**The Admin SDK appears in exactly one place** — minting the custom token at
authorize time (§2). It is never used to read or write customer data.

## 2. Authentication: OAuth to the customer's AI client (MC2, revised)

Remote MCP clients authenticate with OAuth and a browser, which the customer has
in front of them. That removes the constraint that made a device-code flow
necessary — device codes exist for processes that *cannot* open a browser.

**The customer's experience is what was asked for either way:** approve in a
browser where they are already signed in, see the connection listed in Beats,
revoke it in one click. Only the mechanism underneath changed.

```
AI client                    Pulse (hosted MCP + auth)          Customer's browser
 │
 ├─ discovers /.well-known/… ──▶
 ├─ opens authorize URL ─────────────────────────────────────────▶ /oauth/authorize
 │                                                                ├─ already signed in
 │                                                                ├─ names the connection
 │                                                                └─ Approve (scope: read)
 │                              create users/{uid}/connections/{id}
 │                              mint Firebase custom token
 │                                { connectionId, scope: "read" }
 │                              exchange → ID + refresh token
 │  ◀── redirect with code ──────
 ├─ POST /oauth/token ─────────▶ code → { access_token (ID, 1h),
 │                                        refresh_token }
 │
 └─ every MCP call: Authorization: Bearer <ID token>
```

### 2.1 Beats re-mints on every refresh (MC14)

`/oauth/token` is a real endpoint, not a proxy to Firebase's. On refresh it:

1. verifies the presented refresh token against its stored **hash**,
2. loads the connection — **revoked or missing ⇒ `401`, and it cannot renew**,
3. mints a *fresh* custom token with `{ connectionId, scope }` read from that
   connection record,
4. exchanges it and returns a new one-hour access token.

This exists because the claims are what identify a connection and carry its
scope, and **a claim that silently stopped surviving a refresh would fail in the
worst possible shape**: correct in testing on a fresh token, broken about an hour
later, intermittent thereafter, and — for the Phase-2 write gate — failing closed,
so writes stop with nothing changed. Re-minting means the claims are never older
than an hour whatever the SDK does, so the behaviour does not depend on the
answer.

Two things fall out of it that are worth having regardless:

- **Revocation bites at refresh**, not only per request. A revoked connection
  cannot renew, which is what actually ends a session.
- **Scope can change without re-approval**, because it is read from the
  connection record each time rather than frozen at first mint. Phase 2 can
  upgrade a read connection to write from the consent screen alone.

**Beats still stores no usable customer credential.** What it holds is
`{ refreshTokenHash, uid, connectionId, scope }` — a hash is not a token, so a
breach yields nothing that can be replayed. The argument that kept this off Beat's servers (§6) therefore still holds.

**Every request is made *as the customer*.** The MCP server verifies the bearer
ID token, then reads Firestore **through the REST API using that same token**, so
`firestore.rules` evaluates exactly as it does for the browser (§1). The server
never uses the Admin SDK for customer data — only to mint the custom token at
authorize time.

> **Worth ten minutes anyway:** sign in with a custom token carrying an extra
> claim, force a refresh, and inspect the new ID token. It tells you whether §2.1
> is load-bearing or belt-and-braces — useful to know, and it costs nothing.
> Do not skip §2.1 on the strength of a good result; the cheap insurance is worth
> more than the saved half-day.

The **device-code flow is retained for the optional local server** (MC6), where
no browser is available. It produces the same connection record, the same
re-minting refresh and the same revocation behaviour, so §2.1 and §3 cover both.

## 3. Connections and revocation (MC4, revised)

The customer's requirement — revoke a connection from inside Beats — is
unchanged. Hosting it makes the enforcement *simpler and cheaper*.

`users/{uid}/connections/{connectionId}` holds `name` (customer-supplied),
`client` (what the AI client reported), `createdAt`, `lastUsedAt`, `scope` and
`revokedAt`. The customer sees them in **Account → Connected assistants**, with
"last used" beside each and a revoke button.

**Revocation is enforced at the MCP server**, which every request passes through:
verify the bearer token → load the connection → if missing or revoked, `401`.
One lookup, no change to `firestore.rules`, and **none of the per-request rules
read the local design would have cost** (the earlier draft added an `exists()`
to every read rule, billed as a read, doubled across an enumerating assistant).
That saving is a direct consequence of hosting it.

Two honest limits:

- **A leaked bearer token is valid until it expires** (one hour), because it is
  an ordinary Firebase ID token that Firestore accepts directly. Revocation stops
  the *refresh*, so a revoked connection dies within the hour and cannot renew.
  This is the same exposure a stolen browser session has, and the reason tokens
  are short-lived.
- **Revocation is immediate at the MCP server, eventual at Firestore.** If you
  need it immediate at both, the claim-based rules check from the local design
  can be added back — at the per-request read cost it was rejected for.

## 4. Read-only first, writes designed for (MC5)

v1 mints tokens with `scope: "read"` and exposes no write tool. But the shape is
fixed now so writes are an increment, not a redesign:

- **Scope is decided at approval and carried on the connection.** A read
  connection can never become a write connection by accident; changing it means
  approving again. The MCP server refuses write tools for a `read` connection,
  and — because writes are the case where a second line of defence is worth its
  cost — the rules gate on the scope claim as well.
- **The approval page already names the scope**, so adding "…and create or edit
  tasks" is a copy change, not a new consent model.
- **Attribution is designed in from the start (MC7).** A write made by an
  assistant must not read as a human's edit in the activity log. Activity entries
  from an MCP session carry `via: "mcp"` and the connection name, and the UI
  renders "*Ana's Claude (via MCP)*". Without this, "who changed what" quietly becomes
  untrue the day writes ship.
- **Quotas apply for free.** Because the MCP acts as the user (§1), a
  create-Beat through it hits the same `workspace.pulseCount` gate as the UI.
  Nothing extra to build, and nothing to forget.

## 5. What v1 exposes

MCP separates **resources** (things to read) from **tools** (things to call).
Beats v1 is resources plus read-shaped tools.

| Name | Kind | Returns |
| --- | --- | --- |
| `list_beats` | tool | the customer's Beats: id, name, role, archived |
| `get_beat` | tool | one Beat: epics, tasks, resources, statuses |
| `search_tasks` | tool | tasks matching text/status/epic/assignee, **with their subtasks in full** |
| `get_schedule` | tool | tasks in a date window with dates, effort and assignees |
| `get_people_load` | tool | per-person allocation over a window, against capacity |
| `get_costs` | tool | cost summary by model / person / task — **admins only**, mirroring `viewPeopleCost` |
| `search_resources` | tool | resource detail: type, capacity, linked Beat account, hourly rate where the role permits |
| `search_comments` | tool | comments, newest first, with what each is attached to and whether it is a reply |
| `get_activity` | tool | recent changes on a Beat |

**Planned, not built — `Resource-Master-Spec.md` §10 / RM21.** Listed here so the
tool surface has one home, and marked so nobody reads them as shipped:

| Name | Kind | Returns | RM phase |
| --- | --- | --- | --- |
| `search_roster` | tool | the **workspace's** people — name, type, teams, link state, master rate where permitted | 1 |
| `get_resource_usage` | tool | which Beats one person is on, and whether they have assignments there | 2 |
| `list_teams` | tool | teams in the workspace, with their sizes | 3 |

These are the first tools to answer a question **across** Beats. Two notes that
matter more than the shapes:

- **`search_roster` must not blur into `search_resources`.** The existing tool is
  Beat-scoped and takes a `pulseId`; the new one is workspace-scoped. Overlapping
  descriptions are how an assistant picks the wrong tool, so the scope has to be
  unmistakable in both.
- **They add no authorization.** Reading as the customer (§1) means a
  non-workspace-member gets a 403 that `listAsUser` turns into an empty result,
  and master rates stay behind their own workspace-owner-only collection — with
  the same "empty may mean no access" note `get_costs` already carries.

**Every one is bounded.** No tool returns "everything": each takes a limit with a
sane default and a hard ceiling, and paginates. This is not politeness — an
assistant asked to "look at my roadmap" will happily enumerate, and Firestore
bills per document read, doubled by §3's rule check.

**Shape the output for a reader, not a database.** Return a task's dates,
duration, status label and assignee names — not raw documents with uid arrays and
epoch numbers. The assistant should not have to join `resources` to say who is
assigned, and every unnecessary field is tokens the customer pays for twice
(Firestore, then context).

## 6. Distribution and transport (MC6, revised)

**A remote MCP server that Beat hosts, added by URL**, over the current
streamable-HTTP transport, handled statelessly so it runs as request/response on
the same serverless platform as the existing callables rather than holding open
connections.

The decision turned on **who can actually use it**. A local npm server needs
Node installed, a JSON config file edited and the client restarted; that is a
developer's onboarding, and this is a customer feature (MC1). Remote is a URL and
a browser approval, and it reaches clients a local server cannot — the web app
and mobile, not only desktop.

The two costs of hosting are answered rather than accepted: **credential
liability** by not storing refresh tokens (§2), and **per-request expense** by
dropping the rules-level connection check (§3). What genuinely remains is an
**uptime obligation** — when this is down, a customer's assistant is broken, and
that is new for Beats.

**Firestore reads are the dominant cost either way**, billed to Beats, and
unaffected by this decision: a `get_beat` over a 200-task Beats is 200-plus
reads whoever runs the query. That is what §5's bounded tools and MC11's rate
limit are actually protecting.

**A local stdio server stays available** as a published package for customers who
want the credential on their own machine, using the device-code flow of §2. It is
a fallback, not the front door — and note the wrinkle it carries: in stdio mode
stdout *is* the protocol channel, so the device code cannot simply be printed. It
needs a separate one-off `login` command, or a `connect` tool whose output the
assistant relays.

## 7. Phasing (MC9)

1. **Phase 0 — internal, unpublished.** Same service, same OAuth flow, used by the
   team against real Beats for a fortnight. The point is to find out **which
   tools are actually worth exposing** before the surface becomes a public
   contract that can't be changed freely.
2. **Phase 1 — customer read-only.** Publish the package, ship `/link` and
   Account → Connected assistants, document it in help (§8).
3. **Phase 2 — writes.** `scope: "write"`, the write tools, `via: "mcp"` in the
   activity UI, and a re-approval path for existing read connections.

## 8. What else has to move

- **The hosted MCP service** — streamable HTTP, stateless, alongside the existing
  functions. Verifies the bearer token, checks the connection, reads Firestore
  through the REST API as the customer.
- **OAuth endpoints** — `/.well-known/` discovery, `/oauth/authorize` (a new app
  route with the consent screen), and `/oauth/token`, which **issues and re-mints
  rather than proxying** (§2.1): verify the refresh-token hash, load the
  connection, refuse if revoked, mint fresh claims, exchange. The consent screen
  names the scope **before** the Approve button, not after.
- **Account → Connected assistants**, with per-connection revoke and "last used".
- **Entitlement check wired but open (MC10)** — the tier check exists in the
  authorize path from day one, configured to allow every tier, so turning gating
  on later is configuration rather than a retrofit.
- **`rules/security.test.ts`**: an MCP-issued token reads what the user can and
  nothing more; a read-scope token is refused writes (Phase 2). The allow side
  matters as much — a browser session must be entirely unaffected.
- **Help** (`src/help/*.ts`, six languages): what connecting an assistant does,
  what it can see, and how to revoke it. A permission-granting feature with no
  explanation is one nobody trusts.
- **i18n**: consent screen and connection list, six locales.
- **An uptime story.** This is the first Beat surface whose outage breaks
  something outside the app (MC6). Decide what "down" means and who hears about
  it before customers do.

## 9. Decisions

1. **MC1 — Who is it for? → DECIDED: customers.** Any Beat user can connect
   their own assistant. *Rejected: an internal-only tool* — it would answer a
   different question, and the design constraints (consent, revocation, support)
   only appear when strangers use it. Phase 0 (MC9) still dogfoods it first,
   which captures most of the learning without the smaller scope.
2. **MC2 — Authentication → DECIDED: OAuth, with the AI client holding the
   refresh token.** *(Revised 2026-08-17. Was "device authorization flow", chosen
   when the server was going to be local. Remote clients have a browser, so the
   constraint that made device codes necessary is gone — the customer-visible
   experience is unchanged: approve in the browser, see it listed, revoke it.
   The device-code flow survives for the optional local server.)* *Rejected:
   personal access tokens* — a long-lived string in a config file is a leak that
   stays valid until noticed, and the copy-paste step is where setup goes wrong.
   *Rejected: Beats storing the refresh token* — it would recreate exactly the
   breach liability that argued against hosting at all.
3. **MC3 — The MCP acts as the user, never as an admin. → DECIDED.** The client
   SDK with the customer's token, so `firestore.rules` stays the only
   authorization boundary. *Rejected: a service account* — it bypasses every
   rule and duplicates the entire permission model in a second place, which is
   the failure mode this codebase exists to avoid.
4. **MC4 — Per-connection revocation → DECIDED: a connection record checked at
   the MCP server.** *(Revised 2026-08-17: hosting it put a server we control in
   every request path, so the check moved there from `firestore.rules`. That
   removed the extra billed read per request the local design had accepted —
   a real saving once an assistant starts enumerating.)* *Rejected:
   `revokeRefreshTokens(uid)`* — it signs the customer out of their browser too.
   Accepted limit: a leaked bearer token stays valid for its remaining hour;
   revocation stops the refresh, so a revoked connection cannot renew.
5. **MC5 — Read-only in v1 → DECIDED, with the write path designed now.** The
   `scope` claim, the consent copy and the attribution field all exist from the
   start, so Phase 2 adds tools rather than rethinking consent. *Rejected:
   shipping writes at once* — the first fortnight of real use should not be able
   to damage a customer's data.
6. **MC6 — Hosted remote MCP, added by URL → DECIDED.** *(Revised 2026-08-17.
   The first draft chose a local npm server on credential-liability grounds. That
   was the right concern with the wrong conclusion: the liability is an artefact
   of storing refresh tokens, which §2 avoids, while the onboarding gap is not
   fixable — a customer feature that needs Node installed and a JSON config
   edited has a developer's adoption ceiling, and remote also reaches web and
   mobile clients a local server cannot.)* *Rejected: local as the front door*,
   though it stays published as a fallback for customers who want the credential
   on their own machine. **Accepted cost: an uptime obligation** — the first Beat surface whose outage breaks something outside the app.
7. **MC7 — Assistant writes are attributed → DECIDED: `via: "mcp"` + connection name
   on activity entries.** *Rejected: recording them as ordinary user edits* —
   the activity log's only job is "who changed what", and an assistant's edit
   credited to a human makes it quietly untrue.
8. **MC8 — Every read is bounded → DECIDED.** Default and maximum limits,
   pagination, reader-shaped output. *Rejected: raw document passthrough* — it
   costs the customer twice, in Firestore reads and in context, and makes the
   assistant do joins it will sometimes get wrong.
9. **MC9 — Phase 0 internal before customer release → DECIDED.** A fortnight of
   real use decides the tool surface before it becomes a contract.
10. **MC10 — Is the MCP plan-gated? → DECIDED: not at launch, but built to be.**
    Every tier gets it on day one — gating an integration before anyone uses it
    is how integrations fail to be adopted, and the read cost is bounded by §5
    and MC11. But it is expected to become a paid feature, so **the entitlement
    check ships in the authorize path from the start, configured to allow every
    tier.** Turning it on later is then a configuration change, not a retrofit
    into a flow that customers are already using. *Rejected: adding the check
    when it is needed* — that is a change to the consent path, which is the one
    place a mistake locks existing customers out of a connection they already
    approved. What tier it lands on, and whether existing free connections are
    grandfathered, are deliberately left to when there is usage data.

11. **MC11 — Rate limiting per connection? → SUPERSEDED by MC29 (built).** The
    recommendation here — a per-connection ceiling once Phase 0 showed the real
    shape of traffic — is what MC29 implements, with the counters on the
    connection document so the limiter costs no extra read or write. Kept for the
    reasoning: an assistant in a loop is the plausible failure, and it spends the
    customer's money and Beat's quota at once.
12. **MC12 — Connection lifetime.** Should a connection expire after N days
    unused? *Recommend: no hard expiry, but surface `lastUsedAt` prominently and
    prompt to prune. A connection that stops working silently is worse support load
    than one the customer chose to keep.*
13. **MC13 — Does the assistant see cost data by default? → DECIDED as
    recommended, and shipped.** `get_costs` mirrors `viewPeopleCost`, so admins
    see people cost and others do not, with no separate MCP-level toggle — a
    second permission axis over the same data is how the two drift. Built that
    way, and the tool carries a note saying an empty result may mean no access
    rather than no costs, because those are indistinguishable to a reader.
14. **MC14 — Beats re-mints the token on every refresh → DECIDED (§2.1).**
    The claims carrying `connectionId` and `scope` are re-issued hourly from the
    connection record, so nothing depends on whether Firebase preserves custom
    -token claims across a refresh. *Rejected: proxying refresh straight to
    Firebase* — cheaper to build, but it stakes per-connection revocation and the
    Phase-2 write gate on undocumented behaviour, and the failure would be
    delayed by an hour and intermittent. *Rejected: deciding this at Phase 2* —
    it shapes the token endpoint, and retrofitting it means changing a flow
    customers have already authorized. Bonus, not incidental: revocation bites at
    refresh, and scope becomes changeable without re-approval.
15. **MC15 — `serverInfo` carries only what the announced protocol revision
    defines → DECIDED (`functions/src/mcpServer.ts:25`).** `initialize` returns
    `name`, `title` and `version`; `version` tracks the **tool surface** rather
    than the code, so it moves when a tool is added, removed or changes shape,
    and not otherwise. Six new tools stayed invisible partly because `0.1.0`
    never moved and a client has nothing else to notice a change by.
    *Rejected: also sending `icons` and `websiteUrl`* — they state our identity
    outright instead of leaving a client to sniff `/favicon.ico`, which is the
    fallback that produced the Yasdu mark, and they were tried. They belong to a
    later draft than the 2025-06-18 we negotiate, and sending them **broke
    connection setup**: token exchange succeeded, three requests returned 2xx,
    the server logged nothing at all, and the client refused the session. The
    rule that generalises is the value here — *announce a revision, then answer
    with only that revision's members* — and they can return if the negotiated
    version moves up. *Rejected: declaring `capabilities.tools.listChanged`* —
    stateless HTTP has no open channel to push `notifications/tools/list_changed`
    down, so it would promise a notification that never arrives.
    Consequences to state plainly rather than rediscover: **a tool-surface change
    needs the customer to reconnect the connector**, and neither the favicon fix
    nor anything else we serve can invalidate an icon a client has already
    cached — every icon Beat serves was verified correct (the ICO decoded to
    the Beats mark at 16px and 32px) while a stale one was still on screen.
16. **MC16 — Icon-probe paths get real files, not the SPA → DECIDED.** Firebase
    Hosting's catch-all rewrite answered `/apple-touch-icon.png` and
    `/apple-touch-icon-precomposed.png` with `200 text/html`, the same shape as
    the `/favicon.ico` bug in `46172d0`. A `<link rel="apple-touch-icon">` points
    well-behaved clients at `/brand/`, but the convention is to probe the root
    when no link is found, and a 200 of undecodable HTML is worse than a 404 —
    it reads as "an icon exists here" and fails at decode, which is how a client
    ends up at the parent domain's mark. Real files now sit at both root paths.
    *Rejected: a rewrite rule excluding image extensions* — Hosting expresses
    that awkwardly, and two copied files have no failure mode.
17. **MC17 — A stale tool list is announced on a tool call's own response
    stream → DECIDED (`functions/src/mcpServer.ts`).** The connection document
    remembers the `SERVER_INFO.version` it last served a `tools/list` at. When a
    tool is called and that differs, the reply is a Streamable-HTTP SSE stream
    carrying `notifications/tools/list_changed` ahead of the result; the client
    re-lists, the field is updated, and it stops. `capabilities.tools.listChanged`
    is now declared, because it is now true. This is what makes MC15's
    reconnect-per-tool-change unnecessary from here on, and it is why `version`
    must track the tool surface rather than the code — it *is* the staleness
    signal. *Rejected: an explicit `refresh_tools` tool* — same mechanism, but it
    only fires when someone thinks to call it, and a maintenance tool in a
    customer-facing list is clutter that has to be explained. *Rejected: a
    long-lived SSE stream over GET* — the general solution, and it means holding
    connections open on Cloud Run for the lifetime of every session, billed by
    duration, plus a resume story, to serve a notification sent a few times a
    year (cf. MC11 on cost).
    Two limits, both structural. The client can only honour this if it was
    connected when the mechanism already existed, so it fixes the **next**
    surface change and never the one that introduces it — **the Phase 2 write
    tools will still need one reconnect.** And it only streams when the client's
    `Accept` header offers `text/event-stream`; otherwise the plain JSON reply is
    returned unchanged and the connection stays marked stale for the next call.
    That guard is the lesson from MC15 applied: never answer in a shape the
    client has not said it can read.
18. **MC18 — `search_resources` and `search_comments` (v0.3.0).** Resource
    detail and discussion were the two things no tool reached. Both read through
    the customer's own credentials like everything else, so their sensitive
    parts gate themselves: hourly rates live in `pulses/{id}/rates`, admin-only
    (Costs-Spec §8.3), and a member who may not see them gets a 403 that
    `listAsUser` turns into `[]` — no rate reaches the assistant, enforced by the
    rule rather than by a check in the tool. Where that produces an empty result
    it carries the same note `get_costs` does, because an absent rate is not
    evidence of a free resource. *Rejected: folding resource detail into
    `get_beat`* — it already returns name and capacity for every person, and
    widening it would make the common call more expensive to serve the rare one.
    *Rejected: reporting per-resource task load here* — `get_people_load` answers
    that against a window, and duplicating it would cost a 200-document read on
    every resource lookup. `search_comments` resolves `targetId` to the task or
    resource name, treats a missing `targetKind` as a task (pre-resource-comment
    data), and returns null for Beat-level comments — which means unattached,
    not orphaned.
    Version moved 0.2.0 → 0.3.0, which is what MC17 keys on: this is the first
    surface change to announce itself to already-connected clients.
19. **MC19 — MC17 does not do what it claims; corrected here rather than
    edited away.** MC17 (added 2026-08-17) says a stale client is told about a
    tool-surface change on a tool call's response stream, making reconnects
    unnecessary. The logs from the 0.2.0 → 0.3.0 change say otherwise: the
    `announcing tool-list change` line never appeared once, and the customer
    still had to reconnect. Two facts explain it, and both were assumptions
    rather than observations when MC17 was written.
    First, **this client re-runs `initialize` + `tools/list` at the start of every
    session**, not only when the connector is added. Since `tools/list` is what
    clears the staleness flag, the flag is always clean before any `tools/call`
    can carry a notification. The mechanism can only fire if a deploy lands
    mid-session — a narrow window, not the common case.
    Second, **the tool list was never the thing blocking**: `tools listed,
    tools: 9` was served to the pre-existing connection 55 seconds *before* the
    reconnect. The new tools were available at the protocol level without one.
    What required reconnecting is the client's own connector UI — its enabled-tool
    list, cached above the protocol, where a server cannot reach.
    Kept rather than removed: it is correct for a client that caches across
    sessions, it costs one field on a document `authenticate` already reads, and
    the version discipline it forces is what made this diagnosis possible at all.
    **But it is not a reconnect-avoidance mechanism, and MC17 should not be cited
    as one** — including for the Phase 2 write tools, which will need a reconnect
    like everything else.
20. **MC20 — Negotiate 2025-11-25, and assemble `serverInfo` per revision →
    DECIDED (`functions/src/mcpServer.ts`).** Every real connection logged
    `downgraded: true`, asking for `2025-11-25` and being answered `2025-06-18`;
    a client may walk away from a version it did not ask for, and this one was
    being downgraded on every handshake. `2025-11-25` is now the newest supported
    revision. Because `icons` and `websiteUrl` are legitimate members of it,
    identity is now built **against the negotiated version** — clients on
    2025-11-25 receive them, older ones receive exactly what they received
    before. That turns MC15's rule from a blanket prohibition into what it always
    should have been: *send only what the revision you announced defines*, decided
    per response rather than per server. The icon is therefore stated rather than
    sniffed from `/favicon.ico`, without repeating the failure that statement
    caused when it was sent under the wrong revision. Verified live on both paths
    before shipping.
21. **MC21 — An owner's membership doc stored `email: ""`.** `createPulse` and
    `duplicatePulse` wrote the creator's member doc with a blank email, so
    `search_resources` returned no address for a resource linked to the owner —
    the one member whose identity is least likely to be recorded anywhere else.
    Invisible in the app, because an owner already knows who they are. Fixed at
    the source (both writers now take the creator's email) and repaired on load
    for existing Beats. The repair has to be done **by an owner**: the
    `pulseMembers` update rule pins `email` on self-edits so a member cannot
    rewrite the identity their access was granted against, and the owner branch
    is the only exception — which happens to be exactly who is affected.
    `search_resources` also now maps `""` to null, because an empty string
    reaching an assistant reads as an address rather than as an absence.
22. **MC22 — MC10's entitlement hook was never built; now it is
    (`functions/src/mcp.ts`).** MC10 decided the MCP is open to every tier *and*
    that the check would ship in the consent path from day one, so gating later
    would be configuration rather than a retrofit. Phase 0 shipped without it —
    the spec asserted it in two places and `approveMcpConnection` had no tier
    lookup at all — which left the product in exactly the state MC10 rejected.
    `bestTierFor()` now resolves the tier and `MCP_TIERS` decides; today it lists
    every tier, so nothing is denied. **To gate it, edit `MCP_TIERS`.**
    Resolution is **best-across-workspaces**, not personal: a connection is
    per-user and its tools span every Beat that user can reach, so someone on a
    paid team must not be judged by their free personal workspace. Wrongly
    denying consent breaks a paid feature; wrongly allowing it costs bounded
    reads. Workspaces are enumerated from the user's own dashboard index, so this
    needs no collection-group index, and the count checked is capped.
    **Flagged for whoever turns it on.** Plans-Spec §3 says every tier has every
    feature and tiers differ only by quantity — a tier allow-list here would be
    the product's first feature gate. A per-tier **limit on connected assistants**
    fits the existing model, and `bestTierFor()` serves either shape. The denial
    message also needs an i18n key before it can be reached: `AuthorizePage`
    renders the server's message verbatim, and an English sentence on the consent
    screen of a six-language product is a regression.
23. **MC23 — `functions/test/mcp.integration.mjs` exited halfway through.**
    A `process.exit()` sat at line 72, so **everything after it had never run** —
    the REST decoding, limit clamping, protocol-version, date, working-day,
    search-folding and window-overlap assertions. All of it reported green,
    because the process left before reaching any of it. Found only because a
    newly added test produced no output. The exit now runs once, at the end.
    Twenty-four assertions began executing for the first time; all pass, so
    nothing was hiding behind it — this time. Worth generalising: a suite that
    reports success is not evidence it ran, and `&&`-chained scripts make an
    early exit look like a pass.
24. **MC24 — Subtasks are returned by `search_tasks` only, and text search
    reaches their titles (v0.4.0).** Subtasks live as an embedded `children[]`
    array on the task document, so returning them costs no extra read. They are
    nonetheless **opt-in per tool**: `get_beat` and `get_schedule` return up to
    100 tasks each, and folding every subtask into those multiplies the payload
    for a caller who asked about the schedule. `search_tasks` is where someone
    has already narrowed to the task they mean.
    Every task-shaped result now carries `subtaskSummary` (`total`, `done`) even
    where the detail is omitted, so a tool that leaves subtasks out never implies
    a task has none. `done` counts the status **id**, not the label, because
    labels are customisable per Beat and would not compare across them.
    Text search matches a subtask title as well as the task's own — the thing
    someone remembers is often the checklist line — and each hit carries
    `matchedIn: "title" | "subtask"` so a result whose title looks unrelated is
    explained rather than surprising. Notes are stored as rich text and are
    stripped to plain text before crossing the boundary; markup reaching an
    assistant is noise it will try to interpret. A subtask's three dates are
    already plain `YYYY-MM-DD` strings, unlike the parent's day offsets, so they
    pass straight through; `createdDate` is null on subtasks written before that
    field existed rather than being inferred from another date. `overdue` is
    computed here rather than left as arithmetic over three nullable dates, which
    is the calculation most likely to be got subtly wrong.
25. **MC25 — MC20 is reverted. `serverInfo` carries `name`, `title`, `version`
    and nothing else, and the MCP does not negotiate 2025-11-25.** MC20 added
    both together: the newer revision (to stop downgrading every client) and
    `icons`/`websiteUrl` (legitimate members of it). Reconnecting then failed
    with the same customer-facing error as MC15 — *"Your account was authorized,
    but Beats returned an error when connecting."*
    The logs separate cause from noise cleanly, which is the one good outcome
    here. OAuth completed (`connection approved, tier: pro`; `code exchanged`),
    `initialize` returned 200 — and **every** `initialize` answering 2025-11-25
    is followed by no `notifications/initialized` and no `tools/list`, while
    every one answering 2025-06-18 is followed by both. The client accepted the
    old result and refused the new one. That is precisely the diagnostic MC17's
    logging was added for, and it is the only reason this took minutes.
    **This is the second outage caused by `icons`, and the two attempts never
    separated their variables** — the first sent it under a revision that does
    not define it, the second changed the negotiated revision at the same time.
    So the honest state is: we do not know whether 2025-11-25 alone is safe, we
    know the pair is not, and the product had a working connector before either
    change and does again now.
    **Neither may be re-attempted without a way to test the handshake that does
    not cost a customer a broken reconnect.** A `curl` probe cannot detect this:
    the refusal happens inside the client, after a response the server considers
    successful. Until such a harness exists, the icon is served at
    `/favicon.ico` (correct, verified by decoding the bytes) and that is enough.
    Kept from MC20: nothing. Kept from the episode: the logging, and the rule
    that a change to the handshake is a change to the front door — it earns a
    reconnect test of its own, not a ride along with a feature.
26. **MC26 — `get_activity` was returning the newest of an arbitrary sample.**
    `listAsUser` issued a plain REST list with no `orderBy`, so it returned
    documents in **id** order — and activity ids are random auto-ids. Reading 200
    and sorting them in memory therefore sampled 200 arbitrary entries and
    presented the newest of *those* as the newest overall. On any Beat with more
    than 200 entries the answer was wrong, and wrong in the most plausible way
    available: real entries, real timestamps, correct ordering, just not the
    right ones. `search_comments` had the same shape. Both now order in the
    query, and `get_activity` fetches `limit` documents instead of 200 — so the
    fix is also four to six times cheaper. The app was always right here
    (`subscribeActivity` uses `orderBy("at","desc")`); only the MCP copy was not.
    *Generalises:* a bounded read whose ordering is applied after the bound is
    not a smaller answer, it is a different one.
27. **MC27 — Bounded scans say so (`coverage`).** Every tool that scans a
    collection capped at `MAX_LIMIT` now returns a `coverage` note when the read
    came back full. `truncated` already existed but answers a different question
    — how many *matches* were displayed — and its presence made the silence about
    source coverage look deliberate. Without this, "no blocked tasks in this Beat" and "no blocked tasks among the 200 I looked at" were the same
    response. Pagination would be the complete fix; disclosure is the honest
    minimum, and it ships now.
28. **MC28 — `lastActivityAt` is derived, never maintained (`list_beats`,
    `includeActivity`).** Opt-in, one ordered single-document read per Beat.
    *Rejected: a `lastActivityAt` field on the Beat document* — it was proposed
    here as "cheapest" and it is not. It costs a write per activity event (every
    task drag, edit, comment — hundreds a day on an active Beat) against a read
    per MCP call that asks (a handful a day), and Firestore writes cost roughly
    3× reads. The stronger objection is contention, not price: Firestore sustains
    about one write per second per document, so writing the Beat doc on every
    content change would serialise people who are not editing that document at
    all. Debouncing narrows the cost gap but not the contention, and adds a
    denormalized field that can drift. `joinedDate` is also returned and labelled
    as such — it is when *you* joined, not when the Beat was created, and the
    index holds no other date.
    The same reasoning drives the dashboard: `createdAt` **is** denormalized onto
    the index entry, because it is immutable — written once, cannot drift, no
    reconcile case — while `lastActivityAt` is fetched live per card, alongside a
    summary that already loads every feature, epic and resource.
29. **MC29 — Rate limiting lives on the connection document → DECIDED
    (`functions/src/mcp.ts`).** Two fixed windows, 60 calls/minute and 1,000/hour,
    counted per connection. The placement is the decision: `authenticate()`
    already reads that document on every request and marking the connection used
    already writes it, so the limiter costs **no extra read and no extra write**
    — the increment folds into the write that was happening anyway.
    `FieldValue.increment` rather than a transaction: it is atomic server-side,
    so two concurrent calls cannot both read 5 and both write 6, and a
    transaction would add a round trip to every call. The counters are a **nested
    map**, not dotted keys — `rate.minuteCount` is a field path only in
    `update()`; in a `set(…, {merge:true})` it creates a literal field with a dot
    in its name and the counter silently never moves.
    Two windows because one is always wrong: a per-minute cap alone lets a caller
    sit just under it indefinitely, an hourly cap alone lets a loop burn the
    allowance in seconds. **A refused call still counts**, or a caller in a loop
    resets its own budget by hitting the limit.
    Refusal is an **error result** (`isError: true`), not a JSON-RPC error: a
    protocol error surfaces to the customer as "the connector is broken", while a
    result the model can read lets the assistant say what is true and when to
    retry.
    *Accepted:* the count is read at request start and written without waiting,
    so a burst can overshoot slightly. Correct for abuse prevention; **this must
    not be described as a quota.** The numbers are a starting point, not a
    measurement — the `tool called` log lines carry the real distribution.
    *Deferred:* per-tool weighting. `search_comments` reads up to 400 documents
    and `list_beats` up to 50, so a flat cap is 3,000–24,000 reads a minute
    depending on which tool. Worth adding once there is usage to weight against.
    *Not covered by this, and stated so it is not assumed:* a user can multiply
    their budget by connecting several assistants. The fix is a **per-tier cap on
    connected assistants**, which is also the quantity-shaped gate that fits
    Plans-Spec §3 rather than breaking it with a feature gate (cf. MC10, MC22).
    `bestTierFor()` already supplies the tier.
    Supersedes `touchConnection`, now removed: one writer for this document, so
    `lastUsedAt` and the counters cannot drift apart.
30. **MC30 — `/oauth/register` is idempotent, and that is a control.** The
    endpoint is unauthenticated and writes a document, so the random id per
    request introduced with MP3 let anyone grow `mcpClients` without limit —
    unbounded storage from anonymous callers. The `client_id` is now derived from
    a hash of the registration's own content (redirect URIs, sorted, plus client
    name), so a repeat returns the **same** client and writes nothing at all: one
    read on a rare endpoint, and a thousand POSTs leave one document behind. The
    collection is bounded by distinct clients rather than by request count, and
    `createdAt` keeps meaning "first seen", which a blind re-write would have
    destroyed. Verified live: two identical registrations return one id, a
    different client name returns another.
31. **MC31 — A daily sweep deletes expired authorization codes and dead refresh
    tokens (`functions/src/mcpCleanup.ts`).** Neither collection had ever been
    cleaned: codes were deleted on exchange but never on expiry, and refresh
    tokens on rotation and revocation but never when a client simply stopped
    calling. **Not a security fix** — both hold only hashes and both are
    re-validated against a live connection before anything is issued — but a
    retention claim the privacy policy could not honestly make
    (`MCP-Privacy-Disclosure.md` §5). Scheduled rather than triggered because the
    condition is the passage of time: nothing *happens* when a code expires, which
    is precisely why they accumulated. The project's first scheduled function, so
    deploying it enabled Cloud Scheduler.
    *Rejected: deleting old refresh tokens whose connection is still live.* Age
    looks like a good abandonment signal, since rotation replaces a working
    client's token roughly hourly — but it cannot separate "abandoned" from
    "connected and idle", and the failure is silent and one-directional: a
    dormant connection the customer still wants stops working, with a reconnect
    as the only cure. The retention argument does not carry it either — while the
    connection is live it is listed in the customer's own UI and already holds
    their uid, so the token row discloses nothing further. The rule is therefore
    "the connection is revoked or gone", which is exactly the condition under
    which the token endpoint would refuse it anyway. Consequence to state in the
    policy: *deleted when the connection ends*, not *deleted after N days*.
    Malformed rows (no connection reference) are swept too — unvalidatable and
    unusable. Bounded per run and idempotent, so a retry or an overlapping
    schedule cannot do damage.
32. **MC32 — The resource-master tools are specified in `Resource-Master-Spec.md`,
    not here (RM21).** `search_roster`, `get_resource_usage` and `list_teams` are
    listed in §5 and phased with the feature that creates the data, because a tool
    is only as decided as the model underneath it. Three consequences belong to
    this spec, though:
    **They inherit permissions rather than adding any.** The service reads as the
    customer (§1), so workspace scoping and the workspace-owner-only master rates
    enforce themselves. This is the payoff MC-era §1 was arguing for: a new
    collection becomes readable through MCP with no second copy of the rule, and
    a rules bug stays one bug.
    **`get_resource_usage` extends an existing disclosure to a new channel.**
    Per RM7 it names Beats the caller cannot open. That was already decided for
    the UI, but an assistant *saying* it is more startling than a list showing it,
    so the tool description must state that these are Beats the user has no
    access to — the assistant should explain the boundary rather than imply the
    user can go and look.
    **Adding them is a surface change**, so `SERVER_INFO.version` moves, each
    needs `title` and behaviour hints (`MCP-Publishing-Spec.md` MP1), and every
    connected customer reconnects before they appear (MC15, MC19). If the
    directory listings (MP5) have shipped by then, the annotations are also a
    re-submission concern rather than a detail.
    *Deferred with the reasoning recorded so it is not re-proposed casually:*
    cross-Beat people load — the most valuable question the roster makes askable
    and the most expensive, N Beats × the per-Beat cost against tools already
    capped at `MAX_LIMIT`, which is the exact shape MC29's rate limiting exists
    for. Build a purpose-made aggregate if demand appears; do not fan out
    `get_people_load`.
