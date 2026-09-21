import { describe, expect, it } from "vitest";
import { BASELINE_CYCLES } from "@/domain/baselineCycles";
import { DEFAULT_STATUSES } from "@/domain/constants";
import { en } from "@/i18n/en";

/**
 * Every `i18nKey` Beats stamps resolves to a real string.
 *
 * A key with no string behind it renders as `seed.ac-snagging` on the board —
 * no error, no warning, and the typed dictionary cannot catch it because these
 * keys are built at runtime from data rather than written as literals. This is
 * `iconNames.test.ts`'s job, for the same class of failure.
 *
 * The other five locales need no check of their own: `Dict = typeof en` makes a
 * missing key in any of them a compile error already. English is the one that
 * can drift, because it is what the type is derived FROM.
 */
const keys = [
  ...BASELINE_CYCLES.flatMap((c) => [c.i18nKey, ...c.statuses.map((s) => s.i18nKey)]),
  ...DEFAULT_STATUSES.map((s) => s.i18nKey),
].filter((k): k is string => !!k);

describe("seeded translation keys", () => {
  it("scans a plausible number of them", () => {
    // The guard on the guard: a stamping change that silently stopped setting
    // keys would leave the assertion below passing over an empty list.
    expect(keys.length).toBeGreaterThan(40);
  });

  it("all resolve in English", () => {
    const missing = [...new Set(keys)].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("matches the stored English label exactly", () => {
    // The fallback is the stored label, so if the two disagree a reader sees
    // one word and the same reader offline sees another.
    const dict = en as Record<string, string>;
    const mismatched = BASELINE_CYCLES.flatMap((c) => [
      ...(c.i18nKey && dict[c.i18nKey] !== c.name ? [`${c.i18nKey}: ${dict[c.i18nKey]} != ${c.name}`] : []),
      ...c.statuses.flatMap((s) =>
        s.i18nKey && dict[s.i18nKey] !== s.label ? [`${s.i18nKey}: ${dict[s.i18nKey]} != ${s.label}`] : []),
    ]);
    expect(mismatched).toEqual([]);
  });

  it("stamps every cycle and every stage", () => {
    // A template added without keys is shipped untranslatable, and nothing else
    // would notice: it renders its English label perfectly.
    for (const c of BASELINE_CYCLES) {
      expect(c.i18nKey, `cycle ${c.id}`).toBeTruthy();
      for (const s of c.statuses) expect(s.i18nKey, `${c.id}/${s.id}`).toBeTruthy();
    }
  });
});
