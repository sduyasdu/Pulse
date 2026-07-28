# Pulse — In-app Help Spec

Status: **Ready to build — HL2/HL5/HL9 resolved, HL8 withdrawn; HL1, HL3, HL4, HL6, HL7, HL10–HL13 open with recommendations (none blocking). v1 ships English only; all locales fall back to it.** · Owner: product + eng ·
Related: `Pulse-Product-Spec.md` (the functionality being summarized),
`Costs-Spec.md` (§6 the Cost view), `Permissions-Spec.md` (roles a reader may hold)

## 0. What this is (and isn't)

A **help panel** inside a Pulse: a short, localized summary of what the tool does
and how its less obvious ideas work — opened from a `?` icon in the toolbar, next to
**Effort scale**.

The bar for "done" is low on purpose: someone who has just been invited to a Pulse
should be able to answer *"why is that box taller than this one?"* in under a minute
without leaving the app.

**Not** in scope: an onboarding tour or coach marks, a hosted docs site, videos,
per-control contextual help, a what's-new/changelog feed (that's the activity log's
neighbour, not this), or support contact forms.

It **does** include a search box (§2.1) — not because eight sections are hard to
scan, but because readers don't know Pulse's vocabulary. Someone types *gantt*,
*salary*, *zoom* or *timesheet*; the copy says canvas, hourly cost, day width and
hours. Search is where that gap gets closed.

## 1. Where it lives

A `?` button in the toolbar's right-hand cluster, immediately left of **Effort
scale**, opening the panel described in §2.

Two things about that placement that the code makes non-obvious:

- **It must sit outside the `canEdit` gate.** The Effort-scale button lives inside
  `{canEdit && (…)}` in `Toolbar.tsx`, so viewers never see it. Help belongs to
  *everyone* — and viewers, being the newest arrivals, need it most. Rendering help
  inside that block would hide it from exactly its audience (**HL4**).
- **The `?` glyph does not exist yet.** `icons.ts` holds 66 baked Material Symbols
  paths and none of them is `help`, `info` or `question_mark`. `Icon` returns `null`
  for an unknown name, so referencing one that isn't there yields a **button with no
  content, no width, and nothing to click** — precisely the bug that made the Cost
  view's drill-down un-collapsible. Add the path in the same change, and verify the
  button renders before wiring anything else.

## 2. Form factor

A **right-hand drawer**, reusing the geometry of the comments drawer already in
`PulsePage.tsx`: absolutely positioned over the right edge of the content area,
~360px wide, `maxWidth: 92%`, with its own header and close button. It overlays
rather than reflows, so opening help never moves the canvas underneath — which
matters when the whole point is to explain what you're looking at.

- Toggled by the toolbar button; closes on the ✕, on `Esc`, and on a second press
  of the button.
- Scrolls internally; sections are plain stacked blocks, no accordion in v1
  (**HL3**) — a reader scanning six short sections doesn't need to click twice.
- Only one right-edge drawer should be open at a time: opening help closes comments
  and vice versa. Two overlapping 360px panels is a layout bug waiting to be filed.

### 2.1 Search

A search box pinned at the top of the panel, above the sections and below the header,
so it stays put while the list scrolls. It follows the input idiom already used by the
dashboard, the mobile list and `MultiSelectFilter`: a `search` icon inside the field
on the left, a `✕` to clear on the right (reusing `dashboard.clearSearch`).

**What it matches.** Typing filters the section list. A section matches when the query
appears in its title, its body, any bullet term or text, **or its `keywords`** — the
last one being what makes search useful rather than decorative (§4's shape):

| Reader types | Should reach | Because the copy says |
|---|---|---|
| gantt, timeline | The canvas | "canvas", "time runs left→right" |
| salary, pay, rate | Costs | "hourly cost" |
| zoom, bigger | Getting around | "day width", "view zoom" |
| timesheet, hours | Costs | "hours × rate" |
| permission, share | Working together | "roles", "invite link" |

Keywords are localized like everything else, so a Spanish reader typing *sueldo* lands
on Costs.

**Matching rules.**

- **Accent- and case-insensitive.** This is not optional with six languages: *capacidad*
  must match *Capacidad*, *período* must match *periodo*, *Größe* must match *grosse*.
  Normalize both sides — `NFD`, strip combining marks, `toLocaleLowerCase()` — in one
  helper, not at each call site (**HL12**).
- **Substring, not fuzzy.** No Levenshtein, no stemming. A short panel doesn't need it
  and near-misses are more confusing than no match.
- **All terms must appear** (whitespace-split), so *cost rate* narrows rather than
  widens.
- **Matches are highlighted** in the rendered text. The highlight is applied by the
  component splitting on the match — the content stays plain strings, so HL10 holds.

**Empty state.** No match shows one line — *"Nothing matches "{query}""* — plus a
clear affordance, so the reader is never stranded with a blank panel and no way back.

**Not auto-focused** (**HL13**): stealing focus on open would swallow the next
keystroke on desktop and pop the keyboard on mobile, where the user probably wants to
read first.

## 3. Content — what "key functionalities" means

Eight sections, each a short paragraph plus a few labelled bullets. Ordered by what
a newcomer hits first, not by how the code is organized.

| # | Section | Covers |
|---|---|---|
| 1 | **The canvas** | Time runs left→right; epics are horizontal lanes; each box is a task. Drag to move, edges to resize. |
| 2 | **Box height means work** | The differentiator, and the thing nobody guesses: height is parallel effort per day, not decoration. Elapsed days × work/day = Graph Effort. The Estimate can be locked; the staffing dot compares assigned vs. estimate. |
| 3 | **Getting around** | Pan, view zoom vs. day width (two different zooms), day/week/month density, `fit`, `compact`, shrink epics, the today marker. |
| 4 | **People and load** | Team tab, drag a person onto a task, % allocation, capacity limit, utilization, the Assignment-by-resource panel. |
| 5 | **Costs** | AI spend recorded per task; labour derived from assignment × hours × rate; the Cost view's pivots and totals; rates are admin-only. |
| 6 | **Plan vs. actual** | Freeze a baseline with *set plan*; the Delays toggle draws planned vs. real spans with deltas. |
| 7 | **Working together** | Roles in one line each, the invite link, comments and @-mentions, activity log, who's viewing now. |
| 8 | **Board, filters, undo** | The Kanban view and custom statuses; search/status/epic filters and My Beat; ⌘Z / ⇧⌘Z. |

**Editorial rules** (as load-bearing as the structure):

- **Don't restate the UI.** If a control already has a tooltip that explains it,
  help doesn't repeat it. Help exists for the *concepts* — height-as-effort, the two
  zooms, plan-vs-actual, derived labour cost — not for the button inventory.
- **Two sentences per idea, maximum.** Anything longer belongs in a spec.
- **Name things as the UI names them**, in the reader's own language, so the text and
  the screen agree.
- **No screenshots.** They rot, they need re-shooting per locale, and they'd have to
  be embedded (the app has no external asset host). Describe instead.
- **No external links.** Self-contained, like the rest of the app.
- **Only what's deployed** (**HL9 — resolved**). Help documents the app as it is, never
  as it will be: costs are live and belong here, BYOS is specified and does not. A
  reader hunting for a feature that isn't there trusts nothing else on the panel.
  Practically, this means a section arrives *with* the feature, not before it.

## 4. Localization — and why help does *not* go in the dictionaries

Help must appear in all six supported languages (`en`, `es`, `pt`, `fr`, `it`, `de`),
but it should **not** live in `src/i18n/*.ts` (**HL1**).

Two reasons, both concrete:

- **Bundle cost.** The i18n dictionaries already compile to a **~109 KB** chunk that
  loads on every page. Help prose is an order of magnitude more text than UI labels;
  adding it would grow a chunk every visitor pays for, to serve a panel most sessions
  never open.
- **The wrong strictness.** `Dict` is exact — a key missing from one locale is a
  **compile error**. That's right for UI labels, where a missing string would render
  blank. It's wrong for prose: a paragraph not yet translated should fall back to
  English, not block the build. Forcing six translations before any help can ship is
  how help ends up never shipping.

So: **`src/help/{lang}.ts`**, one module per locale, **dynamically imported when the
drawer first opens** and cached thereafter. A locale with no module falls back to
`en` (**HL2**).

```ts
/** src/help/types.ts */
export interface HelpBullet {
  term: string;
  text: string;
}
export interface HelpSection {
  /** Stable, never translated — the anchor and the React key. */
  id: "canvas" | "effort" | "navigation" | "people" | "costs" | "plan" | "collab" | "board";
  title: string;
  body: string;                 // one short paragraph
  bullets?: HelpBullet[];
  /** Folk terms and synonyms a reader might search for that the copy doesn't
   * use — "gantt", "salary", "zoom" (§2.1). Localized like the rest. */
  keywords?: string[];
}
export interface HelpDoc {
  /** Rendered small at the foot of the panel, so staleness is visible (§7). */
  reviewedAgainst: string;
  sections: HelpSection[];
}
```

```ts
/** src/help/index.ts */
const LOADERS: Record<string, () => Promise<{ help: HelpDoc }>> = {
  en: () => import("./en"),
  // Add a locale by adding its module here — nothing else changes.
};
export async function loadHelp(lang: string): Promise<HelpDoc> {
  const load = LOADERS[lang] ?? LOADERS.en;
  return (await load()).help;
}
```

**Ships English-only; every other language falls back to it** (**HL2 — resolved**).
The registry above is the whole mechanism: a locale with no module gets `en`, so
adding Spanish later is one file plus one line, with no change to the drawer, the
search, or the loader. English-only is a starting state, not a design limit.

Worth saying plainly in the panel rather than silently serving English to a Spanish
reader: when the fallback is in effect, the footer notes that help is currently
available in English (one dictionary key, translated — the *notice* is localized even
though the content isn't).

- **Plain strings only — no HTML, no markdown** (**HL10**). No parser to maintain, no
  sanitizer to get wrong, and no way for translated copy to smuggle in markup. Where
  emphasis is genuinely needed, the `bullets[].term` / `text` split carries it
  structurally.
- Only `en` is required. Ship English first and land translations as they arrive —
  the fallback makes that safe rather than embarrassing.
- The drawer re-loads when the user changes language (`i18nStore`), like everything
  else.

## 5. Accessibility & keyboard

- The trigger is a real `<button>` with `aria-expanded` and an `aria-label`; the
  drawer is `role="dialog"` `aria-modal="false"` (it doesn't trap the app) with an
  `aria-labelledby` pointing at its heading.
- `Esc` closes and returns focus to the trigger.
- Section headings are real `<h3>`s in order, so a screen reader can outline the
  panel.
- Respect `prefers-reduced-motion` on the open/close transition.
- **No new global shortcut in v1.** `?` is tempting but collides with typing in any
  text field, and `PulsePage`'s existing key handler already has to guard for that
  (**HL6**).

## 6. Mobile (HL5 — resolved)

`MobilePulseView` has no toolbar, so there's no "beside Effort scale" to sit next to.
**Decided: a `?` button in the mobile header**, beside the comments and notifications
buttons already there.

Same content, presented full-screen rather than as a 360px drawer — matching how
mobile already handles comments and the task editor. `HelpDrawer` therefore takes a
`fullScreen` flag rather than being forked; the content module is shared verbatim, so
this is layout work, not a second help to maintain.

## 7. Keeping it true

Help that lies is worse than no help. Two cheap guards:

- **A `reviewedAgainst` string** in each locale module (`"2026-07"`), rendered small
  at the foot of the panel. A reader can see how current it is; a maintainer can see
  what's stale.
- **Short by construction.** Eight sections of two sentences drift far more slowly
  than a manual. What churns is buttons and layout, which §3's editorial rules keep
  out of the help; what's here — height means work, the two zooms, plan vs. actual —
  hasn't changed since the prototype.
- **The convention, not a role:** whoever ships a feature checks whether it changes
  one of the eight paragraphs. Usually it doesn't. Combined with HL9 (a section
  arrives with its feature), that's enough process for a panel this size — no
  dedicated owner, no review cadence.

Adding a section is a product decision, not a code one: the section list is the
promise about what Pulse *is*.

## 8. Implementation notes

- **`icons.ts`** — add the `help` (or `help_outline`) path first, and confirm the
  button renders (§1).
- **`Toolbar.tsx`** — the `?` button goes in the right-hand cluster **outside** the
  `canEdit` block; it needs `helpOpen` / `onToggleHelp` props, owned by `PulsePage`
  alongside `commentsOpen`, so the two drawers can be mutually exclusive.
- **`src/components/help/HelpDrawer.tsx`** — presentational: takes `content` and
  `onClose`, renders sections. All copy comes from the content module; the only
  strings in the component itself are the panel title and the close label, which do
  belong in the dictionaries.
- **`src/help/*`** — content modules per §4. No React, no imports from `@/`.
- **i18n** — only three new keys (`help.title`, `help.open`, `help.close`) go into all
  six dictionaries. The prose does not.
- **No store, no persistence.** Open/closed is component state; there's nothing to
  remember between sessions.

## 9. Decisions (HL1–HL10)

1. **HL1 — Content location.** Separate lazy modules vs. the i18n dictionaries.
   *Recommend modules — the dictionaries are already a 109 KB always-loaded chunk, and
   `Dict`'s exactness would make a missing translation a build failure.*
2. **HL2 — Fallback granularity. ✅ RESOLVED: whole-file fallback to `en`, and v1
   ships English only.** Mixed-language help reads as broken, so it's never partial.
   The panel says so in the reader's language when the fallback applies (§4).
3. **HL3 — Accordion or plain stack?** *Recommend a plain scrolling stack for eight
   short sections; accordions add a click for no gain.*
4. **HL4 — Visible to viewers.** Not really optional: outside the `canEdit` gate, or
   the people who most need help can't reach it. *Confirm.*
5. **HL5 — Mobile entry point. ✅ RESOLVED: a `?` in the mobile header**, beside the
   existing comments and notifications buttons. Same content, full-screen instead of a
   drawer (§6).
6. **HL6 — A `?` keyboard shortcut?** *Recommend not in v1 — it collides with typing
   and needs the same input guards as the undo handler.*
7. **HL7 — Context sensitivity.** Should opening help from the Cost panel land on the
   Costs section? *Recommend not in v1; the `id`s in §4 make it a later addition,
   since anchors already exist.*
8. **HL8 — Who owns the copy? ✅ WITHDRAWN — not a decision.** It was an ongoing
   obligation dressed as a choice, and it gated nothing: the English copy and all six
   translations can be written with the feature. Recorded instead as a convention in
   §7 — whoever ships a feature checks the eight paragraphs. *(Number retained so
   references stay valid.)*
9. **HL9 — Does help mention unshipped features? ✅ RESOLVED: only what's deployed.**
   Help is not a roadmap; a section ships with its feature (§3).
10. **HL10 — Plain text vs. markdown.** *Recommend plain strings plus the structured
    bullet shape: no parser, no sanitizer, no markup in translations.* Search
    highlighting is applied by the component, so it doesn't breach this.
11. **HL11 — What search matches.** Title + body + bullets + `keywords`, all terms
    required, substring not fuzzy (§2.1). *Recommend as specified; `keywords` is the
    part that makes it worth having.*
12. **HL12 — Accent-insensitive matching.** Not optional across six languages.
    Normalize `NFD` → strip combining marks → lowercase, in one shared helper.
13. **HL13 — Auto-focus the search box on open?** *Recommend no — it swallows the next
    keystroke on desktop and opens the keyboard on mobile.*
