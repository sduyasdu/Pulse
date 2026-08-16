# The mobile version


Decide the mobile strategy **before** the first layout, because the two options
diverge immediately and converting between them is a rewrite.

## 5.1 Responsive or a separate view?

- **Responsive one layout** — right when mobile is the same work, smaller.
- **A distinct mobile view** — right when the interactions genuinely differ. A
  drag-and-drop canvas is not a small phone screen; it is a list.

Pulse chose a separate `MobilePulseView` for the app shell (phones get a list and
a board; desktop gets the canvas) while **sharing every detail component** —
forms, panels and dialogs are the same code in both. That is the balance worth
copying: **shared components, different shells.** If you find yourself
maintaining two copies of a form, the split is in the wrong place.

## 5.2 Detect the right thing

Two different questions, two different media queries:

```ts
useIsMobile()      // (max-width: 767px), (max-height: 480px) → WHICH layout
useCoarsePointer() // (pointer: coarse)                       → CAN they hover
```

Tablets are wide **and** touch. Using width to decide hover behaviour breaks
them; using pointer type to decide layout gives phones a desktop shell.

## 5.3 Hover is not available, and it does not fail loudly

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

## 5.4 Viewport, safe areas, and the address bar

`100vh` is wrong on mobile Safari as the address bar moves. Pin to the real
measured height and update on `resize`/`visualViewport` resize. Respect
`env(safe-area-inset-*)` for bottom navigation.

## 5.5 Touch targets and long-press

Small icon buttons that are comfortable with a mouse are not with a thumb. Give
touch surfaces real size, opt large/edge buttons out of press-shrink animations
(shrinking moves the target away from the finger and drops the tap), and suppress
the long-press text-selection callout on any surface where long-press is your own
gesture.

## 5.6 Sticky headers earn their place on mobile

A long form on a small screen loses its context. Pin the identifying header —
and remember an opaque background and negative margins that cancel the
container's padding, so content scrolls *under* it rather than beside it.
