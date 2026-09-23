import type { TestUserConfig } from "vitest/config";

/**
 * The test settings every project in a workspace shares: where tests live, and v8 coverage with
 * per-file thresholds over `src`. A workspace root passes them to `defineConfig({ test })`.
 */
export const testDefaults: TestUserConfig = {
  // Transform shared packages so framework mocks also work against installed tarballs.
  server: { deps: { inline: [/[/\\]@littleorgans[/\\]/] } },
  include: [
    "tests/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    "src/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  ],
  coverage: {
    provider: "v8",
    include: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    exclude: ["**/*.gen.*", "**/*.{test,spec}.*"],
    reporter: ["text", "json-summary", "html"],
    thresholds: {
      perFile: true,
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
};
