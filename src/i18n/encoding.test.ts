import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import { fr } from "./fr";
import { it as itDict } from "./it";
import { de } from "./de";

/**
 * UTF-8 read back as Latin-1 — "hinzufügen" becomes "hinzufÃ¼gen", "—" becomes
 * "â" plus two invisible control characters. It shipped across the People
 * strings in five languages with nothing failing: the files still parse, the
 * keys still match `Dict`, and English, the only language anyone checked, has
 * no accents to garble.
 *
 * The pattern is a lead byte's Latin-1 reading followed by a continuation byte's.
 * Real text does not produce it — "TÂCHE" and "DÉTAILS" pass, because what
 * follows the capital is an ordinary letter.
 */
const MOJIBAKE = /[ÂÃ][\u0080-¿]|â[\u0080-\u009F]/;

describe("locale encoding", () => {
  for (const [lang, dict] of Object.entries({ en, es, pt, fr, it: itDict, de })) {
    it(`${lang} has no double-encoded strings`, () => {
      const bad = Object.entries(dict).filter(([, v]) => MOJIBAKE.test(v)).map(([k]) => k);
      expect(bad).toEqual([]);
    });
  }

  it("the pattern catches what actually shipped, and spares real text", () => {
    expect(MOJIBAKE.test("Person hinzufÃ¼gen")).toBe(true);
    expect(MOJIBAKE.test("Ne plus proposer Â« {role} Â»")).toBe(true);
    expect(MOJIBAKE.test("Noch keine Rollen â\u0080\u0094 füge")).toBe(true);
    expect(MOJIBAKE.test("DÉTAILS DE LA TÂCHE")).toBe(false);
    expect(MOJIBAKE.test("Ne plus proposer « {role} »")).toBe(false);
  });
});
