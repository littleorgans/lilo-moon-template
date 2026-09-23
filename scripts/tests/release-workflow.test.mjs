import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

// The release workflow's gate, as structure. GitHub skips a job whose `needs` did not succeed unless
// its `if` says otherwise, so these hold the publish behind the full gate on the same commit.
await test("release.yml publishes only after the full gate passes on the same run", () => {
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const { version, gate, publish, smoke } = workflow.jobs;
  assert.deepEqual(Object.keys(workflow.jobs), ["version", "gate", "publish", "smoke"]);
  assert.deepEqual(workflow.permissions, {});

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
  assert.equal(changesets.with.publish, undefined, "changesets/action must not publish");

  assert.equal(gate.needs, "version");
  assert.equal(gate.if, "needs.version.outputs.publish == 'true'");
  const runs = gate.steps.map((step) => step.run).filter(Boolean);
  assert.deepEqual(runs.slice(1), [
    "moon ci --force",
    'node scripts/release.mjs pack "$RUNNER_TEMP/release"',
    'node scripts/check-packed-secrets.mjs "$RUNNER_TEMP/release"',
    'node scripts/published-shape.mjs "$RUNNER_TEMP/release"',
  ]);
  assert.match(gate.steps.at(-1).uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);

  assert.equal(publish.needs, "gate");
  assert.equal(smoke.needs, "publish");
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
  const pin = /npm install --global npm@(\d+)\.(\d+)\.(\d+)\n/.exec(
    readFileSync(".github/workflows/release.yml", "utf8"),
  );
  assert.ok(pin, "release.yml must pin an exact npm");
  const [major, minor] = pin.slice(1).map(Number);
  assert.ok(major > 11 || (major === 11 && minor >= 5), "trusted publishing needs npm >= 11.5");
});
