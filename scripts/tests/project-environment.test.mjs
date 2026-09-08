import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { initializeProject, projectCommand } from "../lib/project-files.mjs";

await test("child projects can run development tasks under a GitHub CI parent", () => {
  const root = mkdtempSync(join(tmpdir(), "project-environment-"));
  const names = [
    "CI",
    "GITHUB_ACTIONS",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GIT_AUTHOR_NAME: "Baseline verification",
      GIT_AUTHOR_EMAIL: "baseline@example.invalid",
      GIT_COMMITTER_NAME: "Baseline verification",
      GIT_COMMITTER_EMAIL: "baseline@example.invalid",
    });
    mkdirSync(join(root, ".moon"));
    writeFileSync(
      join(root, ".moon/workspace.yml"),
      'projects:\n  sources:\n    root: "."\nvcs:\n  defaultBranch: "main"\n',
    );
    writeFileSync(
      join(root, "moon.yml"),
      `language: "system"
layer: "application"
tasks:
  prepare:
    type: "run"
    command: >-
      node -e "require('node:fs').writeFileSync('ran.json', JSON.stringify({ci:process.env.CI,github:process.env.GITHUB_ACTIONS}))"
    options:
      cache: false
      runInCI: false
`,
    );
    initializeProject(root, "test: initialize child environment fixture");
    projectCommand(root, "moon", ["run", "root:prepare"], true);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "ran.json"), "utf8")), {});
    assert.equal(process.env.CI, "true");
    assert.equal(process.env.GITHUB_ACTIONS, "true");
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
