# Pulse — working notes

Setup, scripts and the data model live in `README.md`. This file is only for
things that pass every check you'd normally run and still ship broken.

## `npm run deploy` does NOT deploy security rules

It is `tsc -b && vite build && firebase deploy --only hosting`. If you changed
`firestore.rules`, deploy it separately, **rules first**:

```
npx firebase deploy --only firestore:rules --project pulse-b9d96
npm run deploy
```

Rules-first is the safe order: the currently-live client predates whatever gate
you just added, and a new gate that no existing document trips is inert until
the matching client ships. Hosting-first ships a UI whose enforcement isn't
there yet — the feature looks like it works and protects nothing.

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

## Specs are the design record, and decisions are numbered

Feature-per-spec markdown at the repo root (`Kanban-Spec.md`, `Costs-Spec.md`,
`Plans-Spec.md`, `Hide-and-Archive-Spec.md`, …), cross-referenced by section.
Each ends in a coded decision list — `HA1–HA10`, `PL12`, `CO15`, `D13` — and
other specs cite those codes rather than restating the reasoning.

When resolving an open question, **write it into the list as a numbered decision
with its rationale and the alternative you rejected**, rather than leaving prose
behind. Prose in a spec is a proposal; a numbered decision is what the next
person (or session) can rely on. Cite code as `file.ts:line`.
