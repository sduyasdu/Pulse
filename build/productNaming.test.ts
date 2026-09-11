import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The product is "Beats"; one roadmap inside it is "a Beat".
 *
 * Before the rename both were the word "Pulse", so a global find-replace was
 * always going to produce "Connected to Beat." — grammatical, plausible, and
 * wrong in all six languages at once. Nothing else catches that: it compiles,
 * it renders, and only a reader notices. These cases hold the split open.
 *
 * The stored vocabulary is deliberately excluded. Firestore collections
 * (`pulses`, `pulseMembers`), the role value `myBeatViewer` and the activity
 * `targetType` "pulse" are data, not copy — renaming them is a migration, and
 * `firestore.rules` reads them by those exact names.
 */
const LOCALES = ["en", "es", "pt", "fr", "it", "de"] as const;

/** Key/value dictionary lines; values never span lines (asserted below). */
const ENTRY = /^\s*"([^"]+)":\s*"(.*)",?\s*$/;

function entries(locale: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(`src/i18n/${locale}.ts`, "utf8").split("\n")) {
    const m = ENTRY.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** Where "Pulse" meant the app itself, so the rename is "Beats", not "Beat". */
const PRODUCT_KEYS = [
  "net.connected",
  "net.unreachable",
  "help.open",
  "billing.hostedNote",
  "share.text",
  "about.title",
  "about.aYasduProduct",
  "mcp.listEmpty",
  "mcp.connectUrlHint",
  "mcp.title",
  "mcp.badRequestBody",
];

describe.each(LOCALES)("%s", (locale) => {
  const dict = entries(locale);

  it("parses a real dictionary", () => {
    // Without this, every case below passes vacuously on an empty Map — the
    // failure mode that makes a naming suite worthless.
    expect(dict.size).toBeGreaterThan(400);
  });

  it("has retired the old product name", () => {
    const left = [...dict].filter(([, v]) => /\bPulses?\b/.test(v)).map(([k]) => k);
    expect(left).toEqual([]);
  });

  it.each(PRODUCT_KEYS)("%s names the product, not one Beat", (key) => {
    const value = dict.get(key);
    expect(value, `${key} missing from ${locale}`).toBeDefined();
    expect(value).toMatch(/\bBeats\b/);
    // "a Beat" here would read as one roadmap — the exact bug this guards.
    expect(value).not.toMatch(/\bBeat\b(?!s)/);
  });

  it("still says 'My todo', which is not the entity", () => {
    // "My Beat" collided with the new entity name: it means "my tasks", not
    // "the Beat that is mine".
    expect(dict.get("toolbar.myTodo")).toBe("My todo");
    expect([...dict].filter(([, v]) => /\bMy Beat\b/.test(v))).toEqual([]);
  });
});

describe("the help content follows the same rule", () => {
  it.each(LOCALES)("%s has no Pulse left", (locale) => {
    const src = readFileSync(`src/help/${locale}.ts`, "utf8");
    expect(src.length).toBeGreaterThan(1000);
    expect(src).not.toMatch(/\bPulses?\b/);
  });
});

describe("the stored vocabulary is left alone", () => {
  it("keeps the role value the rules read", () => {
    // firestore.rules gates on this exact string; renaming it without a data
    // migration locks every scoped viewer out of their own Beat.
    expect(readFileSync("firestore.rules", "utf8")).toMatch(/myBeatViewer/);
    expect(readFileSync("src/domain/permissions.ts", "utf8")).toMatch(/myBeatViewer:/);
  });

  it("keeps the collections the rules read", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    expect(rules).toMatch(/match \/pulses\/\{pulseId\}/);
    expect(rules).toMatch(/match \/pulseMembers\/\{memberUid\}/);
  });
});
