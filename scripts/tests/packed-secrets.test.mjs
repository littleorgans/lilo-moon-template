import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { publishedPackages } from "../lib/published-packages.mjs";

const script = resolve("scripts/check-packed-secrets.mjs");

// Until task 1.8 publishes the scanned archives, Changesets packs a second time. These hooks
// could change package contents between the scan and upload, so adding one requires that redesign.
await test("published packages have no lifecycle scripts that can change the scanned contents", () => {
  const packages = publishedPackages();
  assert.ok(packages.length > 0, "no published packages found");
  const hooks = ["prepack", "prepare", "prepublishOnly", "postpack"];
  const violations = packages.flatMap(({ directory, manifest }) =>
    hooks
      .filter((hook) => Object.hasOwn(manifest.scripts ?? {}, hook))
      .map((hook) => `${directory}/package.json: ${hook}`),
  );
  assert.deepEqual(
    violations,
    [],
    "publish the scanned archives (task 1.8) before adding packaging lifecycle scripts",
  );
});

// A published package whose dist carries `content`. dist is ignored by root:secrets, so only the
// packed scan can see it.
function packageFixture(t, content) {
  const root = mkdtempSync(join(tmpdir(), "packed-secrets-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(".secretlintrc.json", join(root, ".secretlintrc.json"));
  mkdirSync(join(root, "packages/fixture/dist"), { recursive: true });
  writeFileSync(
    join(root, "packages/fixture/package.json"),
    '{"name":"fixture","version":"0.0.0","files":["dist/index.js","dist/.gitignore"]}\n',
  );
  writeFileSync(join(root, "packages/fixture/dist/index.js"), content);
  return root;
}

function scan(root, env = {}) {
  const temporary = join(root, "tmp");
  mkdirSync(temporary, { recursive: true });
  const result = spawnSync("node", [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, ...env },
  });
  assert.deepEqual(
    readdirSync(temporary).filter((name) => name.startsWith("packed-secrets-")),
    [],
    "the scan must remove its temporary workspace on success and failure",
  );
  return result;
}

await test("the packed scan passes a clean tarball and fails one whose dist holds a token", (t) => {
  const clean = scan(packageFixture(t, "export const value = 1;\n"));
  assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);

  // Assembled at runtime so this file holds no token for root:secrets to report.
  const token = ["npm", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c"].join("_");
  const root = packageFixture(t, `export const token = "${token}";\n`);
  // Neither the caller's ignore files nor an ignore file shipped in dist may hide the token.
  writeFileSync(join(root, ".secretlintignore"), "**/*\n");
  writeFileSync(join(root, ".gitignore"), "**/dist/**\n");
  writeFileSync(join(root, "packages/fixture/dist/.gitignore"), "*.js\n");
  const leaked = scan(root);
  assert.equal(leaked.status, 1, `${leaked.stdout}${leaked.stderr}`);
  assert.match(leaked.stdout, /NPM_ACCESS_TOKEN/);
  assert.match(leaked.stdout, /package\/dist\/index\.js/);
  assert.doesNotMatch(leaked.stdout, new RegExp(token), "secretlint must mask the value");
});

await test("a failed pack blocks the gate, suppresses subprocess output and cleans up", (t) => {
  const root = packageFixture(t, "export const value = 1;\n");
  const token = ["npm", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c"].join("_");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env node\nconsole.error(${JSON.stringify(token)}); process.exit(23);`,
  );
  chmodSync(join(bin, "pnpm"), 0o755);
  const failed = scan(root, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /pack failed/);
  assert.ok(!`${failed.stdout}${failed.stderr}`.includes(token), "pack output must be suppressed");
});

await test("no publishable packages fails closed", (t) => {
  const root = packageFixture(t, "export const value = 1;\n");
  rmSync(join(root, "packages"), { recursive: true });
  const failed = scan(root);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /no published packages/);
});
