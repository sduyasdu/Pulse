import type { TranslationKey } from "@/i18n";

/** Anything carrying a name Beats may have supplied — a `Cycle` or a
 * `StatusDef`. Structural rather than a union, so a caller can pass a row it
 * built itself without first widening it. */
export interface Nameable {
  label?: string;
  name?: string;
  i18nKey?: string;
}

type Translate = (key: TranslationKey) => string;

/**
 * The name to show for a cycle or stage (Seed-Cycle-Translation SCT7).
 *
 * The rule is **provenance, not content**: a string is translated because Beats
 * wrote it and said so with an `i18nKey`, never because it happens to match a
 * phrase Beats recognises. A customer who names their own stage "Discovery" in
 * an English-speaking org keeps that word when a Spanish colleague opens the
 * Beat — and a template whose label they have since edited does too, because
 * editing clears the key (SCT4).
 *
 * That is also why one cycle can be half translated: the keys live per stage,
 * so a seeded template with two renamed stages shows five translated names and
 * two verbatim ones. Mixed is the correct answer, not a state to smooth over.
 *
 * Falling back to the stored label is load-bearing, not defensive tidiness: it
 * is what shows a stage seeded by a **newer** version of Beats than the
 * reader's cached bundle has strings for. Without it, a template added today
 * renders as `seed.xx-yyy` to anyone whose tab has been open since yesterday.
 */
export function labelOf(item: Nameable, t: Translate): string {
  const stored = item.label ?? item.name ?? "";
  if (!item.i18nKey) return stored;
  const translated = t(item.i18nKey as TranslationKey);
  // `t` returns the key itself when it has no string for it.
  return translated && translated !== item.i18nKey ? translated : stored;
}

/**
 * A status list with every seeded label resolved for display.
 *
 * **Render-only. Never write this back.** Saving a translated list would store
 * Spanish text under an English key: the key would still win for every reader,
 * so nothing would look wrong — until the key was retired, and the fallback
 * turned out to be one arbitrary reader's language. Editing paths keep the raw
 * list; `CycleEditorDialog` displays through `labelOf` and clears the key when
 * a label is actually typed over (SCT4).
 *
 * Cheap enough to call per render: a cycle has at most six stages.
 */
export function translateStatuses<T extends Nameable>(list: T[], t: Translate): T[] {
  return list.map((s) => (s.i18nKey ? { ...s, label: labelOf(s, t) } : s));
}

/** As above, for cycles — whose display name lives on `name`. */
export function translateCycles<T extends Nameable>(list: T[], t: Translate): T[] {
  return list.map((c) => (c.i18nKey ? { ...c, name: labelOf(c, t) } : c));
}
