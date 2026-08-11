# Spec — List Pulse on the Yasdu site

**Audience:** a Claude Code session working in the **Yasdu website repo** (not the Pulse repo).
**Goal:** add Pulse to the Yasdu product site — what it is, what it does, what it costs — and
link visitors to the live app.

This document is the **content source of truth**. Every product fact below was taken from the
Pulse codebase, not from marketing material. Do not invent features, benefits, metrics,
customer counts, or testimonials. If something you want to say isn't in §3, it isn't
verified — leave it out or ask.

---

## 1. Before you write anything — discover the site

You are in a repo this spec's author has never seen. Do not assume a stack, a routing
convention, or a design system. Establish these first, and match them:

1. **Stack and build** — framework, router, styling approach, how pages are added.
2. **Existing product pages.** Yasdu promotes other products; find one and read it end to
   end. **Pulse's page must be a sibling of that page in structure, tone, and length**, not a
   new invention. Reuse existing components rather than adding new ones.
3. **Navigation** — how a product is registered in menus, footers, sitemaps, product indexes.
   List every place a product appears; Pulse must appear in all of them.
4. **i18n** — does the site translate content? If yes, find the dictionary mechanism and
   whether keys must exist in every language (Pulse's own app enforces exactly that). Add
   Pulse's strings the same way. If the site is English-only, keep Pulse English-only.
5. **SEO conventions** — meta/OG tags, structured data, sitemap. Match what other products do.
6. **Analytics** — if outbound clicks are tracked, tag Pulse's CTAs the same way.

Report what you found before building. If the site turns out to have no product-page pattern
at all, stop and ask rather than inventing one.

---

## 2. Deliverables

1. **A Pulse product page** — the main deliverable. Content from §3.
2. **A pricing section or page** — the three plans from §3.4. Follow the site's existing
   pricing convention if one exists.
3. **Entry links to the app** — primary CTA on the Pulse page, plus wherever the site's
   pattern puts product links (nav, footer, product index, home page).
4. **Navigation/index registration** — every location found in §1.3.
5. **SEO metadata** — title, description, OG image if the site uses them.

---

## 3. Verified product facts

### 3.1 What Pulse is

One line, taken verbatim from the app's own login screen:

> **Visual, graph-first project planning.**

Branded in-app as **"Pulse — by Yasdu"**. Use that relationship; Pulse is a Yasdu product,
not a separate company.

The single idea that distinguishes it, from the in-app help:

> Your roadmap is a 2D canvas: time runs left to right, and each box is a task. Horizontal
> bands are epics — the groups you organise work into.

And the differentiator worth leading with, because the help text itself calls it the
surprising part:

> A box's height is not decoration. It's how much parallel effort the task takes per day, so
> a tall box is heavier work than a short one of the same length.

That is the hook: **a roadmap where size means work**, not just duration. A Gantt chart tells
you when; Pulse also tells you how much. Everything else on the page is supporting detail.

### 3.2 Features — all verified as shipped

Derived from the in-app help (`src/help/en.ts` in the Pulse repo), which is editorially bound
to document **only what is actually deployed**. Group and trim as the site's page pattern
requires; do not add to this list.

| Feature | What to say |
|---|---|
| **The canvas** | 2D roadmap — time left to right, tasks as boxes, epics as horizontal bands. Drag to move, drag edges to reschedule. |
| **Effort as height** | Box height = parallel effort per day. Graph effort, estimated effort, and assigned effort are tracked separately, with a status dot for under/over-staffing. |
| **People and capacity** | Assign people at a % allocation; see whether the crew matches the estimate. |
| **Costs** | AI spend recorded per task (by model, in dollars or tokens) and people cost derived from allocation × hours × hourly rate. Rates and people-cost are admin-only. |
| **Plan vs. actual** | Set a baseline plan and compare against real progress, including delay lines. |
| **Kanban board** | Board view with user-defined, reorderable statuses; "Done" is reserved and always last. |
| **Epics and subtasks** | Group work into epics; tasks carry subtasks with their own resources. |
| **Working together** | Per-Pulse invites, live presence, comments, and an activity log of who changed what. |
| **Undo** | Undo for editing actions. |
| **Filters and search** | Filter by active period; search tasks, epics and people. |
| **Mobile** | A dedicated touch UI on phones, not a shrunken desktop canvas. |
| **Six languages** | Interface in English, Spanish, French, German, Italian and Portuguese, switchable per user. |
| **In-app help** | Searchable help built into the product. *(English only — say so if the page claims language coverage.)* |

**Do NOT advertise:** file attachments, cloud-storage integration (Google Drive etc.),
email or push notifications, SSO/SAML, an API, exports, or integrations. Some are specified
in the Pulse repo but **none are built**. Advertising a spec is advertising a lie.

### 3.3 Getting started

- Sign up with **Google** or **email and password**.
- No credit card to start — the free tier is the default for every new account.
- No installation; it runs in the browser.

### 3.4 Plans and pricing

Pricing is **per editor seat, per month, in USD**, billed monthly through **Stripe**. Payment
details are entered on Stripe's hosted pages, never in the app.

| | **Starter** | **Pro** | **Business** |
|---|---|---|---|
| Price (per editor / month) | **$0** | **$6** | **$12** |
| Editor seats | 1 | per seat bought | per seat bought |
| Pulses | 3 | 5 | Unlimited |
| Collaborators | 10 | 20 | Unlimited |
| Resources per Pulse | 20 | 40 | Unlimited |

Two things that must be communicated, because they are the model:

- **Every tier has every feature.** Tiers differ *only* by the quantities above. There is no
  feature gating. Do not build a page with feature checkmarks and crosses — it would be
  false.
- **Only editors consume a paid seat.** Viewers, my-beat viewers and task leads —
  collectively "collaborators" — are **free** and don't need a licence. Say this plainly;
  it's the most commercially attractive fact on the page.

> ### ⚠️ "Pro" is the **middle, paid** tier — not the free one
>
> The tiers were renamed on 2026-08-10. The free tier is **Starter**; **Pro is the $6 paid
> tier** (it was previously called Teams). If you find older Pulse material — a draft, a
> screenshot, a cached spec — calling Pro the *free* tier, that material predates the rename
> and is wrong.
>
> Order the columns **Starter → Pro → Business**, cheapest first, and label Starter "Free".
> "Upgrade to Pro" is now correct and expected copy.

**Price accuracy.** These figures come from the Pulse spec and match the Stripe products
today. **Stripe is what actually charges the customer.** If you can check the live Stripe
prices, do; if they disagree with this table, stop and ask rather than publishing either
number.

**Tax.** Stripe Tax computes VAT/IVA, charged VAT-inclusive; the launch market is Mexico,
billed in USD. Don't state a tax treatment more specific than "taxes calculated at checkout"
unless someone with authority confirms the wording.

### 3.5 Entry URL

**The canonical URL to publish:**

```
https://pulse.yasdu.com
```

This is a decided branded domain (2026-08-10), not a placeholder. Pulse's backend already
pre-authorises it, so the app side needs nothing further.

> ### ⚠️ Verify it resolves before you ship the link
>
> The DNS cutover is a **separate, manual task in the Firebase console and the yasdu.com DNS
> zone**, and it may not be done yet when you read this. Before publishing, check:
>
> ```
> curl -sI https://pulse.yasdu.com | head -1
> ```
>
> - **`HTTP/2 200`** → the domain is live; publish it.
> - **DNS failure, or a certificate warning** → the cutover is incomplete. Firebase's SSL
>   provisioning can take up to ~24h after the records are added. **Stop and ask** rather
>   than either publishing a dead link or quietly substituting the Firebase URL — a marketing
>   page that silently points somewhere off-brand is worse than a delayed launch.
>
> `https://pulse-b9d96.web.app` and `https://pulse-b9d96.firebaseapp.com` are the raw Firebase
> Hosting domains. They serve the same app and will keep working, but they are **not** for
> publication — use them only to sanity-check that the app is up.

**Define the URL once**, as a single shared constant/config value in the site codebase. Do not
scatter the literal across templates: a domain that appears in six places is a domain that
gets half-changed.

Link behaviour: the site's existing convention wins. If there is none, open in the same tab
(it's a Yasdu product, not an external site) and don't add `noopener` theatrics for a
first-party link.

Suggested CTA wording — pick one and use it consistently: **"Open Pulse"**, **"Start free"**,
**"Try Pulse free"**. Avoid "Sign up free" if the site's other products use different verbs.

### 3.6 Brand tokens

Pulse's own palette, so the page can feel like the product it links to. Use these only as far
as the Yasdu design system allows — **the site's system wins over these values**.

| Token | Hex | Use in Pulse |
|---|---|---|
| Navy | `#123359` | App header, Business tier accent |
| Orange (primary) | `#D85A28` | Primary buttons, active state |
| Soft orange | `#F0A875` | Accents |
| Background | `#FDFCF8` | Page background |
| Ink | `#1F2330` | Body text |
| Muted | `#6E7180` | Secondary text |
| Border | `#E2DFD9` | Dividers, card borders |

Typefaces: **Space Grotesk** (display/headings), **Inter** (body), **JetBrains Mono**
(monospace details). Only adopt these if the Yasdu site already loads them or can afford to;
do not add three font families to a marketing site for one product page.

**Screenshots:** none are provided with this spec. The canvas is the product's whole
argument, so a real screenshot is worth more than any paragraph. Ask for one rather than
generating a mockup — a fabricated screenshot of a real product is a lie about what it looks
like.

---

## 4. Content rules

1. **No invented claims.** No user counts, uptime figures, "trusted by", case studies,
   testimonials, awards, or comparison claims about named competitors. Nothing about
   security, compliance, GDPR or SOC2 — none of it has been verified.
2. **No roadmap language as if shipped.** No "coming soon" either, unless someone with
   authority supplies the commitment.
3. **Say what tiers actually differ by** (quantities, §3.4), never feature checkmarks.
4. **Match the site's voice**, not Pulse's in-app voice. The help text quoted above is a good
   source of *facts*; it is not necessarily the right *register* for a marketing page.
5. **Accessibility parity** with the rest of the site: real heading hierarchy, alt text on
   any image, contrast that passes whatever bar the site already meets.

---

## 5. Acceptance criteria

Verify each; don't assume.

- [ ] Pulse page exists, builds, and renders — run the site's own build and lint.
- [ ] Pulse appears in **every** navigation surface identified in §1.3.
- [ ] Every CTA points at `https://pulse.yasdu.com` (§3.5), from one shared constant, and that
      URL returns HTTP 200 with a valid certificate (`curl -sI` it — do not skip this).
- [ ] The pricing table matches §3.4 exactly — three tiers, Starter → Pro → Business, Starter
      labelled free, and no tier called "Teams" anywhere.
- [ ] No feature outside §3.2 is mentioned; nothing from the "do NOT advertise" list appears.
- [ ] If the site is multilingual, every new key exists in every language.
- [ ] Responsive: pricing table and any diagram are readable on a narrow phone and don't
      cause horizontal page scroll.
- [ ] SEO metadata present and consistent with other product pages.
- [ ] No placeholder text, lorem ipsum, or TODO left in shipped markup.

---

## 6. Ask before building

Resolve these with the user first — each changes the work materially:

1. **Is `pulse.yasdu.com` live yet?** The domain is decided, but the DNS/SSL cutover is manual
   and may still be pending — check it per §3.5 before publishing any link.
2. **Screenshots or a demo video** — available? If not, what visual should carry the page?
3. **Depth** — one page, or a page plus a separate pricing page? Match the other products or
   deliberately exceed them?
4. **Audience and market** — the launch market is Mexico with USD pricing. Should the page be
   Spanish-first, bilingual, or English-only?
5. **Publish or stage** — is this going live, or into a preview branch pending review? Pricing
   pages usually want a human sign-off.

---

## 7. Non-goals

- No changes to the Pulse app itself. This spec only touches the Yasdu site repo.
- No sign-up, checkout, or payment flow on the Yasdu site. Registration and Stripe Checkout
  both live inside Pulse; the site's only job is to explain and link.
- No blog post, launch email, changelog entry, or social copy.
- No analytics/tag-manager setup beyond matching what other product pages already do.

---

## Appendix — provenance

Every fact in §3 traces to the Pulse repo, should the executing session (or a reviewer) want
to check it:

| Fact | Source |
|---|---|
| Tagline | `src/i18n/en.ts` → `auth.tagline` |
| Canvas / effort / feature descriptions | `src/help/en.ts` (documents only deployed features) |
| Tier quotas | `src/domain/entitlements.ts` → `TIER_ENTITLEMENTS` |
| Prices | `src/domain/entitlements.ts` → `TIER_PRICE_USD`; authoritative source is Stripe |
| Free-collaborator / paid-editor model | `Plans-Spec.md` §3.1 (PL9) |
| Quota-only, no feature gating | `Plans-Spec.md` §3 (PL2) |
| Stripe, hosted payment pages, Stripe Tax | `Plans-Spec.md` §6/§9, `functions/src/billing.ts` |
| Six languages | `src/i18n/langs.ts` → `SUPPORTED_LANGS` |
| Colours and fonts | `src/index.css` |
| Entry URL | `firebase.json` hosting target, project `pulse-b9d96` |
| Unbuilt features | `Storage-Spec.md`, `Server-Functions-Spec.md` (SF2/SF5–SF7 still deferred) |
