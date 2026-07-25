/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
