import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { postgresIdentity } from "../lib/postgres-container.mjs";

await test(
  "template reference enforces drift in the producer and allows example removal in a consumer",
  { skip: !existsSync(".moon/template-reference.json") },
  () => {
    const root = mkdtempSync(join(tmpdir(), "baseline-template-test-"));
    try {
      for (const path of [
        ".moon/templates",
        ".moon/template-reference.json",
        "apps/web/src",
        "apps/web/tests",
        "scripts/template-drift.mjs",
      ]) {
        cpSync(path, join(root, path), { recursive: true });
      }
      const check = () =>
        spawnSync(process.execPath, ["scripts/template-drift.mjs"], {
          cwd: root,
          encoding: "utf8",
        });
      assert.equal(check().status, 0);
      writeFileSync(join(root, "apps/web/src/router.tsx"), "deliberate drift");
      assert.equal(check().status, 1);
      assert.match(check().stderr, /differs from/);
      rmSync(join(root, "apps/web"), { recursive: true });
      assert.equal(check().status, 1);
      rmSync(join(root, ".moon/template-reference.json"));
      assert.equal(check().status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

await test("Postgres names and default ports belong to the checkout", () => {
  const one = postgresIdentity("/one/project");
  const two = postgresIdentity("/two/project");
  assert.deepEqual(one, postgresIdentity("/one/project"));
  assert.notEqual(one.container, two.container);
  assert.notEqual(one.port, two.port);
  assert.match(one.container, /^baseline-postgres-[a-f0-9]{12}$/);
});
