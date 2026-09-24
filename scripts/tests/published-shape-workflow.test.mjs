import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { parse, stringify } from "yaml";

import { commitProject, git, projectEnvironment } from "../lib/project-files.mjs";

const readYaml = (path) => parse(readFileSync(path, "utf8"));
const WORKFLOW = ".github/workflows/published-shape.yml";
const COMMAND = "moon exec root:published-shape --ignore-ci-checks";
const pins = (steps) =>
  new Map(steps.filter((step) => step.uses).map((step) => step.uses.split("@")));

// Minutes long, so pull request CI leaves it out. The release gate and the nightly run name it.
await test("published-shape runs in the release gate and nightly, not in pull request CI", () => {
  const task = readYaml("moon.yml").tasks["published-shape"];
  assert.equal(task.options.runInCI, false);
  assert.equal(task.options.cache, false);
  for (const workflow of ["ci.yml", "moon-ci.yml"]) {
    const text = readFileSync(`.github/workflows/${workflow}`, "utf8");
    assert.doesNotMatch(text, /published-shape/, workflow);
  }

  const gate = readYaml(".github/workflows/release.yml").jobs.gate.steps.map((step) => step.run);
  assert.equal(gate[gate.indexOf("moon ci --force") + 1], COMMAND);

  const workflow = readYaml(WORKFLOW);
  assert.deepEqual(Object.keys(workflow.on), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, {});
  const job = workflow.jobs["published-shape"];
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.equal(job.if, undefined);
  assert.equal(job["continue-on-error"], undefined);
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.equal(job.steps.at(-1).run, COMMAND);
  for (const step of job.steps) {
    assert.equal(step.if, undefined, JSON.stringify(step));
    assert.equal(step["continue-on-error"], undefined, JSON.stringify(step));
  }
});

await test("published-shape.yml installs what moon-ci.yml installs, at the same pins", () => {
  const shared = pins(readYaml(".github/workflows/moon-ci.yml").jobs["moon-ci"].steps);
  const steps = readYaml(WORKFLOW).jobs["published-shape"].steps;
  for (const [action, digest] of pins(steps)) {
    assert.match(digest, /^[0-9a-f]{40}$/, `pin ${action} by digest`);
    assert.equal(digest, shared.get(action), `${action} differs from moon-ci.yml`);
  }
  const node = steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
  const pin = /^node:\n {2}version: "([^"]+)"$/m.exec(
    readFileSync(".moon/toolchains.yml", "utf8"),
  )?.[1];
  assert.equal(node.with["node-version"], pin, "the Node that .moon/toolchains.yml pins");
});

// A task command that leaves <name>.ran at the workspace root.
const marker = (name) => ({
  command: "node",
  args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(`${name}.ran`)}, "")`],
});

// Every runner sets CI, and under CI moon drops a `runInCI: false` task from `moon run` as well as
// from `moon ci`. The real task, with its command swapped for a marker, goes through `moon ci` on a
// change to packages/, through `moon run`, and through the workflows' command, all with CI set. A
// probe task on the same inputs shows `moon ci` ran at all.
await test("with CI set, moon ci and moon run skip published-shape and the workflows' command runs it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "published-shape-ci-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { fileGroups, tasks } = readYaml("moon.yml");
  for (const [file, content] of Object.entries({
    ".moon/workspace.yml": 'projects:\n  sources:\n    root: "."\nvcs:\n  defaultBranch: "main"\n',
    ".gitignore": ".moon/cache/\n*.ran\n",
    "moon.yml": stringify({
      fileGroups: { sources: fileGroups.sources },
      tasks: {
        "published-shape": { ...tasks["published-shape"], ...marker("published-shape") },
        probe: { ...marker("probe"), inputs: ["@globs(sources)"], options: { cache: false } },
      },
    }),
    "packages/auth/change.txt": "base\n",
  })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Baseline verification"]);
  git(root, ["config", "user.email", "baseline@example.invalid"]);
  commitProject(root, "test: initialize published-shape fixture");
  writeFileSync(join(root, "packages/auth/change.txt"), "head\n");
  commitProject(root, "test: change a package");

  const ran = (name) => existsSync(join(root, `${name}.ran`));
  const moon = (args, env = {}) => {
    for (const name of ["published-shape", "probe"])
      rmSync(join(root, `${name}.ran`), { force: true });
    return execFileSync("moon", args, {
      cwd: root,
      env: { ...projectEnvironment(), CI: "true", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
  };

  moon(["ci"], { MOON_BASE: "HEAD~1", MOON_HEAD: "HEAD" });
  assert.ok(ran("probe"), "moon ci ran nothing, so it cannot show published-shape stays out");
  assert.ok(!ran("published-shape"), "moon ci ran published-shape on a pull request change");

  // When moon stops doing this, `moon run` would do in the workflows.
  assert.throws(() => moon(["run", "root:published-shape"]), /No tasks found/);
  assert.ok(!ran("published-shape"));

  const [command, ...args] = COMMAND.split(" ");
  assert.equal(command, "moon");
  moon(args);
  assert.ok(
    ran("published-shape"),
    "the workflows' command did not run published-shape with CI set",
  );
});
