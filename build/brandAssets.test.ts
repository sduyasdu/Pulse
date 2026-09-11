import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every icon and preview image `index.html` names must be a real file in
 * `public/`.
 *
 * This fails in production in a way nothing else catches. A missing path does
 * not 404: it hits the SPA catch-all in `firebase.json`, gets `index.html` with
 * a 200, and the client fails to decode it as an image — so the browser falls
 * back to the parent domain's icon and a link preview silently loses its card.
 * Same shape as the `/__/auth/handler` hijack `swRoutes.test.ts` guards.
 */
const html = readFileSync("index.html", "utf8");

/** Strips the origin off absolute URLs; og:image cannot be relative. */
const refs = [...html.matchAll(/(?:href|content)="(?:https:\/\/beats\.yasdu\.com)?(\/[^"]+\.(?:ico|svg|png))"/g)].map(
  (m) => m[1],
);

describe("index.html's brand assets exist", () => {
  it("names some in the first place", () => {
    // Without this, a regex that stopped matching would make every case below
    // vacuously true — the failure mode this suite exists to avoid.
    expect(refs.length).toBeGreaterThanOrEqual(6);
  });

  it.each(refs)("%s is a real file with content", (ref) => {
    const path = `public${ref}`;
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });

  it("serves a decodable .ico, not HTML wearing the name", () => {
    // ICO files start with a 6-byte header: reserved 0, type 1 (icon).
    const head = readFileSync("public/favicon.ico").subarray(0, 4);
    expect([...head]).toEqual([0, 0, 1, 0]);
  });

  it("points og:image at an absolute URL", () => {
    const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(og).toMatch(/^https:\/\//);
  });

  it("declares the og:image dimensions that the file actually has", () => {
    // A PNG's IHDR carries width and height as big-endian u32 at bytes 16..24.
    const png = readFileSync("public/brand/beats-og-light.png");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(`${width}x${height}`).toBe("1200x630");
    expect(/<meta property="og:image:width" content="(\d+)"/.exec(html)?.[1]).toBe(String(width));
    expect(/<meta property="og:image:height" content="(\d+)"/.exec(html)?.[1]).toBe(String(height));
  });
});

/**
 * Which screens get the singular.
 *
 * Asserted against the source rather than by rendering seven routes, because
 * the claim being made is about call sites: exactly one, and a specific one.
 * A render test of the dashboard would pass just as happily if a *new* screen
 * started passing `word="Beat"` — and that new screen is the regression.
 */
describe("only the canvas toolbar is singular", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e): string[] =>
      e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith(".tsx") ? [`${dir}/${e.name}`] : [],
    );

  /** Every file that renders the lockup, excluding its own definition+test. */
  const callSites = files("src")
    .filter((f) => !f.includes("shared/Logo"))
    .map((f) => [f, readFileSync(f, "utf8")] as const)
    .filter(([, src]) => src.includes("<BeatsLockup"));

  it("finds the call sites at all", () => {
    // Guards the two assertions below: if the scan silently matched nothing,
    // "no unexpected singulars" would pass while proving nothing.
    expect(callSites.length).toBeGreaterThanOrEqual(7);
  });

  it("passes the singular in exactly one place, the toolbar", () => {
    const singular = callSites.filter(([, src]) => src.includes('word="Beat"')).map(([f]) => f);
    expect(singular).toEqual(["src/components/canvas/Toolbar.tsx"]);
  });

  it("leaves every other surface on the product name", () => {
    const explicitPlural = callSites.filter(([, src]) => src.includes('word="Beats"')).map(([f]) => f);
    // Plural is the default; spelling it out invites the two to drift apart.
    expect(explicitPlural).toEqual([]);
  });
});

/**
 * The dns-prefetch hint must name the same host as `VITE_FIREBASE_AUTH_DOMAIN`.
 *
 * index.html says so in a comment, and the comment is right: prefetching the
 * wrong host warms a connection nothing uses and leaves the real one cold on
 * the critical sign-in path. Nothing else notices — the app works either way,
 * slightly slower, which is why it drifted the moment the auth domain moved.
 *
 * `.env.local` is gitignored and machine-local, so this can only run where the
 * build actually happens. That is also the only place it matters.
 */
describe("the auth-origin prefetch tracks the auth domain", () => {
  const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : null;
  const configured = env ? /^VITE_FIREBASE_AUTH_DOMAIN="?([^"\n]+)"?/m.exec(env)?.[1] : undefined;

  it.skipIf(!configured)("prefetches exactly that host", () => {
    const prefetched = [...html.matchAll(/<link rel="dns-prefetch" href="https:\/\/([^"]+)"/g)].map((m) => m[1]);
    expect(prefetched).toContain(configured);
    // The old auth origin must not linger: it is a warmed connection to a host
    // sign-in no longer touches.
    expect(prefetched.filter((h) => h.endsWith(".yasdu.com"))).toEqual([configured]);
  });
});
