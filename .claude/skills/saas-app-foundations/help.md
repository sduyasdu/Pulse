# Help, empty states and explanation


The recurring failure is not "we have no docs". It is a control that is disabled,
absent or inert with **no explanation next to it**. Treat explanation as part of
building the feature, not as a documentation project that happens later.

## 6.1 Explanation is for everyone — check the gate it lands in

Help nearly shipped inside an editors-only conditional in Pulse, which would have
hidden it from viewers: the newest arrivals, who need it most. Anything
explanatory sits **outside** the permission gate.

The general shape of this bug: you add a control to an existing block without
noticing what that block is conditional on. Worth a deliberate look every time —
`{canEdit && …}` is easy to nest into by accident.

## 6.2 Help must be translated, and never half-translated

Help is prose, so it is the surface most likely to be left in one language while
the UI around it is localized — and mixed-language help reads as broken software
rather than as a gap.

So decide the policy explicitly, and make the *code* express it:

- **Either fully translated or explicitly English-only**, never partial. If a
  locale's help is incomplete, fall back to the source language **as a whole**
  and say so in the UI ("Help is currently available in English only") rather
  than showing half-translated sections.
- **Budget for it as content, not strings.** UI labels are a few words each and
  the type-checked dictionary (`translation.md` §2.1) forces them to exist. Help is paragraphs;
  the same forcing function would make every feature block on six translations,
  so it usually lives outside the dictionary — which is exactly why it silently
  stays English. Decide who writes it and when.
- **Keep it structured, not marked up** (§6.4), so translating is replacing
  strings rather than reproducing formatting per language.
- If help ships in one language first, **make that a stated decision with a
  trigger for revisiting** — "translated when we sell into a non-English
  market" — not an accident nobody owns.

## 6.3 Search closes a vocabulary gap

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

## 6.4 Plain strings, no markup

No markdown parser, no HTML in help content, no markup inside translated strings.
A structured shape — title, body, bullets, term/definition pairs — renders itself
from data.

This is not only simplicity: content that is never parsed as markup is content
that cannot carry an injection payload, so help stays out of the sanitization
surface entirely. If you want emphasis inside a sentence, that is a signal the
sentence should be two.

## 6.5 Help documents what is deployed

A section ships **with** its feature, never before. Help that describes what is
planned becomes a roadmap that lies, and it is read as a bug report by everyone
who goes looking for the control.

Make it a convention rather than a role: whoever ships a feature checks whether
the help sections it touches are still true. That is cheaper than an owner who
audits everything periodically, and it is the only version that stays current.

## 6.6 The nearest explanation wins

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

## 6.7 Mobile needs its own entry point

Whatever anchors help on desktop — a toolbar, a sidebar — may not exist on
mobile. Decide where it lives there (Pulse put it in the header beside comments
and notifications) and give it the same content, presented full-screen rather
than as a drawer (`mobile.md` §5.1: shared components, different shells).
