import type { Dict } from "./en";
import { en } from "./en";
import type { Lang } from "./langs";

// Only English ships in the initial bundle — it's the default AND the fallback
// for any missing key. The other five dictionaries are dynamically imported the
// first time their language becomes active, so a user downloads just the
// language they use instead of all six (~23 KB gzip off the initial load). Until
// an async dict resolves, translate() falls back to English — at most a brief
// flash, and only on a non-English user's very first load.
const loaders: Record<Exclude<Lang, "en">, () => Promise<Dict>> = {
  es: () => import("./es").then((m) => m.es),
  pt: () => import("./pt").then((m) => m.pt),
  fr: () => import("./fr").then((m) => m.fr),
  it: () => import("./it").then((m) => m.it),
  de: () => import("./de").then((m) => m.de),
};

const cache: Partial<Record<Lang, Dict>> = { en };

/** The loaded dictionary for `lang`, or English until its async load resolves. */
export function dictFor(lang: Lang): Dict {
  return cache[lang] ?? en;
}

/** Ensure `lang`'s dictionary is loaded (idempotent; immediate for English or an
 * already-cached language). Resolves once the dictionary is available. */
export function ensureDict(lang: Lang): Promise<void> {
  if (lang === "en" || cache[lang]) return Promise.resolve();
  return loaders[lang]().then((d) => {
    cache[lang] = d;
  });
}
