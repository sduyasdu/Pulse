# Seed Cycle Translation Spec

How the cycle templates Beats ships are shown in the reader's language, and why
the cycles a customer writes are not.

Companion to `Cycles-Spec.md` (CY1, CY11, CY12). Decisions are numbered `SCT1`
onwards and other specs should cite those codes rather than restating the
reasoning.

---

## 1. The problem

`BASELINE_CYCLES` (`src/domain/baselineCycles.ts`) is written into a workspace
document at seed time and then copied into Beats when chosen (CY1). Both writes
store **English strings**:

```
Product development (digital)
  Discovery → Design → Build → Test → On hold → Done
```

A Spanish-speaking owner signs up, the seeder runs on their first dashboard
load, and their organisation's templates are in English. Nothing in the app is
wrong — the UI chrome around them is translated perfectly — but the content the
product itself supplied is not.

This is not new with the seven domain templates. `Standard / Planned / In
progress / Blocked` has always shipped this way. Seven domain-specific
templates, in language a customer would never have chosen, make it obvious.

## 2. What is in scope, and what is deliberately not

**SCT1 — Only cycles Beats ships are translated. Cycles a customer creates or
edits are stored verbatim, in whatever language they typed.**

An organisation standardises on one working language. A team that renames
"Discovery" to "Descubrimiento" has made a decision, and a team that writes its
own "Revisión legal" has made a stronger one. Translating either would mean
deciding what a customer's own words mean in five other languages — which the
product cannot do, and which would produce a term the team never agreed.

So the boundary is **provenance**, not content: a stage is translatable because
Beats wrote it, not because it happens to match a phrase Beats knows.

*Rejected: translating by string match.* Looking up "Discovery" in a table and
substituting would catch a customer who independently names a stage "Discovery"
in an English-language org and silently rewrite it the moment a Spanish
colleague opens the Beat. It also breaks the instant anyone edits the template,
which is the ordinary case CY1 was designed around.

**SCT2 — Translation is a display concern. The stored string never changes.**

The seeded document keeps its English `label`. Nothing in Firestore is
rewritten when a reader's language differs, and no migration is needed when a
translation is corrected.

Three reasons, in order of how much they would hurt:

- **Copies are independent (CY1).** A Beat holds its own copy of a template. If
  translation were a write, the same template in twelve Beats would need twelve
  writes — and each is a separate document an editor may since have changed.
- **Two readers, one document.** A Spanish and a German colleague look at the
  same Beat. Whichever loaded last would win, and the other would watch their
  board relabel itself.
- **Reversibility.** A display mapping that turns out wrong is a code change. A
  write that turns out wrong is customer data.

## 3. How a seeded string is recognised

**SCT3 — A seeded stage keeps a stable `i18nKey`; the label beside it is the
English fallback.**

```ts
{ id: "pdd-discovery", label: "Discovery", i18nKey: "seed.pdd-discovery", … }
```

`i18nKey` is optional on `StatusDef` and `Cycle`. Present means Beats wrote
this string and may translate it; absent means a human did, and it is shown as
stored. That is the whole rule, and it survives the two events that break every
alternative: the org renaming the cycle, and `copyCycleTemplate` regenerating
the ids.

**SCT4 — Editing a seeded label clears its `i18nKey`.**

The moment someone types over "Discovery", their text is what the stage is
called — in every language. Keeping the key would mean their edit vanished for
a colleague reading in French, which is worse than not translating at all.

Cleared on the *label*, not the cycle: renaming a cycle does not un-translate
its stages, and renaming one stage does not affect its siblings.

*Rejected: a `custom: true` flag alongside the key.* Two fields that must agree
is one more thing to get wrong, and the key alone already answers the question.

**SCT5 — Ids stay opaque and are never the translation key.**

`copyCycleTemplate` regenerates stage ids on copy (CY1), so `st-1730-2` in one
Beat and `st-1994-2` in another are the same seeded stage. Keying off the id
would lose the translation on the first copy — which is to say, immediately.

## 4. Where the lookup lives

**SCT6 — Seed strings live in the existing locale files, under a `seed.`
prefix.**

`src/i18n/{en,es,pt,fr,it,de}.ts`, alongside every other string. They get the
property the typed dictionary already gives the rest: a missing key in any
locale is a compile error across all six, so a template cannot ship half
translated.

```ts
"seed.cy-pd-digital": "Product development (digital)",
"seed.pdd-discovery": "Discovery",
"seed.pdd-hold": "On hold",
```

*Rejected: a separate `seedStrings.ts` per locale.* It would be the only set of
strings in the app outside the typed dictionary, and the first place a missing
translation goes unnoticed.

**SCT7 — One resolver, used everywhere a seeded name is drawn.**

```ts
labelOf(s: { label: string; i18nKey?: string }, t: TFn): string
```

Returns `t(s.i18nKey)` when there is a key and the key resolves, otherwise
`s.label`. The fallback is not defensive decoration: it is what shows a stage
seeded by a *newer* version of Beats than the reader's cached bundle knows
about.

Call sites: the board's column headers, the status picker in the task detail
panel, the grouped status filter's headings and entries (`statusFilterOptions`),
the cycle editor, the mobile board's picker and its "move to" list, the CY15
chips, and `AddFromOrg`'s template list.

**SCT8 — The MCP server does not translate.**

`statusLabelsOf` (`functions/src/mcpServer.ts`) answers an assistant, which has
no locale and whose caller may be reading in any language. It keeps returning
the stored English. A stage a customer renamed is already returned verbatim, so
this also keeps one rule rather than two.

## 5. Consequences worth stating

**SCT9 — Two colleagues in one Beat see different words for the same stage.**

That is the point, and it is the same thing the rest of the UI already does.
Worth saying out loud because the board is a shared artefact people talk about:
"move it to Discovery" is ambiguous when one of them reads "Descubrimiento".
The mitigation is that colours and order are shared, and both are how a board is
actually read at a glance.

**SCT10 — Seeding stays English-only and does not consult the owner's locale.**

A tempting alternative is to write Spanish labels for a Spanish owner at seed
time. It is rejected for the same reason as SCT2: a workspace has many members,
the seeder runs for whoever opens the dashboard first, and their language would
be imposed on everyone else permanently. Storage is one language; display is
per-reader.

**SCT11 — The `seed.` keys are permanent, including for retired templates.**

Simple and Review have left `BASELINE_CYCLES` but exist in every org seeded
before that. Their keys stay in the locale files. Deleting a key because the
template is no longer offered would un-translate it for every org still using
it — the same mistake as SCT5, arriving by a different route.

## 6. Work

In dependency order. Each step is shippable on its own; nothing here changes
what is stored.

1. `i18nKey?: string` on `StatusDef` and `Cycle` (`src/types/index.ts`).
2. `seed.` keys for all eight templates and their stages, in six locales.
   Around 55 keys. English is the source of truth and matches the current
   `label` values exactly, so English readers see no change at all.
3. `BASELINE_CYCLES` stamps `i18nKey` on every cycle and stage.
4. `labelOf` in `src/domain/seedLabels.ts`, with tests: key present and
   resolving; key present and unknown (falls back); key absent; label edited.
5. `copyCycleTemplate` carries `i18nKey` through the copy — a Beat's copy of a
   seeded template is still a seeded template (CY5's Done already survives the
   copy; this is the same rule for the same reason).
6. The cycle editor clears `i18nKey` on label edit (SCT4).
7. The call sites in SCT7, one at a time.
8. A `build/` sweep asserting every `i18nKey` in `BASELINE_CYCLES` exists in
   `en` — the same shape as `build/iconNames.test.ts`, and for the same reason:
   a key that resolves to nothing renders as the raw key, with no error.

## 7. Resolved

**SCT12 — A cycle may be half translated, and that is the correct answer.**
Keys live per name, so a seeded template whose owner renamed two stages shows
the rest translated and those two verbatim, to every reader. Mixed is not a
state to smooth over: each name is shown according to who wrote it.

**SCT13 — The editor shows the reader's language; editing is adopting it.**
The field displays `labelOf(...)` while the dialog's state holds the stored
English. Typing therefore replaces the translation with the person's own words
and clears the key (SCT4). An untouched field never fires `onChange`, so
opening the dialog and pressing Save changes nothing — which is pinned, because
a render that wrote what it displayed would un-translate a Beat silently.

*Rejected: showing the stored English with the translation as a placeholder.*
It makes the one screen where a Spanish reader is doing work the only screen
that speaks English at them.

**SCT14 — Only a name edit clears a key.** Changing a stage's CY16
qualification sits in the same row and says nothing about what the stage is
called. Clearing the key there would un-translate a stage for an unrelated
reason, and the person who did it would have no way of knowing.

**SCT15 — `DEFAULT_STATUSES` carries keys, so Beats that predate cycles
translate too.** `cyclesOf` builds their implicit cycle out of that list (CY11).
With keys only on the seeded template, a legacy Beat would show "Planned" while
a new one showed "Planificado". A Beat that *stored* its own statuses gets no
keys and stays verbatim, which is right: that list has been through a
customer's hands.

**SCT16 — The construction glossary.** Supplied rather than machine-translated,
because these are terms of art:

| | es | fr | it | de | pt |
| --- | --- | --- | --- | --- | --- |
| Snagging | Terminaciones | Réserves | Eliminazione dei difetti | Mängelfeststellung | Apontamento de anomalias |
| Mobilisation | Movilización | Mobilisation du chantier | Cantierizzazione | Baustelleneinrichtung | Mobilização do canteiro |

Four were corrected for spelling and accents as supplied — `movilization` →
`Movilización`, `mobilization the chantier` → `Mobilisation du chantier`,
`mängelfestellung` → `Mängelfeststellung`, `mobilizacao do canteiro` →
`Mobilização do canteiro`. Flagged rather than applied silently: these ship
into customer data.

Architecture's design stages took the same treatment — "Developed design" and
"Technical design" are RIBA 3 and 4, and each language has its own established
pair (*Proyecto básico / Proyecto de ejecución*, *Avant-projet / Projet
d'exécution*, *Progetto definitivo / Progetto esecutivo*, *Entwurfsplanung /
Ausführungsplanung*, *Projeto base / Projeto de execução*) rather than a
literal rendering.

## 8. Still open

- **"Brief" is two different words.** It is a client's requirements document in
  architecture and a campaign brief in marketing, so they are separate keys and
  Spanish takes *Programa* for one and *Briefing* for the other. Worth a check
  by someone who works in each.

## Decisions

| | |
| --- | --- |
| SCT1 | Only Beats-supplied cycles are translated; customer-written ones are verbatim |
| SCT2 | Translation is display-only; the stored string never changes |
| SCT3 | A seeded string carries an `i18nKey`; its `label` is the English fallback |
| SCT4 | Editing a seeded label clears its key |
| SCT5 | Ids are opaque and are never the translation key |
| SCT6 | Seed strings live in the typed locale files under `seed.` |
| SCT7 | One resolver, `labelOf`, at every site that draws a seeded name |
| SCT8 | The MCP server returns stored English and does not translate |
| SCT9 | Colleagues in one Beat see different words; colour and order are shared |
| SCT10 | Seeding is English-only and ignores the owner's locale |
| SCT11 | `seed.` keys are permanent, including for retired templates |
| SCT12 | A cycle may be half translated; each name follows who wrote it |
| SCT13 | The editor shows the reader's language; editing adopts it |
| SCT14 | Only a name edit clears a key, never a qualification change |
| SCT15 | `DEFAULT_STATUSES` carries keys, so pre-cycles Beats translate too |
| SCT16 | The construction and RIBA glossaries, supplied not machine-translated |
