import { useMemo } from "react";
import { useI18nStore } from "@/stores/i18nStore";
import { translate, type TParams, type TranslationKey } from "./translate";

export type { Lang } from "./langs";
export { SUPPORTED_LANGS, LANG_ENDONYMS, DEFAULT_LANG } from "./langs";
export type { TranslationKey, TParams } from "./translate";

/** A bound translate function: `t("dashboard.newPulse")` or
 * `t("invite.inviteTo", { name })`. */
export type TFn = (key: TranslationKey, params?: TParams) => string;

/**
 * The hook components call to translate. Subscribes to the active language so
 * the component re-renders when it changes — the whole app updates live.
 */
export function useT(): TFn {
  const lang = useI18nStore((s) => s.lang);
  return useMemo<TFn>(() => (key, params) => translate(lang, key, params), [lang]);
}

/**
 * Imperative translate for non-React call sites (e.g. building a confirm-dialog
 * message inside an event handler). Reads the current language at call time.
 * Prefer `useT()` inside components so they re-render on language change.
 */
export function t(key: TranslationKey, params?: TParams): string {
  return translate(useI18nStore.getState().lang, key, params);
}
