import { matchesGlob } from "node:path";

import { describe, expect, it } from "vitest";

import { testDefaults } from "../src/vitest.js";

// Vitest leaves node_modules to Node unless a pattern inlines it, and Node's loader ignores vi.mock.
// The pattern has to find the scope wherever the package manager put it, and nothing else.
function inlined(path: string): boolean {
  const patterns = testDefaults.server?.deps?.inline;
  if (!Array.isArray(patterns)) return false;
  return patterns.some((pattern) =>
    typeof pattern === "string" ? path.includes(pattern) : pattern.test(path),
  );
}

function excluded(path: string): boolean {
  return (testDefaults.coverage?.exclude ?? []).some((glob) => matchesGlob(path, glob));
}

describe("testDefaults", () => {
  it("inlines the scope from a pnpm store, a flat node_modules and a Windows path", () => {
    for (const path of [
      "/repo/node_modules/.pnpm/@littleorgans+auth@0.2.0/node_modules/@littleorgans/auth/dist/index.js",
      "/repo/node_modules/@littleorgans/auth-tanstack/dist/server.js",
      String.raw`C:\repo\node_modules\@littleorgans\db\dist\index.js`,
    ]) {
      expect(inlined(path), path).toBe(true);
    }
  });

  it("leaves other scopes and look-alike names to Node", () => {
    for (const path of [
      "/repo/node_modules/@tanstack/react-start/dist/esm/index.js",
      "/repo/node_modules/@littleorgans-fork/auth/dist/index.js",
      "/repo/node_modules/.pnpm/@littleorgans+auth@0.2.0/node_modules/jose/dist/index.js",
    ]) {
      expect(inlined(path), path).toBe(false);
    }
  });

  it("keeps a sibling whose name extends the project's out of its coverage", () => {
    expect(excluded(`${process.cwd()}-tools/src/postgres.ts`)).toBe(true);
    expect(excluded(`${process.cwd()}/src/vitest.ts`)).toBe(false);
  });
});
