---
name: saas-app-foundations
description: Use when starting a new multi-tenant SaaS web app, or when adding one of its six foundations to an existing one — architecture/stack choice, internationalization, billing with plan limits, multi-user collaboration (roles, sharing, presence), the mobile version, or in-app help and empty states. Front-loads the decisions that are cheap on day one and expensive to retrofit, and carries the failure modes that pass every green check and still ship broken. Written from building Pulse (React + Firebase + Stripe, six languages, three tiers, mobile-first views).
---

# Foundations of a multi-tenant SaaS app

Six things are cheap before the first user and painful afterwards:
**architecture**, **translation**, **billing**, **collaboration**, **mobile** and
**explanation**.

**This file routes; it does not brief.** The one-line summaries below are enough
to tell you which foundation you are touching and nothing like enough to build
it — every one of them has a failure mode that looks fine in review, passes
`tsc`, passes the tests, and ships broken. **Read the file for the foundation you
are about to work on before you start.** If you are touching two, read two.

| Foundation | Read | When |
| --- | --- | --- |
| Architecture & setup | `architecture.md` | choosing a stack, dev/prod split, deploy commands, secrets, what validates what |
| Translation | `translation.md` | any user-visible string, at any point in the project's life |
| Billing & limits | `billing.md` | plans, quotas, webhooks, prices, anything a customer pays for |
| Collaboration | `collaboration.md` | roles, sharing, invites, presence, anything a second user can see |
| Mobile | `mobile.md` | phone/tablet layout, touch, hover, viewport |
| Help & empty states | `help.md` | help content, empty states, disabled controls, error copy |

## The bias underneath all six

**The boundary is the server; everything on the client is UX.** Most of the
expensive bugs collected in these files are a version of forgetting that — a
plan the client could write, a counter the client could forge, a gate that only
existed in a React component, a price the client decided.

Two habits that follow, and that apply whichever file you are in:

- **Know which check validates the thing you changed.** Types, unit tests and
  the build are all silent about security rules; a test suite that imports
  compiled output is silent about your last edit. (`architecture.md` §1.5.)
- **Verify against the live system, not the source.** Call the endpoint, read the
  logs, list what is actually deployed, query the real data. Reading the code
  tells you only what it should do.

## Cross-cutting: the design record

Keep a spec per feature, ending in a **numbered decision list** — each decision
with its rationale *and the alternative that was rejected*. Other specs cite the
code (`PL13`, `HA8`) rather than restating the reasoning.

The distinction that makes this worth the effort: **prose in a spec is a
proposal; a numbered decision is what the next person can rely on.** When you
resolve an open question, write it into the list rather than leaving the
narrative behind.

Record the surprising things too — they are the ones that get re-litigated.
Cite code as `file.ts:line`, and when you correct a spec that was wrong, say
what it used to say and when, so anyone who built on the old wording can tell
whether it affected them.

---


## Checklist before you call any of this done


1. **Architecture** — recommendation written with cost at three scales, option
   chosen explicitly, dev/prod split decided, deploy commands documented.
2. **i18n** — dictionaries typed against the source language, `t` reactive and in
   dependency arrays, `Intl` for all money/dates, no untranslated user-visible
   literals.
3. **Billing** — plan doc server-written and `write: if false`, webhook
   idempotent by recompute, counters server-owned and recounted, deletes
   ungated, prices read from the provider through the *same* path as checkout.
4. **Collaboration** — capabilities derived from the role, shared vs per-user
   state kept separate, cross-user cleanup done server-side, per-user indexes
   re-checked against the real membership on every read, undo scoped to one user.
5. **Mobile** — layout vs pointer detection kept distinct, every hover has a
   defined touch behaviour, viewport pinned to the measured height, touch targets
   sized for a thumb.
6. **Explanation** — help outside the permission gate, translated or explicitly
   single-language but never partial, no dead control without a reason attached,
   empty states that distinguish "nothing yet" from "nothing matches".
7. **Verified against the live system**, not just the source — and the check that
   validates the thing you changed was actually the one you ran.
