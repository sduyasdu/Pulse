# Beats — Privacy Policy

> **DRAFT — needs legal review before publication.** Every factual claim below
> was read out of the code and cross-checked against `MCP-Privacy-Disclosure.md`
> on 2026-09-14, so the *facts* are sound. The *legal framing* — which statute
> applies, how rights are phrased, what a Mexican controller must say under the
> LFPDPPP, whether GDPR or CCPA obligations attach to your actual user base — is
> not something this draft settles. Items needing your input are marked
> **[CONFIRM]**.
>
> Satisfies `MCP-Publishing-Spec.md` MP7 once reviewed and published.

**Effective date:** [CONFIRM — date of publication]
**Last updated:** [CONFIRM]

---

## 1. Who we are

Beats is a visual project-planning application operated by **Yasdu Innovación y
Servicios SA de CV** ("Yasdu", "we", "us"), a company registered in Mexico.

Yasdu is the data controller for the information described in this policy.

- **Service:** https://beats.yasdu.com
- **Privacy contact:** [CONFIRM — a monitored address, e.g. privacy@yasdu.com]
- **Postal address:** [CONFIRM — registered address in Mexico]

This policy covers Beats and its AI assistant connector. Other Yasdu products
(Nubceo, Aidia, Y Tools) are covered by their own policies.

## 2. What we collect

### 2.1 Account information

When you create an account we collect your **email address**, and — if you sign
in with Google — the basic profile information Google returns for that sign-in.
We support Google sign-in and email-and-password sign-in.

We do not collect your name separately from what you choose to enter, and we do
not ask for a phone number, date of birth, or any special-category data.

### 2.2 Content you create

Everything you put into a Beat: roadmap names, tasks and subtasks, dates,
effort estimates, epics, statuses, comments, links, the people you add to a Beat
(their names, roles and capacity, and optionally the email address linking them
to a Beats account), recorded costs, and the activity log of who changed what
and when.

Beats operates no file storage. An attachment is held as data embedded in the
same database record as the task it belongs to — so if you attach a file, its
contents are stored with your Beat, not in a separate file service.

**Content you enter about other people is your responsibility.** When you add a
colleague to a Beat — by name, or by linking them to their email address — you
are providing us their personal data. You should have a lawful basis for doing
so, and they should know.

### 2.3 Billing information

If you subscribe to a paid plan, **Stripe** collects and processes your payment
details. **We never see or store card numbers.** We store the subscription tier
and status, the Stripe customer and subscription identifiers, and the
organisation the subscription belongs to.

### 2.4 Technical information

Standard server logs recorded by our infrastructure provider: request metadata,
timestamps, and your pseudonymous account identifier. Connections from AI
assistants are logged as described in §4.5.

### 2.5 What we do **not** collect

Beats contains **no analytics, advertising, or tracking technology**. There is
no Google Analytics, no advertising pixel, and no third-party script of any kind
in the application. We do not build behavioural profiles, and we do not sell or
share personal data for advertising.

The application stores small amounts of data in your browser (sign-in session,
an offline cache of your own Beats, and interface preferences such as which
panel you last had open). These are used to run the service, not to track you
across other sites.

## 3. How we use your information

We use it only to:

- provide the service — render your Beats, sync changes, and let collaborators
  work together;
- authenticate you and keep your account secure;
- process subscriptions and enforce plan limits;
- respond to your support requests;
- keep the service working and diagnose faults;
- comply with legal obligations.

We do not use your content to train machine-learning models, and we do not use
it for advertising.

**Beats sends nothing to an AI model on its own account.** It is worth being
explicit, because the product mentions AI in two places that are not what they
might appear to be: you can flag an estimate as "AI-assisted", and you can
record what you spent on a given model — choosing a vendor from a list. Both are
labels you apply to your own records. Neither sends anything anywhere. The only
route by which your data reaches an AI vendor is a connection you make yourself,
described in §4.

## 4. AI assistant connections

This section describes what happens when you connect an AI assistant — Claude,
ChatGPT, or another client that speaks the Model Context Protocol — to your
Beats account. **It is the most consequential thing in this policy, and it only
happens if you choose it.**

### 4.1 What connecting does

Connecting grants that assistant **read-only** access to your Beats data on your
behalf. Nothing is connected by default. Before you approve a connection, the
consent screen names the assistant and what it will be able to read.

### 4.2 Data leaves Beats and goes to the assistant's operator

**When an assistant reads your data, that data is transmitted to whoever
operates it** — Anthropic, OpenAI, Google, or the operator of a self-hosted
client. Once it reaches them, it is governed by *their* privacy policy and
terms, not ours. We have no contractual relationship with the assistant's
operator; the connection is one you initiate.

Concretely, the connector can return:

| Capability | Personal data it can return |
| --- | --- |
| Resource and people search | Team members' **names**, and the **email address** of the Beats account each is linked to |
| Comment search | Full **comment text** written by colleagues, and each author's **email address** |
| Activity history | Who changed what and when, identified by **email address** |
| Beat, task, schedule and workload reads | Names, assignments, capacity and workload |
| Cost reads | Cost data, **only where your role already permits you to see it** |

### 4.3 Two things worth stating plainly

**An assistant sees exactly what you see, and nothing more.** Reads are
performed with your own credentials against the same authorisation rules that
govern the interface. A connection cannot reach a Beat you are not a member of,
and cannot see cost data your role hides from you.

**Your consent can expose your colleagues' data.** The information returned is
not only yours. Comments, names and email addresses belong to other members of
the Beats you are in. This is inherent to connecting any collaboration tool to
an assistant, and we would rather say it than let you discover it.

### 4.4 What we store for a connection

- The connection record — the name you gave it, the client name the assistant
  reported, its scope, when it was created, when it was last used, and whether
  it has been revoked.
- Short-lived authorisation codes, and refresh tokens.
- A record of the AI client software itself (its identifier, declared callback
  addresses and name). This describes a software product, not a person.

**Access and refresh tokens are stored only as SHA-256 hashes.** The tokens
themselves are not recoverable from our database, so a breach of our systems
would not yield credentials anyone could replay.

**No copy of your Beat content is made for the connector.** Results are computed
for each request and returned; nothing is cached or written.

### 4.5 Connector logging

For each assistant request we log your pseudonymous account identifier, the
connection identifier, and which capability was called. At connection time we
also record the client's self-reported name and version.

**The arguments and the results are not logged.** What you searched for, and
what came back, do not reach our logs.

### 4.6 Your controls

- **Revoke** a connection at any time from *Account → Connected assistants*.
  Revocation blocks renewal and takes effect on the assistant's next request;
  any access token already issued expires **within one hour**.
- **Remove** a revoked connection to delete the record entirely.
- Consent is per person and per connection. Revoking one does not affect others.

## 5. Who we share information with

We do not sell personal data. We share it only with the following processors and
recipients:

| Recipient | Purpose |
| --- | --- |
| **Google Cloud / Firebase** | Hosting, database, serverless functions, authentication and logging |
| **Google Identity Toolkit** | Token exchange when an assistant connects or refreshes |
| **Stripe** | Subscription billing and payment processing |
| **The AI assistant operator you choose** | Receives data as described in §4 — only if you connect one |
| **Your collaborators** | People you invite to a Beat see its contents and the activity within it |

We may also disclose information where required by law, or to establish or
defend legal claims.

## 6. Where your data is stored

Beats runs on Google Cloud infrastructure in the **United States** (Firestore
`nam5` multi-region, with compute co-located in `us-central1`).

If you are located outside the United States, your information is transferred
there. [CONFIRM — the transfer mechanism you rely on: Google Cloud's Standard
Contractual Clauses, and whatever the LFPDPPP requires of a Mexican controller
using US infrastructure.]

## 7. How long we keep it

| Data | Retained |
| --- | --- |
| Account and content | While your account is open — see §8 |
| Authorisation codes | Deleted when used; otherwise within a day of their five-minute expiry |
| Refresh tokens | Deleted on rotation, on revocation, and otherwise within a day of the connection ending |
| Revoked connection records | Until you remove them, so you can see the revocation happened |
| Billing records | As long as required by tax and accounting law [CONFIRM the period] |
| Server logs | [CONFIRM — the project's Cloud Logging retention. Google's default `_Default` bucket is 30 days unless changed; check before publishing a number] |

A refresh token belonging to a **live** connection is kept for as long as that
connection exists, however old it is. Age cannot distinguish an abandoned
connection from an idle one, and deleting the wrong one would silently break a
connection you still want.

## 8. Your rights and how to exercise them

You may request access to your personal data, correction of it, deletion of it,
a portable copy of it, or restriction of its processing. You may also object to
processing or withdraw consent where processing rests on consent.

**To exercise any of these, contact us at [CONFIRM — privacy address].** We
respond within [CONFIRM — the period your applicable law requires].

Some of this you can do yourself today: you can edit or delete your content
directly, and revoke assistant connections from your account settings.

**You can delete your account yourself**, from *Account → Delete account*. The
screen tells you first what deleting would do — which Beats are destroyed, which
you are merely removed from — and asks you to type your email address to
confirm. Deletion removes your profile, the Beats only you hold, your
memberships, your assistant connections, any pending invitations to you, and
your personal organisation and its billing record.

Two things stop it, because neither is ours to decide for you:

- **A Beat you alone own that other people are still in.** Deleting your account
  would take their work with it. Make someone else an owner, or delete the Beat
  yourself, and then come back.
- **A live subscription.** Cancel it first, so nothing is charged after the
  account is gone.

Note that content you contributed to a shared Beat — a comment, an edit in the
activity log — may remain visible to that Beat's other members after you leave,
because it forms part of their record of the work.

If you are in Mexico you may also lodge a complaint with the **INAI**. [CONFIRM
— and add the relevant supervisory authority for other jurisdictions you serve.]

## 9. Security

Access to your data is enforced server-side by authorisation rules, not merely
hidden in the interface. Traffic is encrypted in transit. Assistant tokens are
stored only as irreversible hashes (§4.4). Payment card details never reach our
systems.

No system is perfectly secure, and we do not claim otherwise. [CONFIRM — whether
you wish to state a breach-notification commitment, and on what timeline.]

## 10. Children

Beats is a tool for workplaces and is not directed at children. We do not
knowingly collect personal data from anyone under [CONFIRM — 13, 16, or 18
depending on the jurisdictions you decide to name]. If you believe a child has
provided us data, contact us and we will delete it.

## 11. Changes to this policy

We will post any changes here and update the "last updated" date. If a change
materially affects how we handle your data — particularly anything in §4 — we
will tell you in the application before it takes effect.

## 12. Contact

**Yasdu Innovación y Servicios SA de CV**
[CONFIRM — registered address, México]
[CONFIRM — privacy contact address]
