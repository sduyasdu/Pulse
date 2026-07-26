import { DEFAULT_LANG, isLang, type Lang } from "./langs";

// The localStorage key holding the user's explicit override. Persisted here (in
// addition to the user doc) so the chosen language applies instantly on reload,
// before the user doc has loaded — avoiding a flash of the wrong language.
const STORAGE_KEY = "pulse.lang";

/** Map a browser locale (e.g. "es-AR", "pt-BR", "fr-CA") to a supported base
 * language, or null if none matches. */
export function baseLang(locale: string): Lang | null {
  const base = locale.toLowerCase().split("-")[0];
  return isLang(base) ? base : null;
}

/** The first browser-preferred locale that maps to a supported language, else
 * English. Reads `navigator.languages` (falling back to `navigator.language`). */
export function detectBrowserLang(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const locales = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const loc of locales) {
    const m = loc ? baseLang(loc) : null;
    if (m) return m;
  }
  return DEFAULT_LANG;
}

/** The persisted override, if any (and still a supported code). */
export function loadStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && isLang(v) ? v : null;
  } catch {
    return null; // storage unavailable (private mode) — fall back to detection
  }
}

export function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // storage unavailable — the override just won't persist locally
  }
}

export function clearStoredLang(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
