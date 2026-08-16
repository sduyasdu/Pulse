# Translation — from the first string


Retrofitting i18n means touching every component you have already written. Doing
it on day one costs almost nothing. The decision is not *whether* you will
translate — it is whether the seam exists.

## 2.1 Make the dictionary a type, so a missing key is a build error

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

## 2.2 Load languages lazily

Bundle only the default language; dynamic-import the rest on first use. Six
dictionaries is a meaningful chunk of an initial payload for text most users
never see. Fall back to the default until the async dictionary resolves.

## 2.3 The hook must be reactive, and it must be a dependency

```ts
const t = useT();                    // re-renders on language change
useMemo(() => …t("x")…, [deps, t]);  // ← `t` in the deps, or labels go stale
```

Memoized values that call `t` and omit it from the dependency array keep the old
language until something unrelated invalidates them.

## 2.4 Watch for the shadow

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

## 2.5 What does *not* get translated

Decide once and write it down: product names, brand terms, and domain nouns you
have chosen to keep in one language. In Pulse: *Pulse, Epic, Kanban, AI* stay as
they are in all six languages. Also **legal entity names in copyright notices** —
a registered company name is a proper noun, and a notice that reads differently
per language is six different notices.

## 2.6 Formatting is not string substitution

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

## 2.7 Untranslated surfaces rot quietly

A component that was never wired to i18n stays invisible until someone reads it
in another language. Grep for user-visible literals periodically —
`placeholder=`, `title=`, `aria-label=`, and bare JSX text — and treat each one
as a bug rather than a style issue.
