import { defineConfig } from "vitest/config";

// Separate config for security-rules tests: these run against the Firestore
// emulator (node environment, no jsdom) and are excluded from `npm test`
// because they require `firebase emulators:exec` to be the outer process.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["rules/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
