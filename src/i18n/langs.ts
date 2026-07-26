// Supported UI languages. English is the default and the fallback for any
// missing translation (see translate.ts).

export const SUPPORTED_LANGS = ["en", "es", "pt", "fr", "it", "de"] as const;

export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = "en";

/** Endonyms — each language named in its own language, for the picker. */
export const LANG_ENDONYMS: Record<Lang, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
  it: "Italiano",
  de: "Deutsch",
};

/** Type guard: is `v` one of the six supported codes? */
export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (SUPPORTED_LANGS as readonly string[]).includes(v);
}
