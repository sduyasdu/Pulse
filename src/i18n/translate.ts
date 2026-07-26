import type { Dict } from "./en";
import { en } from "./en";
import { dictionaries } from "./dictionaries";
import type { Lang } from "./langs";

/** A translation key — every key that exists in the English source dictionary. */
export type TranslationKey = keyof Dict;

/** Interpolation values for `{placeholder}` tokens in a string. */
export type TParams = Record<string, string | number>;

/** Fill `{name}` tokens from `params`; unknown tokens are left as-is. */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Translate `key` into `lang`, filling any `{param}` placeholders. English is
 * the source-of-truth fallback: an unknown language or a key missing from a
 * non-English dictionary falls back to the English string (which always exists,
 * enforced by the `Dict`-typed dictionaries).
 */
export function translate(lang: Lang, key: TranslationKey, params?: TParams): string {
  const dict = dictionaries[lang] ?? en;
  const template = dict[key] ?? en[key];
  return interpolate(template, params);
}
