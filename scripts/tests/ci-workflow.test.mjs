import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

const readWorkflow = (name) => parse(readFileSync(`.github/workflows/${name}`, "utf8"));

// Projects call moon-ci.yml from another repository at a release tag, so what it may do is fixed
// here: no secrets, a read-only token, pinned actions, and no credential left in the checkout.
await test("moon-ci.yml is a least-privilege reusable workflow", () => {
  const workflow = readWorkflow("moon-ci.yml");
  assert.deepEqual(Object.keys(workflow.on), ["workflow_call"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_call), ["inputs"], "declare no secrets");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  // A called workflow reports the caller's github.workflow, so its own group would cancel the caller.
  assert.equal(workflow.concurrency, undefined);
  const jobs = Object.values(workflow.jobs);
  assert.equal(jobs.length, 1);
  const [job] = jobs;
  assert.equal(job.concurrency, undefined);
  assert.equal(job["runs-on"], "${{ inputs.runs-on }}");
  for (const step of job.steps.filter((entry) => entry.uses)) {
    assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, "pin every action by digest");
  }
  const checkout = job.steps[0];
  assert.match(checkout.uses, /^actions\/checkout@/);
  assert.deepEqual(checkout.with, { "fetch-depth": 0, "persist-credentials": false });
  const moon = job.steps.at(-1);
  assert.equal(moon.run, "moon ci");
  assert.deepEqual(Object.keys(moon.env), ["MOON_BASE", "MOON_HEAD"]);
});

await test("ci.yml calls moon-ci.yml and keeps the required CI check", () => {
  const workflow = readWorkflow("ci.yml");
  assert.deepEqual(workflow.permissions, {});
  const { moon, ci } = workflow.jobs;
  assert.equal(moon.uses, "./.github/workflows/moon-ci.yml");
  assert.equal(moon.secrets, undefined, "moon-ci.yml reads no secrets");
  assert.deepEqual(moon.permissions, { contents: "read" });
  // Branch protection requires "CI". A skipped required check passes, so this one never skips and
  // fails unless the called workflow succeeded.
  assert.equal(ci.name, "CI");
  assert.equal(ci.needs, "moon");
  assert.equal(ci.if, "always()");
  assert.deepEqual(ci.permissions, {});
  assert.equal(ci.steps.length, 1);
  assert.equal(ci.steps[0].env.RESULT, "${{ needs.moon.result }}");
  for (const [result, status] of [
    ["success", 0],
    ["failure", 1],
    ["cancelled", 1],
    ["skipped", 1],
  ]) {
    const run = spawnSync("bash", ["-e", "-c", ci.steps[0].run], {
      env: { ...process.env, RESULT: result },
    });
    assert.equal(run.status, status, `moon ${result}`);
  }
});

await test("moon-ci.yml installs the Node that .moon/toolchains.yml pins", (t) => {
  const root = mkdtempSync(join(tmpdir(), "moon-ci-node-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const step = readWorkflow("moon-ci.yml").jobs["moon-ci"].steps.find(
    (entry) => entry.id === "node",
  );
  const readPin = (toolchains) => {
    mkdirSync(join(root, ".moon"), { recursive: true });
    const output = join(root, "output");
    writeFileSync(join(root, ".moon/toolchains.yml"), toolchains);
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", step.run], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return { status: result.status, output: readFileSync(output, "utf8"), stdout: result.stdout };
  };
  const toolchains = readFileSync(".moon/toolchains.yml", "utf8");
  const pin = /^node:\n {2}version: "([^"]+)"$/m.exec(toolchains)?.[1];
  assert.ok(pin, "this repository pins node in .moon/toolchains.yml");
  assert.deepEqual(readPin(toolchains), { status: 0, output: `version=${pin}\n`, stdout: "" });
  // Another tool's version key must not be taken for Node's.
  const unpinned = readPin('pnpm:\n  version: "11.22.0"\nnode:\n  # none\n');
  assert.equal(unpinned.status, 1);
  assert.equal(unpinned.output, "");
  assert.match(unpinned.stdout, /no node\.version pin/);
});
