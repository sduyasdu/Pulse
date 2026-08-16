// Help content loader — Help-Spec.md §4.
//
// Dynamically imported so the prose is a chunk that only downloads when someone
// actually opens the panel, rather than riding along in the always-loaded i18n
// bundle.
//
// All six supported languages now have their own help, so `hasLocalizedHelp` is
// true everywhere and the "English only" notice no longer appears (HL2 resolved,
// 2026-08). Adding a locale is still one module plus one line here — the drawer,
// the search and this loader don't change.
//
// Each locale is its own chunk, so a reader downloads the prose for their
// language and no other.
import type { HelpDoc, HelpSection } from "./types";

const LOADERS: Record<string, () => Promise<{ help: HelpDoc }>> = {
  en: () => import("./en"),
  es: () => import("./es"),
  pt: () => import("./pt"),
  fr: () => import("./fr"),
  it: () => import("./it"),
  de: () => import("./de"),
};

/** Languages with their own help content. Anything else is served English, and the
 * panel says so in the reader's language (§4). */
export function hasLocalizedHelp(lang: string): boolean {
  return lang in LOADERS;
}

export async function loadHelp(lang: string): Promise<HelpDoc> {
  const load = LOADERS[lang] ?? LOADERS.en;
  return (await load()).help;
}

/**
 * Fold a string for comparison: strip accents and case so a reader typing
 * "periodo" finds "período" and "grosse" finds "Größe" (HL12). One helper, used
 * on both sides of every comparison — normalizing at call sites is how half of a
 * search ends up accent-sensitive.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    // ß has no combining mark to strip and doesn't lowercase to "ss", so a German
    // reader typing "grosse" would never find "Größe" without this.
    .replace(/ß/g, "ss")
    .toLocaleLowerCase();
}

/** Every term must appear somewhere in the section — title, body, bullets or
 * keywords. Substring, not fuzzy: near-misses confuse more than they help. */
export function sectionMatches(section: HelpSection, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(
    [
      section.title,
      section.body,
      ...(section.bullets ?? []).flatMap((b) => [b.term, b.text]),
      ...(section.keywords ?? []),
    ].join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

/**
 * Split text into alternating non-match / match runs so the component can wrap
 * matches without the content carrying any markup (HL10). Accent-folded, so the
 * highlight lands on "período" when the query was "periodo" — hence working on
 * indices into the original string rather than on the folded copy.
 */
export function highlightRuns(text: string, query: string): { text: string; hit: boolean }[] {
  const terms = Array.from(new Set(fold(query).split(/\s+/).filter(Boolean)));
  if (terms.length === 0) return [{ text, hit: false }];

  const folded = fold(text);
  // fold() can change length (a decomposed accent's mark is dropped), which would
  // desync indices. When it does, skip highlighting rather than mark the wrong span.
  if (folded.length !== text.length) return [{ text, hit: false }];

  const hits: boolean[] = new Array(text.length).fill(false);
  terms.forEach((term) => {
    let from = folded.indexOf(term);
    while (from !== -1) {
      for (let i = from; i < from + term.length; i++) hits[i] = true;
      from = folded.indexOf(term, from + term.length);
    }
  });

  const runs: { text: string; hit: boolean }[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || hits[i] !== hits[start]) {
      runs.push({ text: text.slice(start, i), hit: hits[start] });
      start = i;
    }
  }
  return runs;
}

export type { HelpDoc, HelpSection } from "./types";
