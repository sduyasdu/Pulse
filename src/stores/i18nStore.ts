import { create } from "zustand";
import type { Lang } from "@/i18n/langs";
import { clearStoredLang, detectBrowserLang, loadStoredLang, storeLang } from "@/i18n/detect";
import { ensureDict } from "@/i18n/dictionaries";

interface I18nState {
  /** The active language. Components subscribe to this so a change re-renders
   * the whole app live (no reload). */
  lang: Lang;
  /** True when `lang` is an explicit user override (localStorage or the user
   * doc), false when it's browser-detected. Drives the "Auto (browser)" state. */
  overridden: boolean;
  /** Set an explicit override: applies live + persists to localStorage. Syncing
   * it to the user doc (cross-device) is the caller's job, via
   * authStore.saveProfile({ language }). */
  setLang: (lang: Lang) => void;
  /** Clear the override and revert to browser detection. */
  setAuto: () => void;
  /** Adopt the language stored on the user doc once auth bootstrap resolves it.
   * A localStorage override always wins (resolution order), so this is a no-op
   * when one is present. */
  syncFromUserDoc: (lang: Lang | undefined | null) => void;
  /** Bumped when a lazily-loaded dictionary finishes loading, so `useT()`
   * re-renders once the active language's strings are actually available
   * (dictionaries other than English are dynamically imported — see i18n). */
  dictVersion: number;
}

// Resolution order at startup: localStorage override → browser detection →
// English. userDoc.language slots in between (override → userDoc → browser)
// once auth bootstrap calls syncFromUserDoc() — see authStore.
const stored = loadStoredLang();
const initialLang = stored ?? detectBrowserLang();

export const useI18nStore = create<I18nState>((set, get) => {
  // Apply a language and, if its dictionary isn't bundled (non-English), load it
  // and bump dictVersion so subscribers re-render with the real strings.
  const applyLang = (lang: Lang, overridden: boolean) => {
    set({ lang, overridden });
    void ensureDict(lang).then(() => set((s) => ({ dictVersion: s.dictVersion + 1 })));
  };
  // Kick off the initial language's dictionary load (no-op for English).
  void ensureDict(initialLang).then(() => set((s) => ({ dictVersion: s.dictVersion + 1 })));

  return {
    lang: initialLang,
    overridden: stored != null,
    dictVersion: 0,

    setLang: (lang) => {
      storeLang(lang);
      applyLang(lang, true);
    },

    setAuto: () => {
      clearStoredLang();
      applyLang(detectBrowserLang(), false);
    },

    syncFromUserDoc: (lang) => {
      if (get().overridden) return; // a local override takes precedence
      if (lang) applyLang(lang, true);
    },
  };
});
