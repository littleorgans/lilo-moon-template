import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";

import { git, initializeProject, projectEnvironment } from "../../lib/project-files.mjs";

process.env.GIT_AUTHOR_NAME = "Baseline verification";
process.env.GIT_AUTHOR_EMAIL = "baseline@example.invalid";
process.env.GIT_COMMITTER_NAME = process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_AUTHOR_EMAIL;

const script = resolve("scripts/install-hooks.mjs");

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "install-hooks-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  // Stands in for lefthook and records the directory each install ran from.
  writeFileSync(
    join(bin, "lefthook"),
    '#!/bin/sh\npwd >> "$LEFTHOOK_RECORD"\nexit "${LEFTHOOK_STATUS:-0}"\n',
  );
  chmodSync(join(bin, "lefthook"), 0o755);
  const main = join(root, "main");
  mkdirSync(main);
  writeFileSync(join(main, "README.md"), "fixture\n");
  initializeProject(main, "test: install hooks fixture");
  git(main, ["worktree", "add", "--quiet", join(root, "linked")]);
  const outside = join(root, "outside");
  mkdirSync(outside);
  return { root, bin, main, linked: join(root, "linked"), outside, record: join(root, "record") };
}

function install(cwd, { root, bin, record }, extra = {}) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...projectEnvironment(),
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      LEFTHOOK_RECORD: record,
      // The outside directory must not find an enclosing repository above the fixture.
      GIT_CEILING_DIRECTORIES: root,
      ...extra,
    },
  });
}

const installs = (record) => (existsSync(record) ? readFileSync(record, "utf8").trim() : "");

await test("the main checkout installs hooks", (t) => {
  const context = fixture(t);
  const result = install(context.main, context);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(installs(context.record), context.main);
});

await test("a linked worktree leaves the shared hooks alone", (t) => {
  const context = fixture(t);
  const result = install(context.linked, context);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /linked worktrees use the main checkout's hooks/);
  assert.equal(installs(context.record), "");
});

await test("outside a Git repository the install is a no-op", (t) => {
  const context = fixture(t);
  const result = install(context.outside, context);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not inside a Git repository/);
  assert.equal(installs(context.record), "");
});

await test("a failing lefthook install still fails in the main checkout", (t) => {
  const context = fixture(t);
  assert.equal(install(context.main, context, { LEFTHOOK_STATUS: "3" }).status, 3);
});
