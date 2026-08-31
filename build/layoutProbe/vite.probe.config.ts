import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * Build config for the layout probe only. Separate from the app's, so the probe
 * never reaches `dist/` and cannot be deployed by accident — and so it does not
 * carry the PWA plugin, whose service worker would cache the probe's own
 * output.
 */
const REPO = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  /**
   * The REPO root, not this directory — load-bearing, and getting it wrong
   * produced a probe that confidently measured nonsense.
   *
   * Tailwind v4 discovers the classes to generate by scanning from the project
   * root. Rooted at `build/layoutProbe`, it scanned only this folder, so every
   * utility used inside `src/components/**` was missing from the probe's CSS —
   * including `flex-col`. The toolbar's two rows then laid out as a ROW instead
   * of a column, and the probe reported ~1900px of "overflow" that was really
   * row 1 and row 2 sitting side by side. It looked like a genuine finding: it
   * scaled with the viewport, varied by language, and got worse with longer
   * names.
   */
  root: REPO,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    // Array form, because order matters: the firebase stub has to win before
    // the general "@" prefix rule can resolve it to the real module.
    alias: [
      { find: /^@\/lib\/firebase$/, replacement: path.resolve(import.meta.dirname, "firebaseStub.ts") },
      // Anchored at both ends: Vite replaces only the MATCHED substring, so an
      // unanchored pattern turns "./usePulseSummary" into "./<absolute path>".
      { find: /^.*\/usePulseSummary$/, replacement: path.resolve(import.meta.dirname, "summaryStub.ts") },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, "../../src") + "/" },
    ],
  },
  build: {
    outDir: path.join(REPO, ".probe-dist"),
    emptyOutDir: true,
    rollupOptions: { input: path.join(import.meta.dirname, "probe.html") },
  },
});
