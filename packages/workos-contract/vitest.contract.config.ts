import { defineConfig } from "vitest/config";

// The contract suite only. The workspace config's include covers tests/ and src/, so `moon ci`,
// which runs the inherited test tasks, never reaches contract/.
export default defineConfig({
  test: {
    include: ["contract/**/*.contract.test.ts"],
    globalSetup: ["contract/global-setup.ts"],
    // Every call crosses the network, and one test waits out the refresh reuse the code needs.
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
