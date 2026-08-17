# AI access (MCP)

Exposing your product to an AI assistant over the Model Context Protocol. This
is an **authorization surface before it is a feature**: you are handing a program
the ability to read a customer's data on their behalf, and every mistake here is
a data-exposure mistake rather than a rendering one.

Read this before writing the first endpoint. Most of what follows is cheap to
decide up front and structural to change later.

## 7.1 Three decisions that determine everything else

| Decision | Options | What it costs to change later |
| --- | --- | --- |
| **Who is it for?** | Your customers / your own team | Everything. A team tool can use a shared key; a customer tool needs per-user OAuth and a revocation UI. |
| **Remote or local?** | Hosted endpoint / a package the customer runs | Remote means you pay for compute and can ship fixes centrally; local means the customer installs and updates, and every version in the wild is yours to support. |
| **Read or write?** | Read-first / write from day one | Read-first is right, but **design the token for write immediately** — see §7.5. |

Answer the first one out loud. "For customers" makes this an authenticated
multi-tenant API with a consent flow, which is a much larger thing than an
internal integration, and teams routinely start building the second while
describing the first.

## 7.2 The service acts as the customer — never as an admin

This is the whole architecture in one line, and it is what keeps the surface
small enough to reason about:

> The MCP service reads the customer's data **through the same authorization
> path the browser uses**, with the customer's own credentials. Your existing
> server-side rules stay the only authorization boundary.

The tempting alternative is to read with your admin credentials and filter in
the tool handler. Don't. Admin SDKs bypass your rules by design, so every tool
becomes a place where a missing `if` leaks another tenant's data, and you now
have two authorization systems that must agree forever.

Concretely: exchange the OAuth grant for **a credential your ordinary data API
accepts**, then call that API as the customer. Use elevated privileges for
exactly two things — minting that credential, and writing server-owned fields on
the connection record.

The payoff is that a tool you add later inherits authorization for free, and a
rules bug is one bug rather than two.

## 7.3 The token you return must be one the client can actually use

**An MCP client knows nothing about your auth vendor.** It receives
`access_token` and puts it in an `Authorization: Bearer` header. That is the
entire contract.

So if your identity provider issues an intermediate artefact meant to be
exchanged by *its own SDK*, returning that as `access_token` produces a client
that authenticates successfully against your OAuth endpoint and is then rejected
on every single API call. Exchange it server-side and return the bearer your API
actually verifies.

Test this by calling your own MCP endpoint with `curl` and nothing else. If a
bare HTTP client can't use the token, no MCP client can.

## 7.4 One origin, or clients reject you

Discovery names an issuer; the authorize, token, registration and MCP endpoints
must all live on **that same origin**. Serving the metadata from your domain
while the endpoints sit on your cloud provider's hostname is an arrangement some
clients refuse outright — and the customer sees your vendor's hostname during
consent, which is its own problem.

If your functions have their own hostnames, put rewrites in front of them so
everything is same-origin.

**Two static-hosting traps sit right here**, and both produce `200` with the
wrong content type — which is worse than a 404, because a 404 is legible and a
200 of HTML is a parse error the client reports as something else:

- A **SPA catch-all rewrite** answers every unmatched path with `index.html`.
  Your `.well-known` documents, and any icon path a client probes, come back as
  HTML. Put the metadata routes *before* the catch-all, and put real files at
  `/favicon.ico` and `/apple-touch-icon.png`.
- **Ignore rules that drop dot-directories** (`**/.*`) silently exclude
  `public/.well-known/` from the deploy. The files exist in the repo, pass
  review, and never ship. Serve discovery from code, not from static files, if
  your host does this.

## 7.5 Revocation is a token-lifetime design, not a delete button

Decide these four together — they are one mechanism:

1. **Short access tokens** (an hour). This number *is* your revocation
   guarantee: "stops working within an hour" is what you can honestly promise.
2. **Your own refresh token**, rotated on every use, stored **only as a hash**.
   A breach of your database then yields nothing replayable.
3. **Revocation bites at refresh.** A revoked connection cannot renew; the
   outstanding access token runs out its remaining hour. Say this plainly in the
   UI rather than implying instant death.
4. **Scope lives on the connection record and is re-minted on every refresh** —
   not carried forward from the previous token. This is why read-first costs you
   nothing later: granting write becomes a field change, not a re-consent, and
   nothing depends on whether your identity provider preserves custom claims
   across a refresh.

Store per connection: a customer-supplied name, what the client called itself
(untrusted), scope, created, last used, revoked. Last-used is what makes an
abandoned connection visibly prunable.

**Deleting a connection is not revoking it.** If deletion is offered at all,
allow it only for an already-revoked connection. Deleting a live one usually
half-works as a disconnect — the record vanishes so refresh fails, but the
outstanding token keeps reading — while destroying the evidence that anything
was ever connected.

## 7.6 Consent has to be readable

The consent screen is the only moment the customer decides. State **what the
assistant will be able to see, before the button**, in concrete nouns, and state
what it cannot do — "read-only" is only reassuring if the reader believes you
know the difference.

Let them **name the connection**, so the revocation list means something later.
And keep consent inside your normal signed-in app rather than building a second
login: a second auth path is a second thing to keep correct.

## 7.7 Answer only in the shape you negotiated

`initialize` announces a protocol revision. **Send only members that revision
defines.** Adding a field from a newer draft is not harmlessly additive: a client
validating the response can refuse the session, and when it does, your server
sees a clean handshake, `2xx` responses and no errors at all.

The same rule covers transport. Answer with an event stream only if the client's
`Accept` header offered one; return plain JSON otherwise.

This generalises past MCP: **an integration can fail entirely on a response you
consider successful.** Which is why §7.9 exists.

## 7.8 Clients cache the tool list

Adding a tool does not reach connected clients. They cached the list when they
connected, so a new tool is invisible until they reconnect — and the customer
experiences that as your feature not working.

Two ways out, in order of preference:

- **Announce the change on a response you are already sending.** Streamable HTTP
  lets a POST be answered with an SSE stream carrying notifications ahead of the
  result, so `notifications/tools/list_changed` can ride back on an ordinary tool
  call. No standing connection, no held-open compute. Store on each connection
  which server version it last listed at; notify while it differs, clear it when
  the client re-lists. It converges by itself.
- **Tell people to reconnect**, in release notes, if you don't build the above.

Either way, **version your server by the tool surface, not by the code** — bump
it when a tool is added, removed, or changes shape, and not otherwise. That
version is the staleness signal; a version that never moves gives a client
nothing to notice.

Two limits worth stating in your own docs: this only helps clients that
connected *after* you built it, so the change that introduces the mechanism
still needs a reconnect. And only the declared surface is cached — changing what
a tool *returns* needs nothing, so most iteration is free.

## 7.9 Log the handshake, or you will debug blind

A failing connector gives you a customer saying "it didn't work" and a
reference ID that means nothing to you. Log, at minimum:

- **`initialize`** — client name and version, the revision asked for, the
  revision answered, and a flag when they differ. Answering a version the client
  didn't ask for is a thing it may walk away from.
- **the client's `initialized` notification** — this is the *only* evidence it
  **accepted** your `initialize` result. When a client validates your response
  and refuses it, that missing line is the entire diagnosis.
- **tool list served, with the count** — answers "did this client actually see
  the new tools?" without reproducing anything.
- **methods you don't implement** — routinely probed, not an error, but the only
  place that will ever tell you a client needed something.

## 7.10 Design tools for a reader, not for your schema

- **Resolve identifiers to names.** An assistant handed `ownerId: "u_8fa2"` will
  either say that out loud or guess.
- **Clamp every limit** server-side, and return a count alongside results.
- **Fewer, task-shaped tools beat one per table.** "What is this person's load
  next month" is a tool; four joins the assistant has to compose is not.
- **Mirror your existing field-level permissions.** If some roles can't see
  costs in the UI, they can't see costs here — via the same rules (§7.2), not a
  second check that will drift.

## 7.11 Cost and abuse

An assistant in a loop is the plausible failure, and it spends your compute and
the customer's quota at once. Rate-limit per connection, cap result sizes, and
decide early whether AI access is plan-gated — the gate is easy to add and
awkward to add *retroactively* once customers rely on it.

## Checklist

1. Audience, remote/local, and read/write decided explicitly.
2. Service reads **as the customer**; elevated privileges used only to mint
   credentials and write server-owned fields.
3. `access_token` verified usable by a bare `curl`.
4. Issuer, OAuth endpoints and MCP endpoint all on **one origin**; discovery
   documents confirmed not to be answered by the SPA catch-all.
5. Refresh tokens rotated and hashed; revocation enforced at refresh; access-token
   TTL is the guarantee you state in the UI.
6. Scope stored on the connection and re-minted per refresh, so write can land
   without re-consent.
7. Consent screen names what it can and cannot do, before the button.
8. Responses contain only members of the announced revision; streaming only when
   the client's `Accept` allows it.
9. Server version tracks the tool surface; stale clients are told, or the
   reconnect requirement is documented.
10. Handshake logging in place — including the `initialized` notification.
11. Revocation list in the UI, with a **read error state distinct from empty**.
12. Rate limits and result caps decided, and plan-gating decided even if not
    enforced yet.
