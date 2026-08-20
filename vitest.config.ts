import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
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
