/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import path from "node:path";

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
  plugins: [react(), tailwindcss()],
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
