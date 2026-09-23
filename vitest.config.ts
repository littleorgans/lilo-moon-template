import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
  },
});
