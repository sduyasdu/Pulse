# Architecture & setup


## 1.1 Recommend an architecture before writing one

Do not start from the stack you know. Produce a short written recommendation
first — two or three viable options, each with **capabilities** and **cost at
three scales** — and get it chosen explicitly. It takes an hour and it is the
only cheap moment to change your mind.

For each option, state:

| Dimension | What to answer |
| --- | --- |
| **Real-time?** | Do users see each other's changes live? Live queries vs polling vs manual refresh is an architectural fork, not a feature toggle. |
| **Where is authorization?** | Declarative rules at the database (Firestore/Supabase) or a server tier you write? This decides how much backend exists at all. |
| **Server compute** | Managed functions, a container, or none? Cold starts, per-invocation billing, and whether background jobs are possible. |
| **Cost at 10 / 1k / 100k users** | Actual arithmetic against the provider's pricing page, not a feeling. Include reads/writes, storage, egress, function invocations. |
| **Cost of the free tier** | Where does it stop being free? A generous free tier that ends abruptly is worse than a small one you priced in. |
| **Vendor lock-in** | What would it cost to leave? Which parts are portable (your code) and which are not (auth identities, live data, rules)? |
| **Team fit** | Nobody ships fast in a stack they're learning. |

Two failure modes worth naming explicitly:

- **Per-read pricing punishes denormalization the wrong way.** Document stores
  charge per document read; a dashboard listing 50 items that each fetch their
  owner is 51 reads per page view. Design the index/denorm strategy *with* the
  pricing model, and write down which fields are denormalized and who maintains
  them.
- **Rules-based authorization can't count or sort.** If your plan limits are
  "at most 3 projects", the database rules cannot express that without a
  materialized counter (`billing.md` §3.4). Discover this while choosing, not while building
  the paywall.

## 1.2 One project or two?

Decide **before** you have production data whether dev and prod are separate
projects/databases.

A single project is cheaper and simpler, and it means test-mode payment records,
seeded data and experiments live in the same store as real users. That is
survivable if you decide it deliberately and write down the cleanup it implies —
it is a nasty surprise if you discover it on cutover day, when test identifiers
turn out to be invalid against live credentials and there is no way to tell them
apart from real ones by inspection.

If you choose one project: **write the cleanup script before you need it**, and
make it dry-run by default.

## 1.3 Know exactly what deploys what

Write this in `CLAUDE.md` on day one, because a deploy command that quietly
covers less than its name suggests is the single most common way to ship
"working" code that does nothing:

```
npm run deploy        # hosting ONLY — not rules, not functions
firebase deploy --only firestore:rules
firebase deploy --only functions
```

**Deploy order follows data dependencies, not a fixed rule.** Work out which way
round is safe each time:

- A new **rule** that reads a field nothing writes yet → inert; deploy the writer
  first.
- A new **rule** that restricts something the live client still does → breaks
  the live client; deploy rules *after* the client, or make the rule tolerant.
- A **client** whose enforcement isn't live yet → looks like it works and
  protects nothing.

## 1.4 Secrets bind at deploy time

Setting a secret does **not** change running code. The deployed revision is
pinned to a secret *version*; it keeps using the old one until you redeploy.
Worse, some CLIs **destroy** the previous version when you set a new one, so
between `secrets:set` and the redeploy your running code is pinned to a version
that no longer exists — and only cold starts fail, which makes it easy to miss.

Set → redeploy immediately → verify the new version is bound.

And note what this does to rollback: if the old version was destroyed, rolling
back means re-obtaining the old value from the provider, not reverting a pointer.

## 1.5 Know which check validates which thing

Write the matrix down. In Pulse:

| Check | Validates | Silent about |
| --- | --- | --- |
| `tsc -b` | types | security rules, runtime behaviour |
| unit tests | domain logic | rules, deploy config |
| `npm run build` | bundling | everything above |
| **`npm run test:rules`** | **security rules** | app code |
| integration tests | server functions | **stale builds** (see below) |

Two traps:

- **Rules are invisible to every normal check.** Two real bugs in Pulse were
  green in `tsc`, unit tests and the build, and caught only by the emulator
  suite. If you touch rules, run the rules tests — and test the **allow** side,
  not just the deny side. Over-broad denial is the failure mode that breaks
  teardown and locks users out of their own data.
- **Integration tests that import compiled output test whatever was compiled
  last.** If the suite imports `lib/` rather than `src/`, compile first or you
  are testing the previous version of the code and won't know.

## 1.6 Verify against reality, not against the source

Reading the code tells you what it should do. Before declaring anything done on
a live system, check the live system: call the endpoint, read the logs, list the
deployed functions, query the real data. In this project that habit caught a
webhook URL that differed from every document, a catalog whose currency wasn't
what everyone assumed, and a "fix" that had never actually run.
