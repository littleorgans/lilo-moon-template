import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/check-packed-secrets.mjs");

// A published package whose dist carries `content`. dist is ignored by root:secrets, so only the
// packed scan can see it.
function packageFixture(t, content) {
  const root = mkdtempSync(join(tmpdir(), "packed-secrets-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(".secretlintrc.json", join(root, ".secretlintrc.json"));
  mkdirSync(join(root, "packages/fixture/dist"), { recursive: true });
  writeFileSync(
    join(root, "packages/fixture/package.json"),
    '{"name":"fixture","version":"0.0.0","files":["dist"]}\n',
  );
  writeFileSync(join(root, "packages/fixture/dist/index.js"), content);
  return root;
}

await test("the packed scan passes a clean tarball and fails one whose dist holds a token", (t) => {
  const clean = spawnSync("node", [script], {
    cwd: packageFixture(t, "export const value = 1;\n"),
    encoding: "utf8",
  });
  assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);

  // Assembled at runtime so this file holds no token for root:secrets to report.
  const token = ["npm", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c"].join("_");
  const leaked = spawnSync("node", [script], {
    cwd: packageFixture(t, `export const token = "${token}";\n`),
    encoding: "utf8",
  });
  assert.equal(leaked.status, 1, `${leaked.stdout}${leaked.stderr}`);
  assert.match(leaked.stdout, /NPM_ACCESS_TOKEN/);
  assert.match(leaked.stdout, /package\/dist\/index\.js/);
  assert.doesNotMatch(leaked.stdout, new RegExp(token), "secretlint must mask the value");
});
