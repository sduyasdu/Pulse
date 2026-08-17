# Pulse — MCP Server Spec

Status: **Design agreed — MC1–MC9 decided; MC10–MC13 open with recommendations
(none blocking). v1 is read-only, customer-facing, distributed as a local
server.** · Owner: product + eng ·
Related: `Permissions-Spec.md` (the roles every tool inherits),
`Plans-Spec.md` (quotas an MCP write consumes), `Server-Functions-Spec.md`
(where the three new callables live), `Collaboration-Spec.md` (activity
attribution)

## 0. What this is (and isn't)

An **MCP server for Pulse**: a small program a customer runs alongside their AI
assistant, which lets the assistant read their Pulse data — "what's slipping",
"who's overloaded this month", "summarise Q3" — using the customer's own
permissions.

It is a **product feature**, not an internal tool (MC1). Any Pulse user can
connect an assistant, name the device, see it listed, and revoke it.

**Not** in scope for v1: writes of any kind (MC5 — the path is designed, not
built), billing or subscription access, member management or invitations, any
credential the assistant can read, and any hosted service that holds customer
tokens on Pulse's infrastructure (MC6).

## 1. The spine: the MCP acts as the user

Everything else follows from this.

Pulse has exactly one authorization boundary: **`firestore.rules`**. Roles,
archive locks, the last-owner guard, plan quotas and per-Pulse membership all
live there and nowhere else. A server that reached Firestore through the Admin
SDK would **bypass all of it** and have to re-implement every rule, correctly,
forever, in a second place — the precise failure this codebase is arranged to
avoid.

So the MCP holds a **Firebase Auth token belonging to the customer** and uses the
ordinary client SDK. Every read it makes is a read that customer could have made
in the browser. Nothing new is authorized; the assistant simply gets the same
window the user already has.

**The Admin SDK appears in exactly one place** — minting the token in §2, which
is a function, not the MCP.

## 2. Authentication: device authorization (MC2)

The MCP has no browser, so it cannot use the popup flow the app uses. It uses the
device-authorization pattern — the one a TV app uses — which never asks the
customer to copy a secret.

```
MCP                          Pulse functions                Customer's browser
 │
 ├─ startDeviceAuth() ──────────▶ create pending code
 │  ◀── { userCode: "WXYZ-1234",
 │        verificationUrl,
 │        deviceCode, interval }
 │
 │  prints: "Go to pulse.yasdu.com/link
 │           and enter WXYZ-1234"
 │                                                          ├─ opens /link
 │                                                          ├─ already signed in
 │                                                          ├─ names the device
 │                                                          └─ Approve
 │                                ◀───────────────────────── approve(userCode)
 │                                create users/{uid}/devices/{deviceId}
 │                                mint custom token, claims:
 │                                  { deviceId, scope: "read" }
 ├─ pollDeviceAuth(deviceCode) ─▶
 │  ◀── { customToken }
 │
 └─ signInWithCustomToken() → ID token + refresh token → Firestore, under rules
```

Three callables, all in `functions/src/mcp.ts`:

| Callable | Auth | Does |
| --- | --- | --- |
| `startDeviceAuth` | none | mints a `userCode` + `deviceCode` pair, stores it pending with a short TTL |
| `approveDevice` | signed-in user | binds the code to their uid, creates the device record, marks it approved |
| `pollDeviceAuth` | none | `deviceCode` → `pending` \| `expired` \| `{ customToken }`, once only |

Details that matter:

- **`userCode` is short and typed by a human** (`WXYZ-1234`, unambiguous
  alphabet — no `O`/`0`, `I`/`1`). **`deviceCode` is long and never displayed.**
  Only the long one exchanges for a token; the short one is only ever a lookup
  key for the approval page.
- **Pending codes expire in 10 minutes** and are single-use. The polling interval
  is server-dictated, and polling faster than instructed is refused.
- **The approval page is a new route, `/link`** (`App.tsx` has `/login`, `/`,
  `/p/:pulseId`, `/join/…` today). It must show **what the device will be able to
  see** before the Approve button — "read your Pulses and their contents" — not
  after.

## 3. Devices and revocation (MC4)

The customer's requirement — revoke a device from inside Pulse — is what shapes
the token design.

Firebase's own `revokeRefreshTokens(uid)` is useless here: it kills **every**
session for that user, including their browser. Per-device revocation has to be
something Pulse enforces itself.

**The mechanism:** the custom token carries a `deviceId` **custom claim**, and
the rules require the matching device document to still exist.

```
// firestore.rules — the MCP session gate
function isMcpSession()  { return 'deviceId' in request.auth.token; }
function deviceLives()   { return exists(/databases/$(database)/documents/
                             users/$(request.auth.uid)/devices/$(request.auth.token.deviceId)); }
function mcpCanRead()    { return !isMcpSession() || deviceLives(); }
```

Every existing `allow read` gains `&& mcpCanRead()`. A browser session has no
`deviceId` claim, so `isMcpSession()` is false and nothing changes for it.

**Revoking is deleting the device document**, and it takes effect on the next
request — rules re-evaluate `exists()` per request, so a cached ID token does not
buy the device another hour. That immediacy is the whole reason for doing it this
way rather than by token expiry.

`users/{uid}/devices/{deviceId}` holds: `name` (customer-supplied), `createdAt`,
`lastUsedAt`, `scope`, and the client name the MCP reported. The customer sees
that list in **Account → Connected devices**, with a revoke button per row and
"last used" beside it, so a device nobody uses is visibly prunable.

> ⚠️ **This adds one rules-level document read per MCP request.** Rule `get()`/
> `exists()` calls are billed as reads, and an assistant enumerating a Pulse
> multiplies them. Accepted as the cost of immediate revocation, but it is a real
> line in the bill and the reason §5 bounds every read.

## 4. Read-only first, writes designed for (MC5)

v1 mints tokens with `scope: "read"` and exposes no write tool. But the shape is
fixed now so writes are an increment, not a redesign:

- **The claim already exists.** Writes will gate on
  `request.auth.token.scope == 'write'`, so an existing read token can never
  become a write token by accident — scope is decided at approval, and changing
  it means approving again.
- **The approval page already names the scope**, so adding "…and create or edit
  tasks" is a copy change, not a new consent model.
- **Attribution is designed in from the start (MC7).** A write made by an
  assistant must not read as a human's edit in the activity log. Activity entries
  from an MCP session carry `via: "mcp"` and the device name, and the UI renders
  "*Ana's laptop (via MCP)*". Without this, "who changed what" quietly becomes
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

## 6. Distribution and transport (MC6)

**A local server, published to npm, run over stdio** — `npx @yasdu/pulse-mcp`.

The alternative is Pulse hosting a remote MCP endpoint. Rejected: it would mean
Pulse storing and refreshing customer auth tokens on its own infrastructure, in a
service reachable from the internet, for a feature whose entire value is reading
data the customer can already read. A local process keeps the credential on the
customer's machine, where their assistant already runs.

The refresh token is persisted by the Firebase SDK in a config file under the
user's home directory, `0600`. It is scoped to one device record, and revocable
from Pulse — so a leaked file is a revocation, not an incident.

## 7. Phasing (MC9)

1. **Phase 0 — internal, unpublished.** Same code, same device flow, used by the
   team against real Pulses for a fortnight. The point is to find out **which
   tools are actually worth exposing** before the surface becomes a public
   contract that can't be changed freely.
2. **Phase 1 — customer read-only.** Publish the package, ship `/link` and
   Account → Connected devices, document it in help (§8).
3. **Phase 2 — writes.** `scope: "write"`, the write tools, `via: "mcp"` in the
   activity UI, and a re-approval path for existing read devices.

## 8. What else has to move

- **`/link` route + approval page**, showing scope before consent.
- **Account → Connected devices**, with per-device revoke and "last used".
- **Rules**: `mcpCanRead()` on every read; the write gate in Phase 2.
- **`rules/security.test.ts`**: an MCP-claimed token reads what the user can and
  nothing more; a deleted device is refused **immediately**; a read-scope token
  is refused any write (Phase 2). The allow side matters as much — a browser
  session must be entirely unaffected.
- **Help** (`src/help/*.ts`, all six languages): what connecting an assistant
  does, and how to revoke it. A permission-granting feature with no explanation
  is one nobody trusts.
- **i18n**: the approval page and device list, six locales.

## 9. Decisions

1. **MC1 — Who is it for? → DECIDED: customers.** Any Pulse user can connect
   their own assistant. *Rejected: an internal-only tool* — it would answer a
   different question, and the design constraints (consent, revocation, support)
   only appear when strangers use it. Phase 0 (MC9) still dogfoods it first,
   which captures most of the learning without the smaller scope.
2. **MC2 — Authentication → DECIDED: device authorization flow.** No copied
   secret, and the customer approves in a browser where they are already signed
   in. *Rejected: personal access tokens* — a long-lived string in a config file
   is a leak that stays valid until noticed, and the copy-paste step is where
   setup goes wrong.
3. **MC3 — The MCP acts as the user, never as an admin. → DECIDED.** The client
   SDK with the customer's token, so `firestore.rules` stays the only
   authorization boundary. *Rejected: a service account* — it bypasses every
   rule and duplicates the entire permission model in a second place, which is
   the failure mode this codebase exists to avoid.
4. **MC4 — Per-device revocation → DECIDED: `deviceId` custom claim + a device
   document the rules require to exist.** Deleting the document revokes on the
   next request. *Rejected: `revokeRefreshTokens(uid)`* — it signs the customer
   out of their browser too. *Rejected: short-lived tokens* — revocation would
   lag by the token's lifetime, and "revoke" that takes an hour is not revoke.
   Cost accepted: one extra billed read per MCP request.
5. **MC5 — Read-only in v1 → DECIDED, with the write path designed now.** The
   `scope` claim, the consent copy and the attribution field all exist from the
   start, so Phase 2 adds tools rather than rethinking consent. *Rejected:
   shipping writes at once* — the first fortnight of real use should not be able
   to damage a customer's data.
6. **MC6 — Local stdio, published to npm → DECIDED.** *Rejected: a hosted remote
   MCP* — Pulse would store and refresh customer credentials on internet-facing
   infrastructure, a large liability for a feature that reads data the customer
   already has.
7. **MC7 — Assistant writes are attributed → DECIDED: `via: "mcp"` + device name
   on activity entries.** *Rejected: recording them as ordinary user edits* —
   the activity log's only job is "who changed what", and an assistant's edit
   credited to a human makes it quietly untrue.
8. **MC8 — Every read is bounded → DECIDED.** Default and maximum limits,
   pagination, reader-shaped output. *Rejected: raw document passthrough* — it
   costs the customer twice, in Firestore reads and in context, and makes the
   assistant do joins it will sometimes get wrong.
9. **MC9 — Phase 0 internal before customer release → DECIDED.** A fortnight of
   real use decides the tool surface before it becomes a contract.
10. **MC10 — Is the MCP plan-gated?** Should Starter get it, or is it a Pro
    feature? *Recommend: available on every tier.* It reads data the customer
    already owns, the cost is bounded by §5/§8, and gating an integration behind
    a plan is how integrations fail to get adopted. Revisit if read volume
    becomes a real cost line — the device record makes per-customer measurement
    easy.
11. **MC11 — Rate limiting per device?** *Recommend: yes, a simple per-device
    ceiling in the callable, once Phase 0 shows the real shape of traffic.* An
    assistant in a loop is the plausible failure, and it spends the customer's
    money and Pulse's quota at once.
12. **MC12 — Device token lifetime.** Should a device expire after N days
    unused? *Recommend: no hard expiry, but surface `lastUsedAt` prominently and
    prompt to prune. A device that stops working silently is worse support load
    than one the customer chose to keep.*
13. **MC13 — Does the assistant see cost data by default?** `get_costs` mirrors
    `viewPeopleCost`, so admins see people cost and others don't. *Recommend:
    keep it mirrored rather than adding a separate MCP-level toggle — a second
    permission axis for the same data is how the two drift.*
