# Pulse — About Spec

Status: **Ready to build — AB1–AB9 resolved; AB10 (legal entity name) blocks the
copyright string and needs a one-line answer from the owner.** · Owner: product + eng ·
Related: `Yasdu-Site-Pulse-Listing-Spec.md` (the Pulse↔Yasdu relationship as told to
the public), `Help-Spec.md` (the other "what is this?" surface), `Plans-Spec.md`
(the billing entry that About sits beside in the same menu)

## 0. What this is (and isn't)

An **About** entry at the bottom of the account menu, opening a small dialog that
says three things: this is Pulse, Pulse is a Yasdu product, and this is the exact
build you are looking at.

It exists for the two moments nothing else in the app covers: someone asks *"who
makes this?"*, and someone reports a bug and has to be asked *"which version?"*.

**Not** in scope: a changelog or what's-new feed (that neighbours the activity log,
not this), credits/acknowledgements, an open-source licence inventory, terms and
privacy documents (About may *link* to them once they exist — it does not host
them), a support form, or a "check for updates" control. A web app has no updates
to check for; a reload is the update.

## 1. Where it lives

`AccountMenu.tsx` renders three items in its main group — **My account**,
**Language**, **Billing & payment** — then a divider, then **Sign out**.

**About goes last in the main group, immediately below Billing and above the
sign-out divider (AB1).** Sign out keeps the bottom of the menu.

The account menu is rendered in exactly one place: `DashboardPage.tsx:197`. It is
**not** in the Pulse toolbar and **not** in the mobile Pulse header, so About is
reachable from the dashboard only. That is acceptable for v1 and worth stating out
loud, because "it's in the account menu" reads as "it's everywhere" and it isn't
(AB2).

## 2. The dialog

A centred modal in the shape `AccountDialog`/`BillingDialog` already use — same
overlay, same dismiss behaviour, same close affordance. Contents, top to bottom:

1. **Pulse lockup** — `<PulseLockup variant="light" size={22} />`. Live SVG, not an
   image; it already exists in `shared/Logo.tsx`.
2. **One line of product description.** Reuse the existing tagline string
   `auth.tagline` ("Visual, graph-first project planning.") rather than writing a
   second one that will drift from the first.
3. **Version block** — `Version {version} · {buildDate}` in mono, muted. See §4.
4. **A rule**, then the Yasdu attribution:
   - the Yasdu lockup image (§3), max 96 px wide, linked to `https://yasdu.com`
     (`target="_blank" rel="noopener noreferrer"`),
   - the line **"Pulse is a Yasdu product."**,
   - the copyright line (§5).

The dialog is informational: no form, no state, nothing to save. It must be
dismissible with `Escape` and by clicking the overlay, like its two siblings.

## 3. The Yasdu logo assets

### 3.1 Which files

The brand kit at `~/Documents/Brand Kits/Yasdu` holds PNG lockups. The two that
matter, confirmed by opening them:

| File | Mark | Wordmark | Belongs on |
| --- | --- | --- | --- |
| `YASDU logo naranja blanco_Mesa de trabajo.png` (427×124) | orange | **white** | dark surfaces |
| `YASDU logo color_Mesa de trabajo 1.png` (427×123) | orange | **navy** | light surfaces |

The original request named `naranja blanco` for *both* modes; that file is the
white-wordmark one and is invisible on white. The light-surface counterpart is
`YASDU logo color_Mesa de trabajo 1.png` **(AB3)**.

### 3.2 Which one actually ships

**Pulse has no dark mode.** There is no `prefers-color-scheme` rule and no theme
state anywhere in `src/` — surfaces are individually hardcoded, and the account
menu and its dialogs are `#FFFFFF`.

So "dark mode / light mode" here means **surface**, not theme. The About dialog is
a white surface, so the *light* (navy-wordmark) variant is the one that renders.
Both files are still vendored, because the dark variant is what the navy toolbar
(`#123359`) and login header would need, and because it costs 5 KB to be ready for
a real theme later **(AB4)**.

### 3.3 How they're vendored

Copy both into `public/brand/`, renamed to match the existing Pulse assets there
(`pulse-lockup-dark.svg`, `pulse-mark-black.svg`, …):

```
public/brand/yasdu-lockup-light.png   ← YASDU logo color_Mesa de trabajo 1.png
public/brand/yasdu-lockup-dark.png    ← YASDU logo naranja blanco_Mesa de trabajo.png
```

The source names carry spaces and Illustrator artboard cruft ("Mesa de trabajo 1"),
which would need URL-encoding in every reference and would break the moment someone
re-exports the artboard. Rename on the way in **(AB5)**.

**PNG, not SVG, and that is a real difference from every other logo in this app.**
Pulse's own marks are inline SVG (`shared/Logo.tsx`) and scale freely; the Yasdu kit
ships PNG plus a `.ai` source with no SVG export. At 427 px native and a 96 px
display width the raster has ~4.4× headroom, so it stays crisp through 3× displays
— but it must be given explicit `width`/`height` to avoid layout shift, and `alt="Yasdu"`.
If an SVG export appears later, swapping it in is a one-line change **(AB6)**.

## 4. The version string

`package.json` says `"version": "0.0.0"` and has never been bumped, so it cannot be
the source — an About box that reports `0.0.0` to every user is worse than no
version line, because it looks authoritative and answers nothing.

Inject the real thing at build time via Vite `define`:

```ts
// vite.config.ts
define: {
  __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
  __APP_COMMIT__: JSON.stringify(gitShortSha()),   // `git rev-parse --short HEAD`
  __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
}
```

Display **`{commit} · built {date}`**. The commit is the field that actually
identifies a build in a repo that deploys from `main` several times a day; the
semver field is decoration until releases are tagged **(AB7)**.

Both constants need `declare const` entries in a `.d.ts` so `tsc -b` accepts them,
and a fallback for `npm run dev` outside a git checkout.

## 5. The copyright line

Format:

> © {year} {entity}. Pulse is a Yasdu product.

- **`{year}` is the build year, stamped by `__APP_BUILT__` — not
  `new Date().getFullYear()` (AB8).** Reading the year off the viewer's clock
  asserts a copyright date from a machine whose clock may be wrong, or deliberately
  set to 2031. A build constant states when this artefact was actually produced.
- **`{entity}` is unresolved — see AB10.** "Yasdu" is the brand; the notice should
  name whatever legal entity owns the copyright. This spec does not guess it.
- **No "All rights reserved."** It is legally inert in every Berne signatory and
  has been since 2000; it adds a line of noise. Include it only if counsel asks.

## 6. i18n

Six dictionaries, all typed `Dict`, so every key lands in all six or `tsc -b`
fails. New keys:

```
"account.about":       "About"                       ← the menu item
"about.title":         "About Pulse"                 ← dialog heading
"about.aYasduProduct": "Pulse is a Yasdu product."
"about.version":       "{commit} · built {date}"
"about.visitYasdu":    "Visit yasdu.com"             ← link label / aria-label
```

**Not translated:** "Pulse", "Yasdu", the version string's digits, and the ©
symbol. Product and company names stay as-is across all six languages — the
convention already stated at the top of `en.ts` **(AB9)**.

`about.version` is a format string with placeholders rather than a concatenation,
so a locale can reorder it.

## 7. Accessibility

- The dialog gets `role="dialog"`, `aria-modal="true"` and `aria-labelledby`
  pointing at the "About Pulse" heading.
- The Yasdu logo is `<img alt="Yasdu">` — it is the *content* of the attribution,
  not decoration, so it is not `aria-hidden`.
- The external link says where it goes (`about.visitYasdu`), not "click here", and
  carries `rel="noopener noreferrer"`.
- The version block is selectable text. People paste it into bug reports; an
  unselectable version string defeats the entire point of having one.

## 8. Decisions

1. **AB1 — Position in the menu. ✅ RESOLVED: last in the main group, above the
   sign-out divider.** *Rejected: below Sign out.* Sign out is the menu's terminal
   action and conventionally anchors the bottom; putting an informational entry
   under it makes the destructive-ish item float in the middle. "Last option" is
   read as "last of the options", with Sign out as the group's closer.
2. **AB2 — Reach. ✅ RESOLVED: dashboard only in v1.** The account menu renders at
   `DashboardPage.tsx:197` and nowhere else. *Rejected: also mounting AccountMenu in
   the Pulse toolbar and mobile header* — that is a menu-placement project with its
   own layout questions, and it would hold About hostage to it.
3. **AB3 — Which file is the light-mode logo. ✅ RESOLVED:
   `YASDU logo color_Mesa de trabajo 1.png`.** The request named
   `naranja blanco` for both modes; opening the files shows `naranja blanco` is the
   white-wordmark lockup, which is invisible on the dialog's white surface.
4. **AB4 — Light/dark selection. ✅ RESOLVED: surface, not theme; ship both files,
   render the light one.** Pulse has no dark mode — no `prefers-color-scheme`, no
   theme state. *Rejected: wiring a `prefers-color-scheme` swap now* — it would be
   the app's only theme-aware element, and it would flip the Yasdu logo while every
   surface around it stayed white.
5. **AB5 — Asset names. ✅ RESOLVED: rename to `yasdu-lockup-{light,dark}.png` in
   `public/brand/`.** *Rejected: referencing the originals in place* — spaces need
   URL-encoding and "Mesa de trabajo 1" is an artboard number that changes on
   re-export.
6. **AB6 — PNG. ✅ RESOLVED: accept PNG with explicit dimensions.** The kit has no
   SVG export. 427 px native against a 96 px display width covers 3× displays.
   *Rejected: tracing an SVG* — a hand-traced logo is a wrong logo.
7. **AB7 — Version source. ✅ RESOLVED: git short SHA + build date, injected by
   Vite `define`.** *Rejected: `package.json`'s version* — it is `0.0.0` and
   unmaintained, and a confident wrong answer is worse than none.
8. **AB8 — Copyright year. ✅ RESOLVED: build-time constant.** *Rejected:
   `new Date().getFullYear()`* — it reports the viewer's clock, not when the work
   was produced.
9. **AB9 — Translating brand names. ✅ RESOLVED: never.** Matches the existing
   convention in `en.ts`.
10. **AB10 — The legal entity in the copyright notice. ⛔ OPEN — blocks the
    copyright string.** Is it "Yasdu", or a registered company name that differs
    from the brand? Everything else in this spec can be built while this is
    outstanding; the notice cannot be written without it, and it must not be
    guessed.
