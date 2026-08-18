# MCP privacy disclosure — source material

**This is not a privacy policy.** It is the factual record of what Pulse's MCP
connector actually does with data, read out of the code on 2026-08-18, so that
whoever drafts the policy (`MCP-Publishing-Spec.md` MP7) is working from what the
system does rather than what anyone remembers it doing.

The policy itself is a legal document about **Yasdu Innovación y Servicios SA de
CV**, based in Mexico (`About-Spec.md`), and needs review by someone qualified to
write one. A missing or incomplete privacy policy is an immediate rejection at
the Claude directory and a blocker at OpenAI's.

---

## 1. The disclosure that matters most

**Connecting an assistant sends Pulse data to a third-party AI vendor.**

Everything a tool returns leaves Pulse and goes to whoever operates the assistant
(Anthropic, OpenAI, Google, or a self-hosted client). That includes, concretely:

| Tool | Personal data it can return |
| --- | --- |
| `search_resources` | Team member **names**, and the **email address** of the Pulse account each resource is linked to |
| `search_comments` | Full **comment text** written by colleagues, and each author's **email address** |
| `get_activity` | Who changed what and when, by **email address** |
| `get_pulse`, `search_tasks`, `get_schedule`, `get_people_load` | Names, assignments, capacity and workload |
| `get_costs` | Cost data — **only where the user's role already permits it** |

Two properties are worth stating plainly in the policy because they are unusual
and favourable:

- **The assistant sees exactly what that user sees, and nothing more.** Reads go
  through the Firestore REST API with the *customer's own* credentials, so the
  ordinary security rules apply unchanged. Cost data is gated by the same
  `viewPeopleCost` capability as the UI.
- **A user consenting can expose colleagues' data.** The data returned is not
  only their own — comments, names and emails belong to other members of the same
  Pulse. This is inherent to any collaboration tool integration, and it should be
  disclosed rather than glossed.

## 2. What Pulse stores for the connector

| Where | Fields | Lifetime |
| --- | --- | --- |
| `users/{uid}/connections/{id}` | connection name (customer-chosen), client name as reported by the AI client, scope, created, last used, revoked, tool-list version | Until the user deletes it; a revoked connection is kept so the user can see it was revoked |
| `mcpAuthCodes/{sha256(code)}` | uid, connectionId, scope, PKCE challenge, redirect URI, expiry | Deleted on use; **5-minute expiry — see §5** |
| `mcpRefreshTokens/{sha256(token)}` | uid, connectionId, scope, created | Deleted on use (rotated) and on revoke; **see §5** |
| `mcpClients/{client_id}` | client id, declared redirect URIs, client name | Indefinite. **Contains no user data** — it describes an AI product, not a person |

**Tokens are stored only as SHA-256 hashes.** Neither the access token nor the
refresh token is recoverable from Pulse's database, so a breach of this project
yields nothing replayable. Worth stating: it is a real, checkable property.

**No copies of Pulse content are made for the connector.** Tool results are
computed per request and returned; nothing is cached or written.

## 3. Logs

Cloud Logging receives, per request: the user's **uid** (a pseudonymous
identifier, not an email), the connection id, the tool name, and at connection
time the AI client's self-reported name and version and the negotiated protocol
version.

**Tool arguments and results are not logged** — so search terms and returned
content do not reach the logs. Retention follows the project's Cloud Logging
configuration (Google's `_Default` bucket is 30 days unless changed); confirm the
actual setting before stating a number in the policy.

## 4. Processors and third parties

- **Google Cloud / Firebase** — hosting, Firestore, Cloud Functions,
  Authentication, Cloud Logging. Processor for all of the above.
- **Google Identity Toolkit** — the custom-token-for-ID-token exchange at
  connection and refresh.
- **The AI vendor the customer chooses** — receives tool results, as §1. Pulse
  has no contractual relationship with them; the customer initiates it by
  connecting.
- **Stripe** — billing, unrelated to the MCP but part of the same policy.

## 5. Two retention gaps to fix or disclose

Found while writing this, and both are small:

1. **Expired authorization codes are never deleted.** `mcpAuthCodes` documents
   are removed when exchanged, and carry a 5-minute `expiresAt` that is *checked*
   but not swept. A code that is issued and never used leaves a row holding a
   uid indefinitely. It is unusable — expiry is enforced on read — but "we keep
   it for 5 minutes" would not be a true statement today.
2. **Abandoned refresh tokens are never deleted.** Rotation deletes the presented
   token and revocation deletes the one it finds, but a client that simply stops
   calling leaves its row forever.

Neither is a security hole (both are hashes, both are checked against a live
connection before use). Both are retention claims a policy would otherwise make
falsely. **Recommend a scheduled cleanup before submission** — a daily function
deleting `mcpAuthCodes` past expiry and `mcpRefreshTokens` whose connection is
gone or revoked — so the policy can state a retention period that is true.

## 6. User controls to describe

- **Revoke**, from Account → Connected assistants. Takes effect on the
  assistant's next request and blocks renewal; the outstanding access token
  expires within one hour. The policy should say "within an hour", not
  "immediately" — that is what the design actually guarantees.
- **Remove** a revoked connection, deleting the record entirely.
- Consent is per-user and per-connection, and names what the assistant will be
  able to read before the approve button.
