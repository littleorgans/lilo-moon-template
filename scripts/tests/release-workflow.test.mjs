import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

// The release workflow's gate, as structure. GitHub skips a job whose `needs` did not succeed unless
// its `if` says otherwise, so these hold the publish behind the full gate on the same commit.
await test("release.yml publishes only after the full gate passes on the same run", () => {
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const { version, gate, publish, smoke } = workflow.jobs;
  assert.deepEqual(Object.keys(workflow.jobs), ["version", "gate", "publish", "smoke"]);
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.concurrency["cancel-in-progress"], false);

  assert.equal(
    version.outputs.publish,
    "${{ steps.changesets.outputs.hasChangesets == 'false' && steps.released.outputs.released == 'false' && vars.NPM_PUBLISH_ENABLED == 'true' }}",
  );
  // A released version is final: v<version> on origin keeps later pushes from releasing again.
  const released = version.steps.find((step) => step.id === "released");
  assert.equal(released.if, "steps.changesets.outputs.hasChangesets == 'false'");
  assert.match(released.run, /tag="v\$\(node scripts\/release\.mjs version\)"/);
  assert.match(released.run, /git ls-remote --exit-code --tags origin "refs\/tags\/\$tag"/);
  const changesets = version.steps.find((step) => step.id === "changesets");
  assert.match(changesets.uses, /^changesets\/action@[0-9a-f]{40}$/);
  // The version commit runs the lefthook hooks the install set up, and they call moon.
  const moon = version.steps.findIndex((step) =>
    step.uses?.startsWith("moonrepo/setup-toolchain@"),
  );
  const install = version.steps.findIndex((step) => step.run?.startsWith("pnpm install"));
  assert.ok(moon >= 0 && moon < install, "the version job must install moon before its commit");
  assert.equal(changesets.with.publish, undefined, "changesets/action must not publish");

  assert.equal(gate.needs, "version");
  assert.equal(gate.if, "needs.version.outputs.publish == 'true'");
  const runs = gate.steps.map((step) => step.run).filter(Boolean);
  assert.deepEqual(runs.slice(1), [
    "moon ci --force",
    "moon exec root:published-shape --ignore-ci-checks",
    'node scripts/release.mjs pack "$RUNNER_TEMP/release"',
    'node scripts/check-packed-secrets.mjs "$RUNNER_TEMP/release"',
    'node scripts/published-shape.mjs "$RUNNER_TEMP/release"',
  ]);
  assert.match(gate.steps.at(-1).uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.equal(gate.outputs["artifact-id"], "${{ steps.artifact.outputs.artifact-id }}");
  assert.equal(gate.steps.at(-1).with.name, "release-tarballs-${{ github.run_attempt }}");
  for (const job of [publish, smoke]) {
    const download = job.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
    assert.equal(download.with["artifact-ids"], "${{ needs.gate.outputs.artifact-id }}");
    assert.equal(download.with["merge-multiple"], true);
    assert.equal(job.steps[0].with["persist-credentials"], false);
  }
  const preflight = publish.steps.findIndex((step) => step.run?.includes("release.mjs preflight"));
  const uploadIndex = publish.steps.findIndex((step) => step.run?.includes("release.mjs publish"));
  assert.ok(preflight >= 0 && preflight < uploadIndex);

  assert.equal(publish.needs, "gate");
  assert.deepEqual(smoke.needs, ["gate", "publish"]);
  for (const job of [gate, publish, smoke]) {
    assert.ok(!("continue-on-error" in job));
    for (const step of job.steps) {
      assert.ok(!("continue-on-error" in step), JSON.stringify(step));
      assert.ok(!("if" in step), `a conditional step can skip the gate: ${JSON.stringify(step)}`);
    }
  }
  for (const job of [publish, smoke]) assert.ok(!("if" in job), "only needs may decide this job");

  // Only publish can mint an OIDC token or read the npm token.
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.permissions["id-token"] === "write", name === "publish", name);
  }
  const text = readFileSync(".github/workflows/release.yml", "utf8");
  assert.equal(text.match(/secrets\.LILO_NPM_TOKEN/g)?.length, 1, "one step reads the npm token");
  const upload = publish.steps.find((step) => step.run?.includes("release.mjs publish"));
  assert.equal(upload.env.NODE_AUTH_TOKEN, "${{ secrets.LILO_NPM_TOKEN }}");
});

await test("release.yml pins an npm with trusted publishing", () => {
  const pin = /npm install --global npm@(\d+)\.(\d+)\.(\d+) --ignore-scripts\n/.exec(
    readFileSync(".github/workflows/release.yml", "utf8"),
  );
  assert.ok(pin, "release.yml must pin an exact npm");
  const [major, minor] = pin.slice(1).map(Number);
  assert.ok(major > 11 || (major === 11 && minor >= 5), "trusted publishing needs npm >= 11.5");
});

await test("the version probe distinguishes a missing tag from a failed remote lookup", (t) => {
  const root = mkdtempSync(join(tmpdir(), "release-remote-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, script] of Object.entries({
    node: "#!/bin/sh\necho 0.1.0\n",
    git: '#!/bin/sh\nexit "$REMOTE_STATUS"\n',
  })) {
    writeFileSync(join(root, name), script);
    chmodSync(join(root, name), 0o755);
  }
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const script = workflow.jobs.version.steps.find((step) => step.id === "released").run;
  for (const status of [0, 2, 128]) {
    const output = join(root, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        REMOTE_STATUS: String(status),
      },
    });
    assert.equal(result.status, status === 128 ? 128 : 0);
    assert.equal(readFileSync(output, "utf8"), status === 128 ? "" : `released=${status === 0}\n`);
  }
});
