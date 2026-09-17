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

**And it will happen twice if you let it.** The same field broke connection setup
a second time after being sent *legitimately*, under a newer revision the client
itself had asked for — because that change also moved the negotiated revision, and
the two variables were never separated. Both times the server saw a clean OAuth
exchange, 200s, and no errors.

Two rules come out of that, and they are worth more than the specific field:

- **Change one thing about the handshake at a time.** Adding a member and moving
  the revision in one deploy leaves you unable to say which broke it.
- **A `curl` probe cannot test this.** The refusal happens inside the client,
  after a response you consider successful. If you cannot exercise the handshake
  end to end without a customer reconnecting, you have no way to verify a change
  to it — so treat the handshake as the front door: it earns its own test, rather
  than riding along with a feature.

## 7.8 Clients cache the tool list

Adding a tool does not reach connected clients. They cached the list when they
connected, so a new tool is invisible until they reconnect — and the customer
experiences that as your feature not working.

**Plan for the reconnect. Do not plan to avoid it.**

The protocol's escape hatch is `notifications/tools/list_changed`, and there is a
clever way to send it without a standing connection: Streamable HTTP lets a POST
be answered with an SSE stream carrying notifications ahead of the result, so the
notification rides back on an ordinary tool call.

**This was built, and it never fired once.** Measured against a real client, two
things made it moot:

- The client **re-runs `initialize` + `tools/list` at the start of every
  session**, not only when the connector is added. So `tools/list` always
  precedes any `tools/call`, the staleness flag is cleared before a tool call
  could carry the notification, and the mechanism only has a window if a deploy
  lands mid-session.
- **The protocol layer was never what blocked.** The logs showed the full new
  tool list served to the *existing* connection a minute before the customer
  reconnected. What actually needed the reconnect was the client's own connector
  UI — its enabled-tool list, cached above the protocol, where a server cannot
  reach.

So: build it if you like — it is correct for a client that caches across
sessions and it costs one field on a document you already read — but **do not
tell anyone it removes the reconnect.** Put the reconnect in your release notes.

**Version your server by the tool surface, not by the code** — bump when a tool
is added, removed, or changes shape, and not otherwise. Worth doing regardless of
the above: it is the only staleness signal that exists, and it is what makes a
log line say which surface a client is actually holding.

The genuinely useful half: **only the declared surface is cached.** Changing what
a tool *returns* needs nothing, so most iteration is free — it is specifically
the shape of the menu that is sticky.

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
- **Order in the query, not after the bound.** "Read 200 and sort them" is not a
  smaller answer than "the newest 30" — it is a *different* one. If ids are
  random, an unordered page is an arbitrary sample, so the newest of it is not
  the newest of anything. This shipped, looked entirely plausible (real rows,
  real timestamps, correct ordering) and was wrong on every collection larger
  than the page. Ordering in the query also costs less: fetch `limit` rows, not
  200.
- **Say when a scan was bounded.** If a read came back exactly full, there was
  probably more behind it — and silence reads as completeness. "No blocked tasks
  in this Beats" and "no blocked tasks among the 200 I looked at" must not be the
  same response. Pagination is the complete fix; a `coverage` note is the honest
  minimum and ships in an hour.
- **Fewer, task-shaped tools beat one per table.** "What is this person's load
  next month" is a tool; four joins the assistant has to compose is not.
- **Mirror your existing field-level permissions.** If some roles can't see
  costs in the UI, they can't see costs here — via the same rules (§7.2), not a
  second check that will drift.

## 7.11 Rate limiting, and unauthenticated writes

An assistant in a loop is the plausible failure: it spends your compute and the
customer's read quota at machine speed, and nothing else in this design stops it.

**Put the counters where you already read and write.** If every authenticated
request already fetches a connection record, and marking it used already writes
one, a limiter on that record costs **no extra read and no extra write** — the
increment folds into the write that was happening anyway. Look for that document
before reaching for a separate store or a Redis.

Five details that decide whether it works:

- **Atomic increment, not read-modify-write.** A server-side `increment` cannot
  lose a concurrent update, and it avoids the round trip a transaction adds to
  every call.
- **Two windows, not one.** A per-minute cap alone lets a caller sit just under
  it forever; an hourly cap alone lets a loop burn the allowance in seconds.
- **A refused call still counts.** Otherwise a caller in a loop resets its own
  budget by hitting the limit.
- **Refuse as an error *result*, not a protocol error.** A protocol error
  surfaces to the customer as "the connector is broken". A result the model can
  read lets the assistant say what is true and when to retry.
- **Check your store's update semantics.** Nested-vs-dotted field paths, merge
  behaviour, whether a partial write drops sibling fields — get one wrong and you
  ship a limiter that looks implemented and enforces nothing. Assert the shape of
  the update itself in a test, not just the decision.

Accept that a burst can overshoot slightly: the count is read at request start
and written without waiting. That is right for abuse prevention — **do not
describe it as a quota**, and pick the numbers from your own logs rather than
from a blog post.

**Weight by what a call actually costs**, eventually. Tools are not comparable:
one that joins two collections can read ten times what a list does, so a flat
per-call cap spans an order of magnitude in real cost. Ship flat, weight later.

**A per-connection limit does not bound a user**, who can connect several
assistants. The cap that does is a limit on *connected assistants*, which is also
usually a better fit for a quantity-based pricing model than gating the feature
outright (`billing.md`).

**Finally: any unauthenticated endpoint that writes a document is a storage
leak.** Dynamic client registration is the one that catches people — it is public
by protocol, and a random id per request lets anyone grow the collection without
limit. The fix is not a rate limit, it is **idempotence**: derive the id from a
hash of the registration's own content, so a repeat returns the same record and
writes nothing. The collection is then bounded by distinct clients rather than by
request count.

## 7.12 Publishing to the assistant directories

Listing is a review queue with concrete, checkable requirements. Two are named by
the vendors themselves as leading causes of rejection, and both are cheap:

1. **Annotate every tool** — a human-readable `title`, plus behaviour hints
   (`readOnlyHint`, `destructiveHint`, and `openWorldHint` where the vendor wants
   it). Declare all of them even if one vendor only checks two: two annotation
   sets kept in step is a second thing to get wrong. Note that `openWorldHint` is
   about whether the tool's *effects escape into an open-ended world*, not about
   whether your server is on the internet.
2. **A published privacy policy.** Missing or incomplete is an immediate
   rejection, not a review note.

Then the ones that take real time:

- **Domain ownership proof** — usually a token at a well-known path. Watch the
  §7.4 trap: if your host drops dot-directories, serve it from code.
- **A demo account with realistic data.** The most underestimated item — a
  reviewer must be able to use the product end to end, and an empty account fails.
- **Docs, example prompts, an icon, a support contact**, and for some vendors
  test cases and a video.

Three things worth knowing before you plan around it:

- **Vendors differ more than the shared protocol suggests.** One may need you to
  be on a paid organisation plan to reach the submission portal at all; another
  requires explicit domain verification; a third may have **no self-serve
  directory** and only a per-customer enterprise route, which is documentation
  work rather than a submission.
- **A callback allowlist scales badly.** Hardcoding one vendor's redirect origin
  blocks every other. Validate by parsing the URI and comparing the host — never
  `startsWith`, which accepts `yourvendor.com.attacker.test` — and bind the
  redirect to what the client declared at registration.
- **Copy each vendor's origins from their docs; never guess one.** A wrong origin
  in a security control is worse than a missing one, because it looks handled.

Write it down. Directory programmes change faster than any note about them, so
record what you verified **and when**, with the source, and re-read the vendor
docs before submitting rather than trusting your own summary.

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
    enforced yet — counters on a record you already read, refused calls counted,
    and the update's shape asserted in a test.
13. Every unauthenticated write path idempotent, so it is bounded by distinct
    callers rather than by request count.
14. Bounded scans disclose that they were bounded, and time-ordered reads order
    in the query rather than after the page.
15. If you intend to publish: every tool annotated with a title and hints, a
    published privacy policy, domain verification served from code, and a demo
    account with real data.

## Your tool names are a published contract, and some consumers cannot re-read it

Renaming an MCP tool looks safe. Clients call `tools/list`, the server declares
`listChanged`, and everything re-syncs — so the rename "costs a refresh, not a
reconnection". That is true **of clients**.

It is not true of everything downstream. This project renamed `list_pulses` →
`list_beats` and `get_pulse` → `get_beat`, and silently broke all three skills in
its own plugin repository, because a skill names tools **in prose**:

```md
1. `beats:get_beat` with the chosen `beatId` — gives you every task with…
```

Prose does not re-list. Nor do saved prompts, a customer's automation, docs, or
anything else that wrote the name down. And the plugin lived in a separate
repository that does not update itself, so nothing in the main project's tests,
types or build could have noticed.

**Before renaming anything on a published surface, enumerate who wrote it
down.** For a tool name that is: your own skills and plugins, the listing copy
in any directory, example prompts, support articles, and any customer
integration you know of. The rename is cheap; finding the consumers afterwards
is not.

The same reasoning is why a connector's **OAuth issuer** is worth checking
separately rather than assuming: it is an identifier clients store, and whether
changing it invalidates anything depends on how your tokens are actually
verified. In this project it turned out not to — access tokens were Firebase ID
tokens verified against Google's issuer, refresh tokens were opaque hashes — but
that was established by reading the verification path, not by reasoning about
what "issuer" usually means.
