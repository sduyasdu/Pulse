import { describe, expect, it } from "vitest";
import { labelOf } from "./seedLabels";
import type { TranslationKey } from "@/i18n";

/** Stands in for the real `t`: returns the key when it has no string, which is
 * what the app's translator does. */
const es = (k: TranslationKey) => (({ "seed.pdd-discovery": "Descubrimiento" }) as Record<string, string>)[k] ?? k;

describe("a name Beats supplied", () => {
  it("is shown in the reader's language", () => {
    expect(labelOf({ label: "Discovery", i18nKey: "seed.pdd-discovery" }, es)).toBe("Descubrimiento");
  });

  it("falls back to the stored English when the bundle has no string", () => {
    // A template seeded by a newer Beats than this reader's cached bundle.
    // Without the fallback it renders as "seed.xx-new" on screen.
    expect(labelOf({ label: "Snagging", i18nKey: "seed.xx-new" }, es)).toBe("Snagging");
  });

  it("works for a cycle, which carries `name` rather than `label`", () => {
    expect(labelOf({ name: "Discovery", i18nKey: "seed.pdd-discovery" }, es)).toBe("Descubrimiento");
  });
});

describe("a name the customer wrote", () => {
  it("is shown exactly as stored, to every reader", () => {
    // SCT1. Their organisation has standardised on one language; showing a
    // Spanish colleague a different word would be inventing a term nobody
    // agreed.
    expect(labelOf({ label: "Revisión legal" }, es)).toBe("Revisión legal");
  });

  it("is not translated just because it matches a phrase Beats knows", () => {
    // The reason the rule is provenance and not content. A customer naming
    // their own stage "Discovery" keeps that word.
    expect(labelOf({ label: "Discovery" }, es)).toBe("Discovery");
  });

  it("is shown verbatim once a seeded label has been edited", () => {
    // SCT4: editing clears the key, so this is the shape that reaches us.
    expect(labelOf({ label: "Descubrimiento del cliente" }, es)).toBe("Descubrimiento del cliente");
  });
});

describe("the awkward shapes", () => {
  it("returns an empty string rather than undefined for a nameless row", () => {
    expect(labelOf({}, es)).toBe("");
  });

  it("prefers `label` when a row somehow carries both", () => {
    expect(labelOf({ label: "L", name: "N" }, es)).toBe("L");
  });

  it("falls back rather than showing an empty translation", () => {
    const blank = () => "";
    expect(labelOf({ label: "Snagging", i18nKey: "seed.ac-snagging" }, blank)).toBe("Snagging");
  });
});
