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
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    // Array form, because order matters: the firebase stub has to win before
    // the general "@" prefix rule can resolve it to the real module.
    alias: [
      { find: /^@\/lib\/firebase$/, replacement: path.resolve(import.meta.dirname, "firebaseStub.ts") },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, "../../src") + "/" },
    ],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../../.probe-dist"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(import.meta.dirname, "probe.html") },
  },
});
