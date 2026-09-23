import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  changelogEntry,
  integrityOf,
  publishOrder,
  readReleaseTarballs,
} from "../lib/release-tarballs.mjs";

const release = resolve("scripts/release.mjs");

// A workspace of three published packages, where app depends on core and core peers on base, and a
// private package that must never be packed.
function workspace(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "release-fixture-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const member = (name, manifest) => {
    const directory = join(root, "packages", name);
    mkdirSync(join(directory, "dist"), { recursive: true });
    writeFileSync(join(directory, "dist/index.js"), `export const name = "${name}";\n`);
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({ name: `@fixture/${name}`, version: "0.1.0", files: ["dist"], ...manifest })}\n`,
    );
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      `# @fixture/${name}\n\n## 0.1.0\n\n### Minor Changes\n\n- ${name} notes\n\n## 0.0.1\n\n- older\n`,
    );
  };
  member("app", { dependencies: { "@fixture/core": "0.1.0" } });
  member("core", { peerDependencies: { "@fixture/base": "^0.1.0" } });
  member("base", {});
  member("private", { private: true });
  return root;
}

function node(root, args, env = {}) {
  return spawnSync(process.execPath, [release, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function packed(t) {
  const root = workspace(t);
  const result = node(root, ["pack", "release"]);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return { root, directory: join(root, "release") };
}

await test("pack records every published package once, and nothing private", (t) => {
  const { directory } = packed(t);
  const tarballs = readReleaseTarballs(directory);
  assert.deepEqual(
    tarballs.map(({ name, version }) => `${name}@${version}`),
    ["@fixture/app@0.1.0", "@fixture/base@0.1.0", "@fixture/core@0.1.0"],
  );
  for (const { file, integrity } of tarballs) assert.equal(integrityOf(file), integrity);
});

await test("pack refuses a directory that already holds files", (t) => {
  const { root } = packed(t);
  const again = node(root, ["pack", "release"]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /is not empty/);
});

await test("a tarball changed, added or removed after packing is refused", (t) => {
  const { directory } = packed(t);
  const [first] = readReleaseTarballs(directory);
  appendFileSync(first.file, "\0");
  assert.throws(() => readReleaseTarballs(directory), /changed after it was packed and scanned/);

  const other = packed(t).directory;
  writeFileSync(join(other, "extra.tgz"), "");
  assert.throws(() => readReleaseTarballs(other), /holds .*extra\.tgz.*but release\.json records/);
  rmSync(join(other, "extra.tgz"));
  rmSync(readReleaseTarballs(other)[0].file);
  assert.throws(() => readReleaseTarballs(other), /but release\.json records/);
});

await test("publish order puts dependencies and peers before their dependents", (t) => {
  const { directory } = packed(t);
  assert.deepEqual(
    publishOrder(readReleaseTarballs(directory)).map(({ name }) => name),
    ["@fixture/base", "@fixture/core", "@fixture/app"],
  );
});

await test("publish order rejects a dependency cycle", (t) => {
  const root = workspace(t);
  const base = join(root, "packages/base/package.json");
  const manifest = JSON.parse(readFileSync(base, "utf8"));
  writeFileSync(base, JSON.stringify({ ...manifest, dependencies: { "@fixture/app": "0.1.0" } }));
  assert.equal(node(root, ["pack", "release"]).status, 0);
  assert.throws(
    () => publishOrder(readReleaseTarballs(join(root, "release"))),
    /dependency cycle @fixture\/app -> @fixture\/core -> @fixture\/base -> @fixture\/app/,
  );
});

await test("a changelog entry runs from its version heading to the next one", () => {
  const changelog = "# pkg\n\n## 0.2.0\n\n### Minor Changes\n\n- two\n\n## 0.1.0\n\n- one\n";
  assert.equal(changelogEntry(changelog, "0.2.0"), "### Minor Changes\n\n- two");
  assert.equal(changelogEntry(changelog, "0.1.0"), "- one");
  assert.equal(changelogEntry(changelog, "0.3.0"), undefined);
});

// An npm that answers `view` from a JSON map of spec to integrity, 404s anything else, and records
// every publish. FAKE_NPM_VIEW_ERROR makes `view` fail the way an unreachable registry does.
function fakeNpm(root, registry) {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "registry.json"), JSON.stringify(registry));
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const [command, spec] = process.argv.slice(2);
const registry = JSON.parse(readFileSync(${JSON.stringify(join(root, "registry.json"))}, "utf8"));
if (command === "view") {
  if (process.env.FAKE_NPM_VIEW_ERROR) {
    console.log(JSON.stringify({ error: { code: "ECONNREFUSED" } }));
    console.error("npm error code ECONNREFUSED");
    process.exit(1);
  }
  if (spec in registry) { console.log(JSON.stringify(registry[spec])); process.exit(0); }
  console.log(JSON.stringify({ error: { code: "E404" } }));
  process.exit(1);
}
if (command === "publish") {
  appendFileSync(${JSON.stringify(join(root, "published.log"))}, process.argv.slice(3).join(" ") + "\\n");
  process.exit(process.env.FAKE_NPM_PUBLISH_STATUS ? Number(process.env.FAKE_NPM_PUBLISH_STATUS) : 0);
}
process.exit(64);
`,
  );
  chmodSync(join(bin, "npm"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

const published = (root) =>
  existsSync(join(root, "published.log"))
    ? readFileSync(join(root, "published.log"), "utf8").trim().split("\n")
    : [];

await test("publish uploads in order, skips versions already up and prints New tag lines", (t) => {
  const { root, directory } = packed(t);
  const tarballs = publishOrder(readReleaseTarballs(directory));
  const [base] = tarballs;
  const env = fakeNpm(root, { [`${base.name}@${base.version}`]: base.integrity });
  const result = node(root, ["publish", "release"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /@fixture\/base@0\.1\.0 is already published with these bytes/);
  assert.deepEqual(
    result.stdout.split("\n").filter((line) => line.startsWith("New tag:")),
    ["New tag: @fixture/core@0.1.0", "New tag: @fixture/app@0.1.0"],
  );
  assert.deepEqual(
    published(root),
    tarballs.slice(1).map(({ file }) => `${file} --access public --ignore-scripts`),
  );
});

await test("publish refuses a version the registry holds with other bytes", (t) => {
  const { root } = packed(t);
  const env = fakeNpm(root, { "@fixture/base@0.1.0": "sha512-other" });
  const result = node(root, ["publish", "release"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /registry holds @fixture\/base@0\.1\.0 as sha512-other/);
  assert.deepEqual(published(root), []);
});

await test("publish fails closed when the registry cannot be read", (t) => {
  const { root } = packed(t);
  const env = { ...fakeNpm(root, {}), FAKE_NPM_VIEW_ERROR: "1" };
  const result = node(root, ["publish", "release"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm view @fixture\/base@0\.1\.0 failed/);
  assert.deepEqual(published(root), []);
});

await test("publish stops at the first failed upload", (t) => {
  const { root } = packed(t);
  const env = { ...fakeNpm(root, {}), FAKE_NPM_PUBLISH_STATUS: "1" };
  const result = node(root, ["publish", "release"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm publish @fixture\/base@0\.1\.0 exited 1/);
  assert.equal(published(root).length, 1);
  assert.doesNotMatch(result.stdout, /New tag:/);
});

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A gh that keeps releases as files, and a bare repository as origin.
function tagFixture(t) {
  const { root, directory } = packed(t);
  const identity = {
    GIT_AUTHOR_NAME: "Release test",
    GIT_AUTHOR_EMAIL: "release@example.invalid",
    GIT_COMMITTER_NAME: "Release test",
    GIT_COMMITTER_EMAIL: "release@example.invalid",
  };
  Object.assign(process.env, identity);
  t.after(() => {
    for (const key of Object.keys(identity)) delete process.env[key];
  });
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "--quiet", "--bare", origin]);
  git(root, ["init", "--quiet"]);
  git(root, ["add", "packages"]);
  git(root, ["commit", "--quiet", "-m", "release"]);
  git(root, ["remote", "add", "origin", origin]);
  const releases = join(root, "releases");
  mkdirSync(releases);
  const bin = join(root, "gh-bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const { copyFileSync, existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const file = join(${JSON.stringify(releases)}, encodeURIComponent(args[2]));
if (args[1] === "view") {
  if (existsSync(file + ".json")) process.exit(0);
  console.error("release not found");
  process.exit(1);
}
if (args[1] === "create") {
  writeFileSync(file + ".json", JSON.stringify(args.slice(3)));
  copyFileSync(args[args.indexOf("--notes-file") + 1], file + ".md");
  process.exit(0);
}
process.exit(64);
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  return { root, directory, origin, releases, env: { PATH: `${bin}:${process.env.PATH}` } };
}

await test("tag pushes package tags and v<version> on HEAD, and one release, once", (t) => {
  const { root, origin, releases, env } = tagFixture(t);
  const first = node(root, ["tag", "release"], env);
  assert.equal(first.status, 0, first.stderr);
  const head = git(root, ["rev-parse", "HEAD"]);
  const tags = ["@fixture/app@0.1.0", "@fixture/base@0.1.0", "@fixture/core@0.1.0", "v0.1.0"];
  assert.deepEqual(git(origin, ["tag", "-l"]).split("\n"), tags);
  for (const tag of tags) {
    assert.equal(git(origin, ["cat-file", "-t", `refs/tags/${tag}`]), "tag", `${tag} is annotated`);
    assert.equal(git(origin, ["rev-parse", `refs/tags/${tag}^{commit}`]), head);
    assert.equal(git(origin, ["tag", "-l", "--format=%(contents:subject)", tag]), tag);
  }
  assert.deepEqual(
    readdirSync(releases).toSorted((a, b) => a.localeCompare(b)),
    ["v0.1.0.json", "v0.1.0.md"],
  );
  assert.deepEqual(JSON.parse(readFileSync(join(releases, "v0.1.0.json"), "utf8")).slice(0, 3), [
    "--verify-tag",
    "--title",
    "v0.1.0",
  ]);
  assert.equal(
    readFileSync(join(releases, "v0.1.0.md"), "utf8"),
    ["app", "base", "core"]
      .map((name) => `## @fixture/${name}\n\n### Minor Changes\n\n- ${name} notes`)
      .join("\n\n")
      .concat("\n"),
  );

  const again = node(root, ["tag", "release"], env);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /pushed tag|created GitHub release/);
  assert.equal((again.stdout.match(/exists on origin; kept/g) ?? []).length, 4);
  assert.match(again.stdout, /GitHub release v0\.1\.0 exists; kept/);
});

await test("tag refuses a released tag that points at another commit", (t) => {
  const { root, env } = tagFixture(t);
  git(root, ["tag", "v0.1.0", "-m", "v0.1.0"]);
  git(root, ["push", "--quiet", "origin", "refs/tags/v0.1.0"]);
  git(root, ["tag", "--delete", "v0.1.0"]);
  git(root, ["commit", "--quiet", "--allow-empty", "-m", "later"]);
  const result = node(root, ["tag", "release"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tag v0\.1\.0 on origin points at [0-9a-f]{40}, not the released/);
  assert.equal(
    git(root, ["ls-remote", "--tags", "origin"]).split("\n").length,
    2,
    "a conflict must be detected before any package tag is pushed",
  );
  const beforePublish = node(root, ["preflight", "release"], env);
  assert.equal(beforePublish.status, 1);
  assert.match(beforePublish.stderr, /not the released/);
});

await test("a stale local tag is never pushed to origin", (t) => {
  const { root, origin, env } = tagFixture(t);
  git(root, ["tag", "@fixture/app@0.1.0", "-m", "old"]);
  git(root, ["commit", "--quiet", "--allow-empty", "-m", "later"]);
  const result = node(root, ["tag", "release"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local tag .* does not point at the released/);
  assert.equal(git(origin, ["tag", "-l"]), "");
});

await test("preflight rejects an incomplete artifact before any upload", (t) => {
  const { root, directory, env } = tagFixture(t);
  const manifest = join(directory, "release.json");
  const record = JSON.parse(readFileSync(manifest, "utf8"));
  const removed = record.packages.pop();
  rmSync(join(directory, removed.file));
  writeFileSync(manifest, JSON.stringify(record));
  const result = node(root, ["preflight", "release"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /do not match all published workspace packages/);
});

await test("tag refuses a missing changelog entry or mixed versions before pushing anything", (t) => {
  const missing = tagFixture(t);
  writeFileSync(join(missing.root, "packages/app/CHANGELOG.md"), "# @fixture/app\n\n## 0.0.1\n");
  const result = node(missing.root, ["tag", "release"], missing.env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHANGELOG\.md has no entry for 0\.1\.0/);
  assert.equal(git(missing.origin, ["tag", "-l"]), "");

  const mixed = tagFixture(t);
  const manifest = join(mixed.directory, "release.json");
  const record = JSON.parse(readFileSync(manifest, "utf8"));
  record.packages[0].version = "0.2.0";
  writeFileSync(manifest, JSON.stringify(record));
  const refused = node(mixed.root, ["tag", "release"], mixed.env);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /must share one version \(D3\), found 0\.2\.0, 0\.1\.0/);
  assert.equal(git(mixed.origin, ["tag", "-l"]), "");
});

await test("version prints the one shared version and refuses mixed versions", (t) => {
  const root = workspace(t);
  const shared = node(root, ["version"]);
  assert.equal(shared.status, 0, shared.stderr);
  assert.equal(shared.stdout, "0.1.0\n");
  const base = join(root, "packages/base/package.json");
  writeFileSync(
    base,
    JSON.stringify({ ...JSON.parse(readFileSync(base, "utf8")), version: "0.2.0" }),
  );
  const mixed = node(root, ["version"]);
  assert.equal(mixed.status, 1);
  assert.match(mixed.stderr, /must share one version \(D3\)/);
});
