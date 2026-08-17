# Pulse — working notes

Setup, scripts and the data model live in `README.md`. This file is only for
things that pass every check you'd normally run and still ship broken.

## `npm run deploy` deploys **hosting only**

It is `tsc -b && vite build && firebase deploy --only hosting`. Rules and
functions each deploy separately:

```
npx firebase deploy --only firestore:rules --project pulse-b9d96
npx firebase deploy --only functions      --project pulse-b9d96
```

**The order follows the data dependency, not a fixed rule.** Work it out each
time — there are three shapes, and they want opposite orders:

- A gate that reads a field **nothing writes yet** is inert → ship the writer
  first. SF11's `workspace.pulseCount` had to exist before the Pulse-create rule
  reading it could mean anything.
- A gate that restricts what the **live client already does** breaks it → ship
  the client first, or make the rule tolerant of both shapes.
- A client whose enforcement **isn't live yet** looks like it works and protects
  nothing.

*(This section used to say "rules first" flatly. That is right for the second
shape and wrong for the first, which is how SF11 nearly shipped as an inert
gate.)*

## `deletePulse` is a client-side cascade — new write gates must exempt owner deletes

`deletePulse` (`src/services/firestore/pulses.ts`) deletes every subcollection
doc, then the pulse doc, then `pulseMembers` **last**, all through the ordinary
security rules. So **any restriction added to a write path also applies to that
teardown**, and an over-broad one makes a Pulse undeletable.

When adding a gate, check it against the cascade and keep an owner escape:

```
allow delete: if <your gate> && (<the new condition> || pulseRole(pulseId) == 'owner');
```

This has bitten twice — the archive freeze on the content collections, and the
always-an-owner rule on `pulseMembers` (which needed a further carve-out for
"the pulse doc is already gone"). See `Hide-and-Archive-Spec.md` §4.4 and §5.7.
Owners can already delete the whole Pulse, so the exemption grants nothing new.

## Only `npm run test:rules` validates security rules

`tsc -b`, `npm test` and `npm run build` all pass while `firestore.rules` is
wrong — they never evaluate a rule. Touched the rules? Run:

```
npm run test:rules    # rules/security.test.ts against the emulator, self-starting
```

Two real bugs in the hide/archive work were green everywhere else and caught
only here. Add cases to `rules/security.test.ts` for anything a rule now denies
*and* anything it must still allow (the allow side is where the cascade breaks).

## Secret versions bind at deploy, and `secrets:set` destroys the old one

Setting a secret changes nothing until you redeploy — the running revision stays
pinned to the version it was deployed with, and keeps using it. Worse,
`functions:secrets:set` **destroys** the previous version rather than disabling
it, so between the two commands the deployed functions are pinned to a version
that no longer exists. Only cold starts fail, which makes the window easy to
miss entirely.

```
npx firebase functions:secrets:set STRIPE_SECRET_KEY --project pulse-b9d96
npx firebase deploy --only functions --project pulse-b9d96   # immediately
npx firebase functions:secrets:get STRIPE_SECRET_KEY --project pulse-b9d96
```

Rollback is not reverting a pointer: the old value is gone from Secret Manager,
so it means fetching it from Stripe again and setting a new version.

## `npm run test:functions` tests the **compiled** output

The suites in `functions/test/*.mjs` import `functions/lib/*.js`, not `src/`. Run
`npx tsc -p functions` first, or you are testing the previous build — and it will
pass. This produced a confident all-green against code that did not exist yet.

## `Icon` renders nothing for a name it doesn't have

`src/components/shared/icons.ts` is a fixed set of baked Material Symbols paths,
and `Icon` returns `null` for anything missing from it: a button with no content,
no width, and nothing to click. No error, no warning, no failed build.

Has bitten three times (`help`, `link_off`, `expand_content`). Extract new glyphs
from `@material-symbols/svg-400` in `node_modules` rather than drawing them —
`icons.ts` says at the top that it is generated from exactly that package.

## Specs are the design record, and decisions are numbered

Feature-per-spec markdown at the repo root (`Kanban-Spec.md`, `Costs-Spec.md`,
`Plans-Spec.md`, `Hide-and-Archive-Spec.md`, …), cross-referenced by section.
Each ends in a coded decision list — `HA1–HA10`, `PL1–PL17`, `MC1–MC13`, `CO15`,
`D13` — and
other specs cite those codes rather than restating the reasoning.

`Stripe-Go-Live-Runbook.md` is the one exception in kind: a **runbook**, not a
spec. It records an operational procedure and what it actually did when run, so
its sections carry outcomes ("done 2026-08-16, here is what the logs showed")
rather than only intent. Its decisions are `GL1–GL4`.

When resolving an open question, **write it into the list as a numbered decision
with its rationale and the alternative you rejected**, rather than leaving prose
behind. Prose in a spec is a proposal; a numbered decision is what the next
person (or session) can rely on. Cite code as `file.ts:line`.
