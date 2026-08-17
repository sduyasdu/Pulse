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

## 1.7 Vendor domains leak into your product — decide which ones you brand

Managed services run on **their** hostnames by default, and several of those are
visible to users even when your app is on your own domain. Audit them early; each
one is usually a config change and an afterthought later.

Common leaks:

| Surface | Default | Where a user sees it |
| --- | --- | --- |
| **Auth** | `<project>.<vendor>.com` | status bar while the auth iframe loads; the address bar of the sign-in popup |
| **File storage** | bucket host | any link you hand out to a stored file |
| **Transactional email** | shared sending domain | "via …" in the recipient's client, plus deliverability |
| **Hosted payment pages** | provider domain | mid-checkout, at the least trusting moment |

The auth one is the least obvious, so it is the worth-knowing example. A managed
auth SDK typically loads a hidden iframe at `<authDomain>/__/auth/iframe` on
startup and opens sign-in on that same origin. Nothing redirects, so the address
bar is clean and the app looks fine — but the vendor host flashes in the status
bar on every load. Pointing `authDomain` at a domain you already serve fixes it,
and the provider usually serves the auth endpoints on any attached domain
already: check for a 200 on the handler path before changing anything.

Three things that make this bite harder than it should:

- **It fails closed, on the front door.** Changing the auth domain means the
  OAuth client's **authorised redirect URIs** must include the new
  `.../__/auth/handler`, or every social sign-in dies with
  `redirect_uri_mismatch`. Do that first, keep the old entry registered as the
  rollback, and test in a fresh incognito session — an already-authenticated
  reload does not exercise the redirect path at all.
- **It is build-time config, not source.** The value is baked into the bundle
  from an env var, so it is not in git: another machine or a CI pipeline will
  quietly build with whatever *it* has. Document the variable in the example env
  file, or a future deploy reverts it without anyone editing a line.
- **Preconnect/prefetch hints have to move with it.** A hint pointing at the old
  host warms a connection nothing uses and leaves the real one cold — on the
  sign-in path, which is exactly where the latency is worst felt.

Verify against the shipped artefact, not the config: grep the built bundle for
the old hostname and confirm it is gone.

## 1.8 Pick one icon set, and vendor it

**Default to Google Material Symbols** unless the project already has a set —
then use that one, and do not mix. Mismatched stroke weights and optical sizes
are immediately visible side by side, and no amount of CSS reconciles two
families drawn to different grids.

Material Symbols earns the default: Apache-2.0, several thousand glyphs across
one grid, actively maintained, and available as plain SVG paths rather than only
as a font or a component library.

**Vendor the paths; don't load an icon font or pull a runtime component
package.** Generate a single map from the upstream package —

```ts
// AUTO-GENERATED from @material-symbols/svg-400 (outlined). viewBox 0 -960 960 960.
export const ICONS: Record<string, string> = { "check": "<path d=\"…\"/>", … };
```

— and render it as real `<path>` elements inside your own `<svg>` wrapper. That
buys four things at once: no runtime font request and no flash of missing
glyphs, `currentColor` inheritance so an icon takes the colour of its button, any
size without a second asset, and **no `dangerouslySetInnerHTML`**, so the icon
layer never becomes an injection surface.

Keep the generator comment at the top of the file. The next person needs to know
where new glyphs come from — otherwise someone hand-draws one, and hand-drawn
glyphs never quite match.

### The trap: a name-keyed lookup fails silently

An `<Icon name="…" />` API looks up a string. A name that isn't in the map is not
a type error, not a runtime error, and not a failed build — the component returns
nothing and you get **a button with no content, no width, and nothing to click**.
It looks like a layout bug, and it is easy to reintroduce every time someone
reaches for a glyph the set doesn't have yet.

This happened three times in Pulse. Choose one of:

- **Type the names** — generate a union type from the map's keys, so a wrong name
  fails at `tsc`. Cheapest fix, and the one to prefer.
- **Fail loudly in development** — render a visible placeholder and warn, so it
  is caught the first time it renders rather than the first time someone tries to
  click it.

Whichever you pick, when you need a glyph the set lacks, **extract it from the
upstream package in `node_modules`** rather than drawing one. And never
approximate a third party's brand mark this way — see `product-kickoff` §4.5.
