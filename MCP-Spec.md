# Pulse — MCP Server Spec

Status: **Design agreed — MC1–MC10 decided; MC11–MC13 open with recommendations
(none blocking). v1 is read-only, customer-facing, and hosted by Pulse.
MC2/MC4/MC6 were revised 2026-08-17 when remote replaced local — see each.**
· Owner: product + eng ·
Related: `Permissions-Spec.md` (the roles every tool inherits),
`Plans-Spec.md` (quotas an MCP write consumes), `Server-Functions-Spec.md`
(where the three new callables live), `Collaboration-Spec.md` (activity
attribution)

## 0. What this is (and isn't)

An **MCP server for Pulse**, hosted by Pulse and added to an AI assistant by
URL. It lets the assistant read the customer's Pulse data — "what's slipping",
"who's overloaded this month", "summarise Q3" — using the customer's own
permissions.

It is a **product feature**, not an internal tool (MC1). Any Pulse user can
connect an assistant, name the connection, see it listed, and revoke it.

**Not** in scope for v1: writes of any kind (MC5 — the path is designed, not
built), billing or subscription access, member management or invitations, and
**storing any long-lived customer credential on Pulse's servers** (§2 — the
refresh token lives with the customer's AI client, not with us).

## 1. The spine: the MCP acts as the user

Everything else follows from this.

Pulse has exactly one authorization boundary: **`firestore.rules`**. Roles,
archive locks, the last-owner guard, plan quotas and per-Pulse membership all
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
browser where they are already signed in, see the connection listed in Pulse,
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

**Pulse stores no long-lived customer credential.** The refresh token is handed
to the AI client and lives there; Pulse's `/oauth/token` endpoint refreshes by
proxying to Firebase's secure-token endpoint. A breach of Pulse's servers
therefore does not yield a set of customer credentials — which was the main
argument against hosting this, and it is answered by design rather than accepted
as a risk.

**Every request is made *as the customer*.** The MCP server verifies the bearer
ID token, then reads Firestore **through the REST API using that same token**, so
`firestore.rules` evaluates exactly as it does for the browser (§1). The server
never uses the Admin SDK for customer data — only to mint the custom token at
authorize time.

> ⚠️ **Verify before building:** that additional claims attached via
> `createCustomToken` survive a token *refresh*. If they do not, `connectionId`
> must be carried another way — the fallback is §3, which does not depend on the
> claim at all. Confirm empirically against the SDK; do not take this paragraph's
> word for it.

The **device-code flow is retained for the optional local server** (MC6), where
no browser is available. It produces the same connection record and the same
revocation behaviour, so §3 covers both.

## 3. Connections and revocation (MC4, revised)

The customer's requirement — revoke a connection from inside Pulse — is
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
  create-Pulse through it hits the same `workspace.pulseCount` gate as the UI.
  Nothing extra to build, and nothing to forget.

## 5. What v1 exposes

MCP separates **resources** (things to read) from **tools** (things to call).
Pulse v1 is resources plus read-shaped tools.

| Name | Kind | Returns |
| --- | --- | --- |
| `list_pulses` | tool | the customer's Pulses: id, name, role, archived |
| `get_pulse` | tool | one Pulse: epics, tasks, resources, statuses |
| `search_tasks` | tool | tasks matching text/status/epic/assignee, across one Pulse |
| `get_schedule` | tool | tasks in a date window with dates, effort and assignees |
| `get_people_load` | tool | per-person allocation over a window, against capacity |
| `get_costs` | tool | cost summary by model / person / task — **admins only**, mirroring `viewPeopleCost` |
| `get_activity` | tool | recent changes on a Pulse |

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

**A remote MCP server that Pulse hosts, added by URL**, over the current
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
that is new for Pulse.

**Firestore reads are the dominant cost either way**, billed to Pulse, and
unaffected by this decision: a `get_pulse` over a 200-task Pulse is 200-plus
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
   team against real Pulses for a fortnight. The point is to find out **which
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
  route with the consent screen), `/oauth/token` (issue + refresh by proxying to
  Firebase). The consent screen names the scope **before** the Approve button,
  not after.
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
- **An uptime story.** This is the first Pulse surface whose outage breaks
  something outside the app (MC6). Decide what "down" means and who hears about
  it before customers do.

## 9. Decisions

1. **MC1 — Who is it for? → DECIDED: customers.** Any Pulse user can connect
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
   *Rejected: Pulse storing the refresh token* — it would recreate exactly the
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
   on their own machine. **Accepted cost: an uptime obligation** — the first
   Pulse surface whose outage breaks something outside the app.
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
11. **MC11 — Rate limiting per connection?** *Recommend: yes, a simple per-connection
    ceiling in the callable, once Phase 0 shows the real shape of traffic.* An
    assistant in a loop is the plausible failure, and it spends the customer's
    money and Pulse's quota at once.
12. **MC12 — Connection lifetime.** Should a connection expire after N days
    unused? *Recommend: no hard expiry, but surface `lastUsedAt` prominently and
    prompt to prune. A connection that stops working silently is worse support load
    than one the customer chose to keep.*
13. **MC13 — Does the assistant see cost data by default?** `get_costs` mirrors
    `viewPeopleCost`, so admins see people cost and others don't. *Recommend:
    keep it mirrored rather than adding a separate MCP-level toggle — a second
    permission axis for the same data is how the two drift.*
