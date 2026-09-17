import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS } from "@/components/shared/icons";

/**
 * Every `<Icon name="…">` in the app names a glyph that exists.
 *
 * `Icon` returns `null` for a name `ICONS` does not have: a button with no
 * content, no width and nothing to click. No error, no warning, no failed
 * build, and `IconName` is `keyof Record<string, string>` — that is, `string` —
 * so the compiler does not catch it either.
 *
 * CLAUDE.md records this biting three times (`help`, `link_off`,
 * `expand_content`). This is the test that would have caught all three.
 *
 * Only string literals can be checked; `name={someVariable}` is invisible here.
 * That is a real gap, not a solved problem — but the literals are the large
 * majority and the three past bugs were all literals.
 *
 * Lives in `build/` with the other whole-source sweeps (`productNaming`,
 * `brandAssets`) rather than beside `icons.ts`: `src` is type-checked with no
 * node types, so a test there cannot read the tree it needs to scan.
 */
const SRC = join(import.meta.dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const uses = sourceFiles(SRC).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/g)].map((m) => ({
    file: file.slice(SRC.length + 1),
    name: m[1],
  }));
});

describe("every Icon name resolves to a glyph", () => {
  it("scans a plausible number of usages", () => {
    // The guard on the guard. A regex that matched nothing would make the test
    // below pass vacuously, which is how a sweep quietly stops sweeping.
    expect(uses.length).toBeGreaterThan(80);
    expect(new Set(uses.map((u) => u.file)).size).toBeGreaterThan(20);
  });

  it("has no name missing from ICONS", () => {
    const missing = uses.filter((u) => !(u.name in ICONS));
    // Named, not counted: the failure must say which glyph and where.
    expect(missing.map((u) => `${u.file}: ${u.name}`)).toEqual([]);
  });
});
