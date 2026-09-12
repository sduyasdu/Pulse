# MCP Publishing — getting Beats' connector into the assistant directories

Status: **Researched 2026-08-18. MP1–MP6 decided; MP7–MP9 open (privacy policy,
rate limiting, listing assets — none are engineering blockers to the code
work).** · Owner: product + eng ·
Related: `MCP-Spec.md` (the server this publishes — MC1–MC28),
`Plans-Spec.md` (MC10's entitlement gate), `About-Spec.md` (the legal entity a
privacy policy must name)

## 0. What this is

`MCP-Spec.md` covers the server. This covers **distribution**: what each
assistant vendor requires before it will list Beats, what Beats fails today, and
the decisions taken to close the gap.

Written from the vendors' own submission docs, read on 2026-08-18. Directory
programmes change faster than this file will; **re-read the source docs before
submitting** rather than trusting the summary below. Every claim here carries its
source.

## 1. The three surfaces, and how different they are

| | Claude Connectors Directory | ChatGPT (apps as plugins) | Google Gemini |
| --- | --- | --- | --- |
| **Self-serve?** | Yes | Yes | Only Gemini Enterprise, per customer |
| **Public listing?** | Yes | Yes | No |
| **Gate** | Needs a Claude **Team or Enterprise** org — the portal lives in admin settings | Verified individual/org on the OpenAI platform dashboard | Consumer app is **partnership-only**; no submit button exists |
| **Tool annotations** | `title` + `readOnlyHint`/`destructiveHint` | `readOnlyHint`, `openWorldHint`, `destructiveHint` — all three, explicit | — |
| **Domain proof** | Must demonstrate you own the API and domain | Token hosted at `/.well-known/openai-apps` on the MCP domain | — |
| **Privacy policy** | Required; missing = **immediate rejection** | Required, published | — |
| **Extra** | Test account with realistic data, docs URL, ≥3 example prompts, icon | 5 positive + 3 negative test cases, demo video | Streamable HTTP only (SSE deprecated) |

Sources: [Claude submission docs](https://claude.com/docs/connectors/building/submission),
[OpenAI app submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines),
[Tallyfy on Gemini routes](https://tallyfy.com/how-to-list-mcp-server-google-gemini/).

The asymmetry worth internalising: **Claude and ChatGPT are review queues you
can enter today; Google is not a queue at all.** For Gemini the deliverable is
documentation a customer's own Cloud admin follows, not a submission.

## 2. What Beats failed on when this was assessed

1. **No tool annotations anywhere.** All nine tools carried `name`,
   `description`, `inputSchema` and nothing else. Both vendors name this as a
   leading rejection cause. → MP1.
2. **Only Claude could complete OAuth.** `ALLOWED_REDIRECT_PREFIXES` listed
   `claude.ai`, `claude.com` and loopback, so any other vendor's callback was
   refused before the consent screen ever rendered. One hardcoded constant
   blocked two of three directories. → MP2, MP3.
3. **No domain-verification route**, and the obvious place to put one is a trap:
   Hosting's `ignore: ["**/.*"]` silently drops dot-directories from the deploy,
   which is why OAuth discovery is already served from a function (MCP-Spec §8).
   → MP4.
4. **No privacy policy at all.** → MP7 (open).
5. **Rate limiting still open** (MC11), and both vendors review against security
   standards. → MP8 (open).

## 3. Decisions

1. **MP1 — Every tool declares `title` and all three behaviour hints.**
   Not just the two Claude requires: OpenAI wants `readOnlyHint`,
   `openWorldHint` and `destructiveHint` explicitly, and a tool set annotated for
   one directory but not the other is a second thing to keep in step. All nine
   are reads against the customer's own data, so all nine are
   `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` — the
   last because these tools reach only Beats' own store, never the open
   internet. **When Phase 2 lands writes, these flip per tool and it is a
   submission-affecting change, not a detail.**
2. **MP2 — Redirect validation is host-exact, parsed, not prefix-matched.**
   `isAllowedRedirect` now parses the URI and compares `hostname` against an
   allowlist, rather than `startsWith` on a string. Prefix matching on a URL is
   the classic way to accept `https://claude.ai.evil.test/...`; parsing removes
   the whole class. HTTPS is required except on loopback, where desktop and CLI
   clients legitimately use `http://127.0.0.1:<port>`.
   *Accepted loosening:* the old prefixes pinned a full path
   (`/api/mcp/auth_callback`), the new rule pins only the host. That is
   deliberate — ChatGPT mints a **unique callback path per connector**, so a
   path-pinned list cannot work for it — and it is compensated by MP3.
3. **MP3 — Dynamic client registration is now real, and binds redirect URIs.**
   `/oauth/register` was a stub that issued a `client_id` and stored nothing.
   It now persists the client and its declared `redirect_uris`, and
   `approveMcpConnection` requires the presented `redirect_uri` to **exactly
   match one the client registered**. Both checks must pass.
   *Known limit, stated rather than papered over:* a client that never registers
   is still validated by host policy alone, because requiring registration would
   break clients that use a fixed `client_id`. So MP3 strengthens the registering
   clients (which is all three vendors) without a flag day. It is defence in
   depth, not a boundary on its own — consent and PKCE remain the boundary.
4. **MP4 — Domain-verification files are served from a function, never from
   `public/`.** `/.well-known/openai-apps` joins the OAuth discovery documents on
   the `mcpMetadata` handler, for exactly the reason recorded in MCP-Spec §8: a
   file under `public/.well-known/` exists in the repo, passes review, and never
   ships. The token itself is configuration (`OPENAI_APPS_TOKEN`), not code, so
   rotating it is a config change and an empty value returns 404 rather than
   serving an empty string that would read as a failed verification.
5. **MP5 — Claude first, ChatGPT second, Gemini as documentation.**
   Claude's queue costs the least beyond MP1 (no domain verification, no video,
   no test matrix) and will surface reviewer feedback that applies to ChatGPT's
   stricter pass. Gemini gets a "connect Beats in Gemini Enterprise" page rather
   than a submission, because there is nothing to submit to. *Rejected: chasing
   the consumer Gemini app* — it is partnership-only and needs a Google
   partnerships contact, which is business development, not engineering.
   *Rejected: the Gemini CLI extensions gallery* — self-serve but unvetted, and
   scheduled for replacement by Antigravity CLI mid-2026; verify what it is
   before spending effort on it.
6. **MP6 — The vendor callback origins live in one named constant, and are
   copied from the vendor, never guessed.** `chatgpt.com` is added on the
   strength of published examples of
   `https://chatgpt.com/connector_platform_oauth_redirect`. **Google's is not
   added, because it is not known** — a guessed origin in a security control is
   worse than a missing one, since it looks handled. The submission portals show
   the real value; add it then.

## 4. Open

7. **MP7 — The privacy policy.** The long pole, and not an engineering task: it
   is a legal document about **Yasdu Innovación y Servicios SA de CV**
   (`About-Spec.md`). `MCP-Privacy-Disclosure.md` in this repo records what the
   connector *actually* does with data — read from the code, not from intent — so
   whoever drafts the policy is working from facts. It must cover collection,
   use, storage, third-party sharing, retention and contact, and must be specific
   about the MCP: an AI assistant is granted read access to customer roadmaps.
8. **MP8 — Rate limiting (MC11).** An assistant in a loop is the plausible abuse
   case and both vendors review security. *Recommend: per-connection limits
   before submission rather than after* — it is easier to describe a control you
   have than to promise one.
9. **MP9 — Listing assets.** Icon, tagline (55 chars), description (2,000),
   categories, docs URL, support contact, and a **test account with realistic
   sample data** a reviewer can use end to end. The demo account is the item most
   likely to be underestimated: it needs a populated Beat, not an empty one.
