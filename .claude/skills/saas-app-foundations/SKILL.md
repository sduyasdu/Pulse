---
name: saas-app-foundations
description: Use when starting a new multi-tenant SaaS web app, or when adding one of its six foundations to an existing one — architecture/stack choice, internationalization, billing with plan limits, multi-user collaboration (roles, sharing, presence), the mobile version, or in-app help and empty states. Front-loads the decisions that are cheap on day one and expensive to retrofit, and carries the failure modes that pass every green check and still ship broken. Written from building Pulse (React + Firebase + Stripe, six languages, three tiers, mobile-first views).
---

# Foundations of a multi-tenant SaaS app

Six things are cheap before the first user and painful afterwards:
**architecture**, **translation**, **billing**, **collaboration**, **mobile**
and **explanation**. Each section below is written for the moment you're about
to skip it.

The bias throughout: **the boundary is the server; everything on the client is
UX.** Most of the expensive bugs in this document are a version of forgetting
that.

---

## 1. Architecture & setup

### 1.1 Recommend an architecture before writing one

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
  materialized counter (§3.4). Discover this while choosing, not while building
  the paywall.

### 1.2 One project or two?

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

### 1.3 Know exactly what deploys what

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

### 1.4 Secrets bind at deploy time

Setting a secret does **not** change running code. The deployed revision is
pinned to a secret *version*; it keeps using the old one until you redeploy.
Worse, some CLIs **destroy** the previous version when you set a new one, so
between `secrets:set` and the redeploy your running code is pinned to a version
that no longer exists — and only cold starts fail, which makes it easy to miss.

Set → redeploy immediately → verify the new version is bound.

And note what this does to rollback: if the old version was destroyed, rolling
back means re-obtaining the old value from the provider, not reverting a pointer.

### 1.5 Know which check validates which thing

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

### 1.6 Verify against reality, not against the source

Reading the code tells you what it should do. Before declaring anything done on
a live system, check the live system: call the endpoint, read the logs, list the
deployed functions, query the real data. In this project that habit caught a
webhook URL that differed from every document, a catalog whose currency wasn't
what everyone assumed, and a "fix" that had never actually run.

---

## 2. Translation — from the first string

Retrofitting i18n means touching every component you have already written. Doing
it on day one costs almost nothing. The decision is not *whether* you will
translate — it is whether the seam exists.

### 2.1 Make the dictionary a type, so a missing key is a build error

```ts
// en.ts is the source of truth AND the fallback.
export const en = { "common.save": "Save", … };
export type Dict = typeof en;

// Every other language is typed as Dict — a missing or extra key fails tsc.
export const es: Dict = { "common.save": "Guardar", … };
```

This one line is what makes translation maintainable: you cannot merge a feature
that adds an English string without adding it everywhere. No linting rule, no
process, no discipline required.

Ship English-only if you like — but ship the *seam* immediately.

### 2.2 Load languages lazily

Bundle only the default language; dynamic-import the rest on first use. Six
dictionaries is a meaningful chunk of an initial payload for text most users
never see. Fall back to the default until the async dictionary resolves.

### 2.3 The hook must be reactive, and it must be a dependency

```ts
const t = useT();                    // re-renders on language change
useMemo(() => …t("x")…, [deps, t]);  // ← `t` in the deps, or labels go stale
```

Memoized values that call `t` and omit it from the dependency array keep the old
language until something unrelated invalidates them.

### 2.4 Watch for the shadow

```ts
const t = useT();
const post = () => {
  const t = text.trim();   // ← shadows the hook
  … t("some.key")          // ← calling a string
};
```

This broke a build in Pulse and three near-identical cases were sitting
one keystroke away from the same failure. Name locals `body`, `trimmed`,
anything but `t`.

### 2.5 What does *not* get translated

Decide once and write it down: product names, brand terms, and domain nouns you
have chosen to keep in one language. In Pulse: *Pulse, Epic, Kanban, AI* stay as
they are in all six languages. Also **legal entity names in copyright notices** —
a registered company name is a proper noun, and a notice that reads differently
per language is six different notices.

### 2.6 Formatting is not string substitution

Use `Intl` for dates, numbers and currency, in **the app's active language**, not
the browser's — the user may have overridden it.

Money has a specific trap: payment providers store **minor units** (600 = $6.00),
*except* in zero-decimal currencies (JPY) where 600 means 600. Dividing by 100
unconditionally renders a hundredth of what you charge, on the screen
immediately before payment. Ask `Intl` for the currency's fraction digits and
divide by that.

Also: `Intl` separates amount from symbol with a **non-breaking space**, so a
test comparing against a typed `"6,00 €"` fails while looking identical.
Normalize whitespace in assertions.

### 2.7 Untranslated surfaces rot quietly

A component that was never wired to i18n stays invisible until someone reads it
in another language. Grep for user-visible literals periodically —
`placeholder=`, `title=`, `aria-label=`, and bare JSX text — and treat each one
as a bug rather than a style issue.

---

## 3. Billing scheme & limits

The hardest part of billing is not taking money. It is that **the plan is a
security boundary** and everything about it wants to leak into the client.

### 3.1 Decide the model before the schema

Answer, and write down:

- **What is billed?** A user, a seat, a workspace, usage? "Seat" needs a
  definition precise enough to count: which roles consume one?
- **Who is the billing entity?** Almost never the individual user. Pick the
  organization/workspace and make its id the billing key.
- **Feature gating or quota only?** Quota-only (all tiers get all features,
  differing by limits) is dramatically simpler: a downgrade never removes a
  capability, only caps growth, so there is no "what happens to the data" design
  work per feature.
- **What happens on downgrade?** Decide before you can be downgraded. Graceful
  and non-destructive: demote roles, make things read-only, never delete.

### 3.2 The plan document is server-written, always

```
match /billing/{orgId} {
  allow read: if <org admin>;
  allow write: if false;      // ← the whole security model in one line
}
```

Written only by your webhook handler through an admin SDK that bypasses rules.
If a client can write its own tier, every user is on the top plan.

### 3.3 Webhooks are at-least-once and out of order

Design for redelivery from the start:

- **Recompute from current state**, don't apply deltas. Refetch the subscription
  from the provider and rebuild the document; a duplicate delivery then converges
  instead of double-applying.
- **Drop stale deliveries** by comparing the event's timestamp to the one you
  last applied, and make a repeat of the same event id a no-op.
- **Return 5xx to ask for a retry, 4xx to stop it.** A bad signature is 4xx; your
  own failure is 5xx.
- Verify the signature **over the raw body**. Any JSON re-serialization breaks it.

### 3.4 Quota enforcement needs a counter, and the counter needs an owner

Rules can't count a collection. So:

1. A server function maintains `org.thingCount` on create/delete.
2. Rules read that counter and the plan document to gate creates.
3. Rules reject any client write to the counter — an owner who can set their own
   counter to 0 makes the gate decoration.

**Recount, don't increment.** Triggers are at-least-once; an incremented counter
drifts upward on redelivery and never repairs itself. A recount is idempotent and
self-healing. Use the datastore's count aggregation so it stays cheap.

Accept and document that the counter is **async**: a burst can transiently allow
one past the cap. That's fine for a commercial quota. Say so in the code, so
nobody later mistakes it for a security boundary.

**Check every new gate against the delete path.** Deleting is how an over-quota
org gets back under its limit; gate deletes and you strand them permanently. More
generally: if your delete is a client-side cascade, *any* new write restriction
also applies to that teardown.

### 3.5 The client gate is UX, and it can be wrong

Show the limit, explain it, offer the upgrade — but:

- **Don't disable the action on a stale counter.** An async counter can be
  wrong in both directions; blocking locally denies work the server would have
  allowed. Let the server decide and render its answer.
- **Map the permission error to a human sentence.** "Missing or insufficient
  permissions" is a terrible way to meet a paywall.
- **Make dismissible notices actually dismissible** — session and permanent —
  and key the permanent dismissal to the *fact* (including the limit), so
  upgrading and hitting the new limit is allowed to speak again.

### 3.6 Never duplicate the price

A hardcoded price constant *will* drift from the provider's catalog, and the
place it becomes visible is the screen immediately before payment. Read prices
from the provider (a cached, unauthenticated endpoint is fine — it's public
pricing) and render those.

Stronger: **resolve the displayed price and the charged price through the same
code path**, so they cannot disagree by construction rather than by discipline.
In Pulse, display and checkout had separate lookups whose rules differed
slightly, and one advertised a price the other refused to sell.

### 3.7 Payment-provider realities that are not obvious

Learned the hard way; check each against your provider:

- **Some objects are immutable once set.** A customer's currency, for example.
  Not editable, ever. That means an object created too early — at *click* rather
  than at *purchase* — can permanently constrain a customer. Defer creating
  provider-side records until the transaction actually completes.
- **Abandoned sessions still exist.** Closing the browser tab tells the provider
  nothing; a checkout session stays open server-side for hours and can hold
  locks. Set the shortest sensible expiry, and expire stale sessions explicitly
  when starting a new one.
- **Card networks have currency rules.** At least one major network will refuse
  a cross-currency charge outright in some markets, so "we bill in USD
  everywhere" can silently exclude a whole card brand. Multi-currency pricing may
  be a payments requirement, not a nicety.
- **Resolve the catalog from products, not prices.** Tag the product with your
  tier and use its default price; then adding a currency or a promo price
  requires no re-tagging and there is no ambiguity when a tier has several
  prices.
- **Never enter card details in your own UI.** Hosted checkout/portal only.
- **Configuration is per-mode.** Test-mode products, webhooks, tax settings and
  portal configuration do not cross to live. Assume nothing carries over.

### 3.8 Error messages must not guess

An error that names a *likely* cause will confidently misdirect the day the
cause is something else. Ours claimed a tax-configuration problem and sent us
looking there twice while the real causes — an invalid key, then a currency
conflict — sat in the logs. Surface the provider's own message for configuration
errors; keep the guess out of it.

---

## 4. Collaboration

Multi-user is not a feature you add to a single-user app. It changes who may
write what, whose data you are allowed to touch, and what "delete" means. Decide
these before the second user exists.

### 4.1 Authorization: derive capabilities from the role

Store the **role**; derive what it can do. Do not read a client-writable
capability bag to decide what the client may do.

```
// rules — capabilities derived from the role for fixed presets
role in ['owner','editor']   → full edit
role == 'taskLead'           → edit only what they lead
role == 'custom'             → only here, consult the stored caps
```

The reason is specific: if someone joins through an invite link and the rules
trust a `caps` field on their own membership document, they can write themselves
a better one. Presets must be role-derived so the only escalation path is
someone with authority changing their role.

Two invariants worth encoding from the start:

- **Somebody must always be able to administer the resource.** Guard against the
  last owner removing themselves — and remember the guard has to survive
  teardown, where the resource is being deleted legitimately.
- **Effective permission is the *intersection* of every axis** — plan
  entitlement ∧ role capability ∧ resource lifecycle state (archived, locked,
  read-only). Compute it in **one place** and let every disabled state, drag
  guard, hidden control and keyboard shortcut read that. Scatter it and they
  drift, and the one you forget is the security-relevant one.

### 4.2 Shared state and per-user state are different features

The clearest trap in collaborative UI. Two superficially similar actions:

| | Scope | Who notices |
| --- | --- | --- |
| **Archive** | shared — read-only for everyone | every member |
| **Hide** | per-user — off *my* list only | nobody else |

Conflating them means one person tidying their dashboard silently freezes a
resource for the whole team. Name them differently, store them in different
places (shared state on the resource; per-user state under the user), and decide
their precedence explicitly when both apply.

Related: an archived/frozen resource must stay **deletable** by its owner, or the
freeze makes it permanent. Any write restriction you add gets checked against
teardown.

### 4.3 Some cleanup is server-mandatory

A client **cannot** delete another user's documents — their copy of the
dashboard index, their presence record, notifications addressed to them. Rules
correctly forbid it, and no amount of client code gets around it.

So membership removal, resource deletion and account deletion need **server
functions**. This is not later hardening; there is no client-side interim, and it
is a day-one cost of being multi-user. Budget for it when choosing the
architecture (§1.1) — "do I need server compute" is answered *yes* by
collaboration alone, whatever else you decide.

Make each one idempotent: re-running a cleanup must find nothing left to do.

### 4.4 Per-user indexes are convenience, never security

"List everything I have access to" is awkward in a rules-based datastore, and
cross-collection queries may be rejected outright. The workable pattern is a
denormalized per-user index — a document per user listing what they can see —
that they query directly.

The rule that makes it safe: **every actual read of the underlying data is still
re-checked against the real membership record.** The index only decides what
appears in a list. A corrupted entry then shows one person a broken card on their
own dashboard; it never grants access.

Because the index is a copy, it goes stale — someone else renames the resource,
or your membership was revoked. Give it a **self-heal pass** that reconciles
against the source on load and writes only on a real difference, so it converges
instead of looping.

### 4.5 Undo is per-user and in-memory

You cannot undo someone else's change, and a shared undo stack in a live
document is a research project. Scope undo to the current user, the current
resource, and the current session; drop it on navigation. Decide this early —
it is much harder to remove a shared-undo assumption later than to add scope now.

### 4.6 Presence, comments and notifications

- **Presence is ephemeral.** Treat it as disposable, expect stale entries from
  closed tabs, and clean it up server-side when membership ends (§4.3).
- **Mentions need a target model.** Decide what can be @-mentioned — people,
  or the domain objects people care about — and store mentions **structurally**
  (kind + id + label) rather than parsing text later. In Pulse you mention a
  *resource*, which means "mentions me" resolves to "mentions a resource linked
  to my account" — a definition worth writing down, because filters and
  notifications both depend on it.
- **Notifications are addressed to a user**, so they live under that user, so
  cleaning them up is server-mandatory. Same category as §4.3.

### 4.7 Invites

Pin the granted role **to the invite**, not to the joiner's request — otherwise
accepting an invite is a role-selection screen. An email invite must be matched
against the accepting account's *verified* address, and a link invite grants
exactly the role the link encodes.

Give link invites a revocation path, and expect one active link at a time to be
simpler to reason about than a set.

## 5. The mobile version

Decide the mobile strategy **before** the first layout, because the two options
diverge immediately and converting between them is a rewrite.

### 5.1 Responsive or a separate view?

- **Responsive one layout** — right when mobile is the same work, smaller.
- **A distinct mobile view** — right when the interactions genuinely differ. A
  drag-and-drop canvas is not a small phone screen; it is a list.

Pulse chose a separate `MobilePulseView` for the app shell (phones get a list and
a board; desktop gets the canvas) while **sharing every detail component** —
forms, panels and dialogs are the same code in both. That is the balance worth
copying: **shared components, different shells.** If you find yourself
maintaining two copies of a form, the split is in the wrong place.

### 5.2 Detect the right thing

Two different questions, two different media queries:

```ts
useIsMobile()      // (max-width: 767px), (max-height: 480px) → WHICH layout
useCoarsePointer() // (pointer: coarse)                       → CAN they hover
```

Tablets are wide **and** touch. Using width to decide hover behaviour breaks
them; using pointer type to decide layout gives phones a desktop shell.

### 5.3 Hover is not available, and it does not fail loudly

Anything *revealed* or *enabled* by hover is unreachable on touch. Anything
styled on hover can *stick* after a tap.

- Decorative hover: fine to be absent on touch. Use a framework variant that is
  already gated behind `@media (hover: hover)`, or gate it yourself.
- Functional hover — row actions, "×" buttons, tooltips: **must** have a touch
  path. Simplest is to render it always on coarse pointers and hide-until-hover
  only on fine ones.
- Never write an ungated bare `:hover` rule.

Keep this as its own always-on checklist; it is the single easiest thing to get
wrong repeatedly. (Pulse has a dedicated `hover-effects` skill for exactly this.)

### 5.4 Viewport, safe areas, and the address bar

`100vh` is wrong on mobile Safari as the address bar moves. Pin to the real
measured height and update on `resize`/`visualViewport` resize. Respect
`env(safe-area-inset-*)` for bottom navigation.

### 5.5 Touch targets and long-press

Small icon buttons that are comfortable with a mouse are not with a thumb. Give
touch surfaces real size, opt large/edge buttons out of press-shrink animations
(shrinking moves the target away from the finger and drops the tap), and suppress
the long-press text-selection callout on any surface where long-press is your own
gesture.

### 5.6 Sticky headers earn their place on mobile

A long form on a small screen loses its context. Pin the identifying header —
and remember an opaque background and negative margins that cancel the
container's padding, so content scrolls *under* it rather than beside it.

---

## 6. Help, empty states and explanation

The recurring failure is not "we have no docs". It is a control that is disabled,
absent or inert with **no explanation next to it**. Treat explanation as part of
building the feature, not as a documentation project that happens later.

### 6.1 Explanation is for everyone — check the gate it lands in

Help nearly shipped inside an editors-only conditional in Pulse, which would have
hidden it from viewers: the newest arrivals, who need it most. Anything
explanatory sits **outside** the permission gate.

The general shape of this bug: you add a control to an existing block without
noticing what that block is conditional on. Worth a deliberate look every time —
`{canEdit && …}` is easy to nest into by accident.

### 6.2 Help must be translated, and never half-translated

Help is prose, so it is the surface most likely to be left in one language while
the UI around it is localized — and mixed-language help reads as broken software
rather than as a gap.

So decide the policy explicitly, and make the *code* express it:

- **Either fully translated or explicitly English-only**, never partial. If a
  locale's help is incomplete, fall back to the source language **as a whole**
  and say so in the UI ("Help is currently available in English only") rather
  than showing half-translated sections.
- **Budget for it as content, not strings.** UI labels are a few words each and
  the type-checked dictionary (§2.1) forces them to exist. Help is paragraphs;
  the same forcing function would make every feature block on six translations,
  so it usually lives outside the dictionary — which is exactly why it silently
  stays English. Decide who writes it and when.
- **Keep it structured, not marked up** (§6.4), so translating is replacing
  strings rather than reproducing formatting per language.
- If help ships in one language first, **make that a stated decision with a
  trigger for revisiting** — "translated when we sell into a non-English
  market" — not an accident nobody owns.

### 6.3 Search closes a vocabulary gap

Search is not there because a short list is hard to scan. It is there because
**readers don't know your product's vocabulary**: they type *gantt*, *salary*,
*timesheet* while your copy says canvas, hourly cost, hours.

That changes what you index. Include a `keywords` field of the words users
actually bring, alongside titles and body. The keywords are the part that makes
search worth having.

Two details that matter more than they sound:

- **Accent-insensitive matching is mandatory in a multilingual app.** Normalize
  `NFD` → strip combining marks → lowercase, in one shared helper. Otherwise
  *"analisis"* finds nothing because the copy says *análisis*.
- **Do not autofocus the search box.** It swallows the next keystroke on desktop
  and opens the keyboard on mobile, in front of the content the user came to
  read.

### 6.4 Plain strings, no markup

No markdown parser, no HTML in help content, no markup inside translated strings.
A structured shape — title, body, bullets, term/definition pairs — renders itself
from data.

This is not only simplicity: content that is never parsed as markup is content
that cannot carry an injection payload, so help stays out of the sanitization
surface entirely. If you want emphasis inside a sentence, that is a signal the
sentence should be two.

### 6.5 Help documents what is deployed

A section ships **with** its feature, never before. Help that describes what is
planned becomes a roadmap that lies, and it is read as a bug report by everyone
who goes looking for the control.

Make it a convention rather than a role: whoever ships a feature checks whether
the help sections it touches are still true. That is cheaper than an owner who
audits everything periodically, and it is the only version that stays current.

### 6.6 The nearest explanation wins

Most "help" is not in the help panel. In descending order of usefulness:

1. **The control explains itself** — a disabled button with a `title` saying why.
2. **An inline notice next to the thing** — "you've used all 3 of your plan's
   projects; delete one or upgrade", with the upgrade action right there.
3. **An empty state that tells you what to do** — the first screen of every list
   is a teaching opportunity, and it is the screen every new user sees.
4. **The help panel** — for concepts, not for individual controls.

The rule that follows: **never ship a dead control without a reason attached.**
A disabled button with no explanation is the failure this whole section exists to
prevent, and it is much easier to introduce than to notice.

Distinguish the three states in your empty copy, too: *nothing exists yet*,
*nothing matches your filter*, and *nothing matches because of a filter you may
have forgotten is on*. They need different sentences and different exits.

### 6.7 Mobile needs its own entry point

Whatever anchors help on desktop — a toolbar, a sidebar — may not exist on
mobile. Decide where it lives there (Pulse put it in the header beside comments
and notifications) and give it the same content, presented full-screen rather
than as a drawer (§5.1: shared components, different shells).

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
