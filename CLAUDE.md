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

## Sign-out terminates Firestore, so it must reload the page

The client runs on `persistentLocalCache` with the multi-tab manager
(`src/lib/firebase.ts`), which puts a copy of everything the signed-in user can
read on disk — and unlike the session, it does not end on its own. `signOutUser`
therefore clears it, and clearing has a fixed order:

```
await signOut(auth);
await terminate(db);              // clearIndexedDbPersistence refuses while live
await clearIndexedDbPersistence(db);
window.location.reload();         // NOT optional
```

**The reload is load-bearing.** `terminate()` kills the instance and every
listener on it, so `db` is dead for the rest of that page's life — sign in again
without reloading and every read throws. Removing the reload looks like removing
a jarring flash, passes `tsc`, `npm test` and the rules suite, and breaks the
app on the second sign-in of a session.

It reloads in a `finally` for the same reason: if clearing fails — another tab
still holds the persistence lease, storage is locked — `db` is *already*
terminated. A signed-out reload carrying a stale cache beats a live page whose
every read throws.

Known gap: with two tabs open, the other one holds the lease and the clear
fails, so that device keeps the cache until the last tab goes. Sign-out is still
real (Auth state is shared); only the local copy lingers.

## Only `npm run test:rules` validates security rules

`tsc -b`, `npm test` and `npm run build` all pass while `firestore.rules` is
wrong — they never evaluate a rule. Touched the rules? Run:

```
npm run test:rules    # rules/security.test.ts against the emulator, self-starting
```

Two real bugs in the hide/archive work were green everywhere else and caught
only here. Add cases to `rules/security.test.ts` for anything a rule now denies
*and* anything it must still allow (the allow side is where the cascade breaks).

## A swallowed `onSnapshot` error looks exactly like an empty collection

Passing `() => cb([])` as the error handler turns "denied" into "nothing here".
The Connected assistants dialog shipped that way, the `users/{uid}/connections`
rules were never deployed (see above — `npm run deploy` is hosting only), and the
result was a working-looking feature listing zero of three live connections. No
console error the customer would see, no failing test.

**Give every subscription an error path that reaches the screen**, distinct from
the empty state. A read that fails is a fault; a read that returns nothing is a
state.

Every live read in `src/services/firestore/` now takes an `onError` and every
caller renders it — swept 2026-08, after the same bug reached the canvas: a
refused `features` listener drew an empty Pulse, which reads as lost work. Its
siblings (`epics`, `resources`, the pulse doc, `myPulses`) had no handler at
all, so a refusal never called back and the page span forever instead. Same
fault, opposite symptom.

`subscriptionErrors.test.ts` holds it shut. It drives each subscription's error
handler and asserts the **success path is not called** — that is the half that
does the damage, and the half a tidy-up puts back.

Three deliberate exceptions, documented at their call site and named in that
test. Don't "fix" them:

- `rates` — the rules refuse non-admins, so empty *is* the mechanism.
- `billing` — refusal falls back to the Free plan; degrading to least privilege
  on an unreadable entitlement is a decision.
- `presence` — ephemeral and decorative, self-heals on reconnect, hides nothing.

Adding a subscription? Add it to that test's `CASES`.

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

## A declared param with no value **prompts**, and hangs the run

`defineString("OPENAI_APPS_TOKEN", { default: "" })` looks like optional config.
It is not: Firebase resolves declared params when functions load, and with no
value it asks on the terminal —

```
? Enter a string value for OPENAI_APPS_TOKEN:
```

**An empty-string default does not suppress it.** `emulators:exec` started both
emulators, printed `Serving at port 8333`, and then waited forever for input.
Nothing failed, nothing logged, no timeout — the test run just looked slow, and
`firebase deploy --only functions` would have done the same in CI.

It cost three restarts to find, because the prompt was in output being piped
through `tail`, which buffers until the process exits — and it never exits. **When
something hangs rather than fails, redirect raw output to a file and read it**
before assuming the machine is slow.

Optional config with a sane absent-case reads the environment instead
(`process.env.X ?? ""`, `functions/.env`), and the absent case does something
honest — `/.well-known/openai-apps` 404s rather than serving an empty body that
would read as a failed verification. Keep `defineString`/secrets for values the
service cannot start without.

## `npm run test:functions` tests the **compiled** output

The suites in `functions/test/*.mjs` import `functions/lib/*.js`, not `src/`. Run
`npx tsc -p functions` first, or you are testing the previous build — and it will
pass. This produced a confident all-green against code that did not exist yet.

**And a passing suite is not evidence it ran.** `mcp.integration.mjs` had a
`process.exit()` at line 72 of ~190, so two thirds of its assertions had never
executed once — decoding, limit clamping, dates, working days, search folding,
window overlap. Every run reported "All MCP assertions passed". It surfaced only
because a newly added test printed nothing. The suites are `&&`-chained, so an
early exit with status 0 reads as a pass all the way up. When you add a case,
**check your assertion appears in the output** rather than checking the exit
code.

## `Icon` renders nothing for a name it doesn't have

`src/components/shared/icons.ts` is a fixed set of baked Material Symbols paths,
and `Icon` returns `null` for anything missing from it: a button with no content,
no width, and nothing to click. No error, no warning, no failed build.

Has bitten three times (`help`, `link_off`, `expand_content`). Extract new glyphs
from `@material-symbols/svg-400` in `node_modules` rather than drawing them —
`icons.ts` says at the top that it is generated from exactly that package.

## A service worker does not uninstall when you delete the plugin

`vite.config.ts` ships one (`vite-plugin-pwa`, `generateSW`) so the app boots
offline: Firestore's `persistentLocalCache` already held the data, but nothing
held the *app*, so a reload with no connection got the browser's own "This site
can't be reached" and the cached data was never reached either.

**Removing the plugin does not remove the worker.** Every browser that installed
it keeps serving the last build it cached, forever, and those users never see
another deploy. There is no way to reach them except through the worker they
already have. The retreat is:

```
VitePWA({ selfDestroying: true, ... })   # build a worker whose only job is to
npm run deploy                           # unregister itself and drop its caches
```

Leave that deployed until the installed base has picked it up, *then* delete the
plugin. Reverting the commit is not a rollback here — it is how you strand
everyone who already has it.

### The navigation fallback will hijack sign-in if you let it

The worker answers unrecognised same-origin navigations with `index.html`. This
origin serves several things that are not the SPA, and `signInWithPopup`
navigates the popup to `/__/auth/handler` — serve that `index.html` and Google
sign-in stops working, with nothing in the console and the app looking fine.

The denylist lives in `build/swRoutes.ts` next to `build/swRoutes.test.ts`,
which pins both halves: `/__/*`, `/mcp`, `/oauth/{register,token}` and
`/.well-known/*` must NOT get the shell, and `/oauth/authorize` **must** — it
sits among those endpoints and is an SPA route, the same carve-out
`firebase.json` documents at its own catch-all.

Add a hosting rewrite to a function? Add it there too, or it starts answering
with HTML.

### Verifying it actually works needs a browser

`npm run build` reports `precache N entries` whether or not any of it is
reachable, and no unit test boots a service worker. What was actually run (and
is worth re-running after touching any of this) is headless Chrome over CDP:
serve `dist/`, load once to install the worker, `Network.emulateNetworkConditions
{offline:true}`, reload, and assert `#root` has real content.

Offline is also the clean way to test the denylist: with no network the worker
is the *only* thing that can answer, so a path that boots is one it served and a
path that fails is one it declined.

## Specs are the design record, and decisions are numbered

Feature-per-spec markdown at the repo root (`Kanban-Spec.md`, `Costs-Spec.md`,
`Plans-Spec.md`, `Hide-and-Archive-Spec.md`, …), cross-referenced by section.
Each ends in a coded decision list — `HA1–HA10`, `PL1–PL17`, `MC1–MC14`, `CO15`,
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
