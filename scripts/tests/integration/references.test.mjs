import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { pruneReferences } from "../../lib/typescript-references.mjs";

await test("pruning removes deleted members from root and member references without changing compiler options", () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-refs-"));
  try {
    mkdirSync(join(root, "apps", "app"), { recursive: true });
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ references: [{ path: "apps/app" }, { path: "packages/deleted" }] }),
    );
    const app = join(root, "apps/app/tsconfig.json");
    writeFileSync(
      app,
      JSON.stringify({
        compilerOptions: { outDir: "../../.moon/cache/types/app" },
        references: [{ path: "../../packages/deleted" }],
      }),
    );
    pruneReferences(root);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")).references, [
      { path: "apps/app" },
    ]);
    assert.deepEqual(JSON.parse(readFileSync(app, "utf8")), {
      compilerOptions: { outDir: "../../.moon/cache/types/app" },
      references: [],
    });
    const before = readFileSync(app, "utf8");
    pruneReferences(root);
    assert.equal(readFileSync(app, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
