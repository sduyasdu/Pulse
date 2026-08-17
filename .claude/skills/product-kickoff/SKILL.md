---
name: product-kickoff
description: Use at the start of a new product — before the first line of code — to write the product spec, choose and clear a name, settle domains and URLs, and produce the brand asset set. Covers helping a product owner make the decisions (naming, availability checks, what the name will cost to change later) and the concrete artefacts an app needs on day one. Pairs with saas-app-foundations, which takes over once these are decided.
---

# Starting a product: spec, name, domain, brand

This is the day-zero skill. It ends where **`saas-app-foundations`** begins —
that one covers architecture, i18n, billing, collaboration, mobile and help,
once you know what you are building and what it is called.

Work in this order. Each step constrains the next, and doing them out of order is
how a product ends up with a name it can't use, a domain that doesn't match it,
or icons that have to be redrawn.

1. **The spec** — what it is, and what it isn't
2. **The name** — including what it will cost to change
3. **The domain** — and everything downstream that hardcodes it
4. **The brand assets** — the actual file set an app needs

---

## 1. The product spec

One document, written before building, that a newcomer can read in ten minutes.
Not a requirements catalogue — a shared understanding of the shape of the thing.

**What earns its place:**

| Section | Why |
| --- | --- |
| **What it is** | One paragraph. If it takes three, the product isn't decided yet. |
| **Goals** | And the non-goals, which do more work — they are what you point at when someone proposes scope. |
| **Core entities** | The nouns, their relationships, and what each one *is* in the user's language. This becomes the data model and the UI vocabulary at once. |
| **The distinctive idea** | Most products have one thing that isn't obvious. Give it its own section; it is what people get wrong. |
| **Branding** | Colours as tokens, typography, the wordmark. Enough that the first screen isn't invented ad hoc. |
| **Accounts & sharing** | Who can see what, even if the answer is "one user, for now". Retrofitting multi-tenancy is a rewrite. |
| **What it does NOT do yet** | The honest gap list. Prevents the spec being read as a promise. |
| **v1 scope** | What ships first, and explicitly what waits. |

**End it with a numbered decision list.** Each decision carries its rationale
*and* the alternative that was rejected, and gets a stable code (`PL1`, `HA8`) so
other documents cite the code rather than restating the argument.

The distinction worth holding onto: **prose in a spec is a proposal; a numbered
decision is what the next person can rely on.** When an open question gets
resolved, write it into the list — don't leave the narrative behind and assume
someone will infer the outcome.

Keep one spec per feature area as the product grows, cross-referenced by code.
A single document that tries to stay current about everything goes stale
uniformly.

## 2. The name

### 2.1 The question that costs the most later

**Is the product name also a noun inside the product?**

If the app is called *Pulse* and a project inside it is also *"a Pulse"*, the
name is now in the data model, the type names, the collection paths, the URLs
and every string. Renaming later touched **3,449 occurrences across 140 files**
in this project — a week of work, most of it structural and risky.

If the product is *Pulse* and the thing inside it is a *Board*, renaming the
product is a day of strings and images.

Neither is wrong. Sharing the name is often the better product — it is
memorable and it makes the app feel like one idea. Just make it a **decision**,
with the cost understood, rather than something that happens because the first
type was called `Pulse`.

### 2.2 Build the escape hatch anyway

Whatever you choose, keep two seams from day one and a rename stays cheap:

- **An internal name that never has to change.** Collections, types, function
  names and file paths can keep the original codename forever — no user ever
  sees `pulses/` in a database. Plenty of shipped products still carry theirs.
- **Every user-visible string behind i18n** (`saas-app-foundations`,
  `translation.md`). If the only place the name appears to a user is a
  dictionary, renaming the product is find-and-replace in six files plus new
  artwork.

That combination is what turns "a week" into "an afternoon". It costs nothing on
day one.

### 2.3 Check availability before falling in love

Do these together, because a name that clears four of five is not available:

```bash
# Domain — registered at all?
whois example.com | head -20            # "No match" ⇒ unregistered
dig +short example.com                  # resolving ⇒ definitely taken

# Does something already live there?
curl -sS -o /dev/null -w "%{http_code}\n" -L --max-time 10 https://example.com

# Package registry — matters if you'll ever publish, and signals prior use
npm view <name> 2>&1 | head -3          # "404" ⇒ free
```

Check by hand, and record the result in the spec:

- **Trademark** — search your jurisdiction's register (USPTO TESS, EUIPO
  eSearch, or the local equivalent) **in your product's class**, not just for the
  word. A name that is registered by someone in an unrelated class may be fine;
  one registered in software probably isn't. For anything you'll invest in,
  this is worth real legal advice rather than a search result.
- **App stores**, if you'll ever ship an app — names are unique per store.
- **Social handles** and a **GitHub org**, which are cheap to reserve and
  awkward to retrofit.
- **Search the name plus your category.** If page one is a competitor, that is
  the marketing cost of the name, whatever the registers say.

### 2.4 Practical filters

Say it out loud on a phone call. Spell it. Type it. Names that fail those are
names your customers mis-navigate to forever. Check it doesn't mean something
unfortunate in the languages you'll ship in — which you already listed when you
decided i18n.

## 3. Domains and URLs

### 3.1 Own domain, or a subdomain of the company's?

A product under an existing company domain (`product.company.com`) inherits its
DNS, certificate handling and trust, and costs nothing. A standalone domain is a
stronger brand and a separate thing to manage. Decide before anything hardcodes
a URL — several things will.

### 3.2 What depends on the domain

More than you expect, and each fails differently:

- **Auth.** Managed auth SDKs run on the vendor's hostname by default and it is
  visible to users. Serving auth from your own domain is a config change plus an
  OAuth redirect-URI update that **fails closed on the front door**
  (`saas-app-foundations` → `architecture.md` §1.7).
- **Payment return URLs.** Checkout needs an allowlist of origins to return to.
  A domain missing from it doesn't error — it silently falls back, stranding the
  customer somewhere else, *signed out*, immediately after paying.
- **Email**, if you send any: SPF/DKIM/DMARC are per-domain.
- **Anything you paste into a provider's console** — webhook endpoints, allowed
  origins, redirect URIs.

The practical rule: **pre-authorise the intended domain in code before it
resolves**, so the DNS cutover needs no deploy — but keep any *default* or
*fallback* pointing at a host that works today. A fallback aimed at a hostname
that doesn't resolve yet turns a recoverable redirect into a dead end.

### 3.3 Reserve the obvious variants

The plural, the common misspelling, and `.com` even if you'll launch on
something else. They are cheap now and expensive when someone else has them.

## 4. Brand assets

### 4.1 The set an app actually needs

This is the full list, learned by needing each one:

```
brand/
  favicon.svg            # modern browsers, scales everywhere
  favicon-16.png         # legacy tabs
  favicon-32.png
  favicon-512.png        # PWA / install prompts
  apple-touch-180.png    # iOS home screen
  appicon.svg            # + -black / -white single-colour variants
  mark.svg               # the symbol alone — light / dark / black / white
  lockup.svg             # mark + wordmark — light / dark / black / white
```

**Name them by role and variant** (`mark-dark.svg`, not `logo2.svg`). You will be
choosing between them in code, and a filename that describes the artwork is a
filename you don't have to open.

### 4.2 Variants are for *surfaces*, not themes

`light` / `dark` here means the surface the mark sits on, not an OS theme
setting. An app with no dark mode still needs a dark-surface variant the moment
it has a navy header. Confusing the two produces an invisible logo on a white
dialog, which is exactly how it fails — silently, in one place nobody looked.

Also keep single-colour `black` / `white` versions for print, email and anywhere
colour isn't available.

### 4.3 Render the wordmark as live text

The mark is artwork; the **name usually isn't**. Rendering it as text in the
app's display font, next to an inline SVG mark, gets you two things a baked
lockup image can't:

- It hints and renders at the same weight as the rest of the UI at 14–16px,
  where a scaled-down image goes muddy.
- **A rename becomes a string change**, not a redraw of every asset.

Keep the baked lockup files for the places you can't run code — email, README,
social cards, app-store listings.

### 4.4 Inline SVG or `<img>`?

- **Inline** for your own marks, so they inherit `currentColor`, scale to any
  size, and need no network request. Give any `<mask>`/`<filter>` a **unique id
  per instance** — two copies on one page otherwise share it and one disappears.
- **`<img>`** for third-party artwork and anything exported from a design tool.
  Illustrator exports carry a `<style>` block with generic classes (`.st0`);
  inlining leaks those into the page, where any other `.st0` can recolour the
  logo. As an image it stays self-contained.

Always give an `<img>` explicit `width`/`height` so the row doesn't reflow as it
loads. And note that artwork drawn on a square canvas with a landscape mark
renders with visible whitespace — either accept it or crop the `viewBox` to the
artwork's bounds.

### 4.5 Never approximate someone else's mark

If you need to show a third party's logo — card networks, integrations,
"works with" badges — get the real artwork from their brand centre and follow
their usage rules. A logo drawn from memory is both wrong and a trademark
problem. Until you have the file, a **typographic badge in their brand colour**
is honest and legible, and it claims nothing.

---

## Checklist before the first line of code

1. **Spec** written, with non-goals and a numbered decision list.
2. **Name** decided, with the entity-noun question answered deliberately —
   and the internal-name + i18n seams in place so it stays changeable.
3. **Availability** checked: domain, registry, trademark class, stores,
   handles — and the results recorded in the spec.
4. **Domain** decided and pre-authorised in code, with fallbacks pointing only
   at hosts that resolve today.
5. **Brand assets** produced in every variant, named by role, with the wordmark
   rendered as live text.
6. Hand over to **`saas-app-foundations`** for architecture, i18n, billing,
   collaboration, mobile and help.
