import { create } from "zustand";
import type { Lang } from "@/i18n/langs";
import { clearStoredLang, detectBrowserLang, loadStoredLang, storeLang } from "@/i18n/detect";

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
}

// Resolution order at startup: localStorage override → browser detection →
// English. userDoc.language slots in between (override → userDoc → browser)
// once auth bootstrap calls syncFromUserDoc() — see authStore.
const stored = loadStoredLang();

export const useI18nStore = create<I18nState>((set, get) => ({
  lang: stored ?? detectBrowserLang(),
  overridden: stored != null,

  setLang: (lang) => {
    storeLang(lang);
    set({ lang, overridden: true });
  },

  setAuto: () => {
    clearStoredLang();
    set({ lang: detectBrowserLang(), overridden: false });
  },

  syncFromUserDoc: (lang) => {
    if (get().overridden) return; // a local override takes precedence
    if (lang) set({ lang, overridden: true });
  },
}));
