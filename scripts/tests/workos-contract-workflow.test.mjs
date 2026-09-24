import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

const readYaml = (path) => parse(readFileSync(path, "utf8"));
const WORKFLOW = ".github/workflows/workos-contract.yml";
const pins = (steps) =>
  new Map(steps.filter((step) => step.uses).map((step) => step.uses.split("@")));

// The staging credentials reach one step of one workflow. Everything else, and every project built
// from this repository, runs without them.
await test("workos-contract.yml reads the staging secrets in one step and fails without them", () => {
  const workflow = readYaml(WORKFLOW);
  assert.deepEqual(Object.keys(workflow.on), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, {});
  const { contract, report } = workflow.jobs;
  assert.deepEqual(contract.permissions, { contents: "read" });
  // Both scheduled runs and maintainer dispatches on a reviewed branch must reach the suite.
  assert.equal(contract.if, undefined);
  assert.deepEqual(workflow.concurrency, {
    group: "workos-contract-staging",
    "cancel-in-progress": false,
  });
  assert.equal(contract.steps[0].with["persist-credentials"], false);
  assert.equal(contract["continue-on-error"], undefined);

  const run = contract.steps.at(-1);
  assert.equal(run.run, "moon run workos-contract:contract --upstream none");
  assert.deepEqual(run.env, {
    WORKOS_API_KEY: "${{ secrets.WORKOS_API_KEY }}",
    WORKOS_CLIENT_ID: "${{ secrets.WORKOS_CLIENT_ID }}",
    WORKOS_CONTRACT_REQUIRED: "true",
  });
  const text = readFileSync(WORKFLOW, "utf8");
  assert.equal(text.match(/secrets\./g)?.length, 2, "only the contract step reads secrets");
  for (const step of contract.steps) {
    assert.equal(step.if, undefined, JSON.stringify(step));
    assert.equal(step["continue-on-error"], undefined, JSON.stringify(step));
  }

  assert.equal(report.needs, "contract");
  assert.equal(
    report.if,
    "always() && (github.event_name == 'schedule' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch))",
  );
  assert.deepEqual(report.permissions, { issues: "write" });
});

await test("workos-contract.yml installs what moon-ci.yml installs, at the same pins", () => {
  const shared = pins(readYaml(".github/workflows/moon-ci.yml").jobs["moon-ci"].steps);
  const contract = readYaml(WORKFLOW).jobs.contract.steps;
  for (const [action, digest] of pins(contract)) {
    assert.match(digest, /^[0-9a-f]{40}$/, `pin ${action} by digest`);
    assert.equal(digest, shared.get(action), `${action} differs from moon-ci.yml`);
  }
  const node = contract.find((step) => step.uses?.startsWith("actions/setup-node@"));
  const pin = /^node:\n {2}version: "([^"]+)"$/m.exec(
    readFileSync(".moon/toolchains.yml", "utf8"),
  )?.[1];
  assert.equal(node.with["node-version"], pin, "the Node that .moon/toolchains.yml pins");
});

await test("the contract suite stays out of moon ci and out of the workflows projects call", () => {
  const { tasks } = readYaml("packages/workos-contract/moon.yml");
  assert.equal(tasks.contract.options.runInCI, false);
  assert.equal(tasks.contract.options.cache, false);
  for (const workflow of ["ci.yml", "moon-ci.yml", "release.yml"]) {
    const text = readFileSync(`.github/workflows/${workflow}`, "utf8");
    assert.doesNotMatch(text, /WORKOS_|workos-contract/, workflow);
  }
});

// assumptions.test.ts reads package sources outside its project. Unless they are inputs of the
// tasks that run it, a change to them replays a cached pass.
await test("the package sources assumptions.test.ts reads are inputs of its test tasks", () => {
  const text = readFileSync("packages/workos-contract/tests/assumptions.test.ts", "utf8");
  const read = [...new Set([...text.matchAll(/source\("([^"]+)"\)/g)].map(([, path]) => path))];
  assert.ok(read.length > 0, "assumptions.test.ts reads no sources: update this test");
  const { tasks } = readYaml("packages/workos-contract/moon.yml");
  for (const task of ["test", "test-coverage"]) {
    assert.deepEqual(
      tasks[task].inputs.toSorted(),
      read.map((path) => `/packages/${path}`).toSorted(),
      task,
    );
  }
});

await test("the report opens one issue, comments while it stays open, and closes it on a pass", (t) => {
  const root = mkdtempSync(join(tmpdir(), "workos-contract-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = join(root, "calls");
  // A gh that answers `issue list` with $OPEN and records every other call.
  writeFileSync(
    join(root, "gh"),
    `#!/bin/sh\nif [ "$1 $2" = "issue list" ]; then printf '%s' "$OPEN"; exit 0; fi\necho "$1 $2 $3" >> "${calls}"\n`,
  );
  chmodSync(join(root, "gh"), 0o755);
  const script = readYaml(WORKFLOW).jobs.report.steps[0].run;
  for (const [result, open, expected] of [
    ["success", "", ""],
    ["success", "12", "issue close 12\n"],
    ["failure", "", "issue create --title\n"],
    ["failure", "12", "issue comment 12\n"],
    ["cancelled", "", "issue create --title\n"],
  ]) {
    writeFileSync(calls, "");
    const outcome = spawnSync("bash", ["-e", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        RESULT: result,
        OPEN: open,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "1",
      },
    });
    assert.equal(outcome.status, 0, outcome.stderr);
    assert.equal(readFileSync(calls, "utf8"), expected, `${result}, open issue ${open || "none"}`);
  }
});
