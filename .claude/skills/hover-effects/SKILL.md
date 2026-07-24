---
name: hover-effects
description: Use whenever you add or change a hover effect in Pulse — any CSS :hover, Tailwind hover:/group-hover: utility, or JS onMouseEnter/onMouseLeave. Ensures every hover effect has a defined, correct behaviour on both the web (desktop, fine pointer) and mobile/touch (coarse pointer), instead of silently breaking or "sticking" on touch.
---

# Hover effects: always define web AND mobile behaviour

**Touch devices have no hover.** A finger either isn't on the screen or is
tapping. So a `:hover` style on touch does one of two bad things:

1. **Never fires** — anything *revealed* or *enabled* only on hover is
   unreachable (dead functionality).
2. **Sticks** — after a tap the element keeps its hover style until you tap
   elsewhere ("sticky hover"), so tapped things look permanently highlighted.

Because of this, **no hover effect ships without a decided touch behaviour.**
This is a hard rule, not a nice-to-have.

**Always use a defined custom hover — never the standard/default one.** Don't
lean on the browser's default hover or the app's implicit global
`button:hover` scale as *the* hover for an element. Apply an explicit, defined
treatment: the **standard hover style** below (`.hoverable`), a documented
variant, or a Tailwind `hover:` utility chosen on purpose. If none fits, define
the new treatment **here in this skill first**, then use it — so hover stays
consistent and intentional across the app instead of ad-hoc.

## The definitions this repo already uses (build on these — don't reinvent)

- **`useIsMobile()`** — `src/hooks/useIsMobile.ts`, matches
  `(max-width: 767px), (max-height: 480px)`. Phones get the dedicated
  `MobilePulseView`; desktop/tablet get the canvas UI. Use it for *layout /
  which-component* decisions.
- **`useCoarsePointer()`** — same file, matches `(pointer: coarse)`. True on
  **all touch devices including iPad** (which is wide but has no hover). Use it
  for *interaction / touch-target / hover* decisions. Prefer this over
  `useIsMobile()` when the question is "can the user hover?", because a tablet
  is not mobile but still can't hover.
- **Tailwind v4** (`^4.3`): the `hover:` and `group-hover:` variants are
  **already gated** behind `@media (hover: hover)`. So `hover:*` utilities are
  touch-safe — they simply don't apply on touch. This is the preferred way to
  add *decorative* hover.
- **Global `button` affordance** (`src/index.css`): every enabled `<button>`
  gets `:hover { transform: scale(1.12); filter: brightness(1.08) }` and
  `:active { scale(0.9) }`. **This rule is raw CSS and NOT gated**, so it is the
  one known place hover sticks on touch (see "Known gap" below). Don't copy that
  pattern.
- **`.no-press`** — opts a button out of the scale transform (keeps brightness);
  for large/edge buttons where shrinking would drop the tap. **`.no-select`** —
  suppresses long-press callout on gesture surfaces.

## Decision guide

Classify the hover effect first, then apply the matching rule.

### A. Decorative hover (emphasis only)
Colour / brightness / shadow / underline / scale on a control that is **already
visible and already fully usable without hovering**.

- ✅ It's fine for this to simply be **absent on touch**.
- **Do:** use a Tailwind `hover:` utility (auto-gated) — e.g.
  `hover:underline`, `hover:bg-yasdu-secondary`, `hover:brightness-125`.
- **In raw CSS:** wrap it in `@media (hover: hover)` (never a bare `:hover`).

### B. Functional hover (reveal / enable / inform)
Hover that **reveals** controls (row actions, "×" delete), **shows** info
(tooltip, popover), or **enables** something. On touch this is a trap — the
thing is unreachable.

- ✅ **Must have a touch equivalent.** Choose one:
  - **Always-visible on touch** (simplest, usually best): show it unconditionally
    for coarse pointers, and *only* hide-until-hover for fine pointers.
  - **Tap / long-press** to toggle it (wire real `onClick` / pointer events, not
    hover).
- ❌ Never let hover be the *only* path to functionality.
- Precedent in this repo: `PulseCard`'s actions menu is **always visible**
  rather than hover-revealed, exactly for this reason.

### C. JS hover (`onMouseEnter` / `onMouseLeave` / hover state)
- Touch fires these inconsistently — never depend on them for anything
  functional.
- Gate them with `useCoarsePointer()` (skip the hover path on touch) **and**
  provide the touch trigger (tap/long-press), or drop the JS-hover entirely in
  favour of pattern B.

### D. Motion
- Any hover that animates `transform`/`opacity`/movement must honour
  `@media (prefers-reduced-motion: reduce)` (disable or reduce it).

## Standard hover style (the default — reach for this first)

The canonical hover treatment lives in `src/index.css` as **`.hoverable`**. It is
already touch-safe (`@media (hover: hover)`) and motion-safe
(`prefers-reduced-motion`), and it uses `filter` + `box-shadow` **only** (no
`transform`), so it composes with the global button scale and `.no-press`
without cascade fights.

```css
/* src/index.css — do not duplicate; extend here if a variant is needed. */
.hoverable {
  transition: filter 0.14s ease, box-shadow 0.14s ease, background-color 0.14s ease;
}
@media (hover: hover) {
  .hoverable:hover {
    filter: brightness(1.06);
    box-shadow: 0 2px 10px rgba(15, 23, 42, 0.12);
  }
}
@media (prefers-reduced-motion: reduce) {
  .hoverable { transition: none; }
}
```

Use it by adding the class:

```tsx
<div className="hoverable rounded-xl border p-4">…</div>
<button className="hoverable">Save</button>   {/* baseline brightness+shadow, no ad-hoc :hover */}
```

Rules for the standard:
- **Default to `.hoverable`.** Only depart from it when the effect genuinely
  needs something else (e.g. a fan-out, a reveal), and then use a documented
  variant or a deliberately chosen Tailwind `hover:` utility — never a bare,
  ungated `:hover`.
- **Need a new recurring treatment?** Add it as a variant **in `index.css` and
  document it here** (e.g. `.hoverable--raise` for card lift, `.hoverable--underline`
  for text links) rather than hand-rolling per component. Keep every variant
  gated by `@media (hover: hover)` and guarded for reduced motion.
- The global `button:hover` scale is a *baseline affordance*, not a substitute
  for choosing a hover — it's the "standard/default" this skill tells you to
  replace with an explicit one.

## Patterns (copy these)

**Decorative — Tailwind (touch-safe automatically):**
```tsx
<button className="hover:brightness-125 hover:underline">Save</button>
```

**Decorative — raw CSS (must gate):**
```css
@media (hover: hover) {
  .card:hover { box-shadow: 0 8px 24px rgba(15,23,42,0.14); }
}
```

**Reveal — always-visible on touch, hover-revealed on desktop.**
Gate on *hover capability*, not width (tablets are wide but touch):
```tsx
// Tailwind: opacity-100 by default (touch), fade-in on hover only where hover exists.
<div className="opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity">
  <button title="Delete">…</button>
</div>
```
```tsx
// Or in JS, driving the same intent:
const coarse = useCoarsePointer();
const [hovered, setHovered] = useState(false);
const showActions = coarse || hovered;
<div
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
>
  {showActions && <RowActions />}
</div>
```

**Motion guard:**
```css
@media (prefers-reduced-motion: reduce) {
  .thing { transition: none; }
}
```

## Checklist — before shipping any hover effect

0. Are you using a **defined** hover (`.hoverable`, a documented variant, or a
   deliberate Tailwind `hover:`) rather than relying on the browser/global
   default? If it's a new recurring treatment, is it added to `index.css` and
   documented here?
1. Which class is it — **A decorative**, **B functional**, or **C JS**?
2. **Web (fine pointer):** does it read as interactive and not janky?
3. **Touch (coarse pointer, incl. iPad):** is the underlying control still fully
   reachable? Nothing hidden behind hover, nothing stuck-highlighted after a tap?
4. Raw CSS `:hover` is wrapped in `@media (hover: hover)` (or it's a Tailwind
   `hover:` utility).
5. Reveal/tooltip/menu has an always-visible-or-tappable touch fallback.
6. Animated? `prefers-reduced-motion` handled.
7. Prefer `useCoarsePointer()` (can-they-hover) over `useIsMobile()`
   (which-layout) for the hover decision.

## Known gap (don't extend it)

`src/index.css`'s global `button:not(:disabled):hover { transform: scale(1.12) }`
is **not** gated behind `@media (hover: hover)`, so on touch it "sticks" after a
tap. The touch-correct fix is to wrap those `:hover` rules in
`@media (hover: hover)` (keeping `:active` ungated for press feedback). Until
that's done, be aware tapped buttons may momentarily look enlarged on touch —
and **do not add new ungated `:hover` rules** that would compound it.
