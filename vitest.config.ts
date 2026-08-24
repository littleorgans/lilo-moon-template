import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "src/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      // Generated code, and the one file whose contents cannot execute outside a running server.
      //
      // `routes/app.tsx` holds a `createServerFn` call, which is the client/server boundary the
      // TanStack Start plugin compiles against. Invoking it without a Start context throws "No
      // Start context found", so the only test that could cover it would assert that it fails for
      // a reason unrelated to what it does, and would keep passing if the body were replaced. This
      // record already names three gates that reported green while proving nothing, so a fourth
      // written on purpose is worse than an exclusion that says so out loud.
      //
      // The rule this buys: route files hold wiring and never logic. Everything `app.tsx`
      // references is tested where it is defined. Adding a file here needs the same argument.
      exclude: ["**/*.gen.*", "**/*.{test,spec}.*", "src/routes/app.tsx"],
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
