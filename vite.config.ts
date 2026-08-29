/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";
import path from "node:path";
import { NAVIGATION_DENYLIST } from "./build/swRoutes.js"; // .js extension: this file is type-checked under nodenext resolution

/** Short SHA of the build's commit — what the About box reports (About-Spec §4,
 * AB7). package.json's version has sat at 0.0.0 forever, so the commit is the
 * only field that actually identifies a build in a repo that deploys from main
 * several times a day. Falls back for builds outside a git checkout. */
function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * Offline app shell.
     *
     * Firestore's `persistentLocalCache` already keeps the *data* on disk, but
     * nothing kept the *app*: reload with no connection and the browser could
     * not fetch index.html, so it showed its own "This site can't be reached"
     * and the cached data was never reached either. The cache was real and
     * unreachable, which is the worst of both.
     *
     * `selfDestroying` is the kill switch, and it is the reason this is worth
     * understanding before touching: a service worker that ships wrong stays
     * installed on every device that has it, and simply removing this plugin
     * does NOT uninstall it — those browsers keep serving the last build
     * forever. Setting `selfDestroying: true` and deploying builds a worker
     * whose only job is to unregister itself and drop its caches. That is the
     * retreat; deleting the plugin is not.
     */
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // Not an installable PWA — no manifest, no install prompt, no home-screen
      // identity. This is here for offline reads only, and a manifest would
      // promise an experience nobody has designed.
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        // Deploys land several times a day; stale precached chunks from builds
        // nobody is on are pure cost.
        cleanupOutdatedCaches: true,
        // Match the hosting config's stated intent ("a new deploy is picked up
        // immediately"): take over as soon as a new build is fetched rather
        // than waiting for every tab of the origin to close.
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "/index.html",
        // Same-origin paths that are NOT the SPA — Firebase Auth's handler
        // (sign-in breaks if it gets index.html) and the Cloud Functions behind
        // the hosting rewrites. Kept in build/swRoutes.ts next to its test,
        // because getting it wrong fails silently.
        navigateFallbackDenylist: NAVIGATION_DENYLIST,
      },
    }),
  ],
  define: {
    __APP_COMMIT__: JSON.stringify(gitShortSha()),
    // Build date, not the viewer's clock: the copyright year has to state when
    // the artefact was produced (AB8).
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Split the big, slow-changing vendor libs into their own chunks so they
    // download in parallel and stay cached across app deploys.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            // Firestore is the bulk of the Firebase SDK; keep it in its own
            // chunk so it downloads in parallel with (and caches independently
            // of) the smaller app/auth chunk.
            if (id.includes("@firebase/firestore") || id.includes("firebase/firestore")) return "firebase-firestore";
            if (id.includes("@firebase") || id.includes("/firebase/")) return "firebase";
            if (id.includes("react-router") || id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "react";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/rules/**"],
  },
});
