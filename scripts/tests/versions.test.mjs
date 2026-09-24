import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

await test("Moon installer and workspace constraint agree, and workflows install from .prototools", () => {
  const version = readFileSync(".prototools", "utf8").match(/^moon = "([^"]+)"/m)?.[1];
  assert.ok(version);
  assert.equal(
    readFileSync(".moon/workspace.yml", "utf8").match(/versionConstraint: "=([^"]+)"/)?.[1],
    version,
  );
  for (const workflow of [
    ".github/workflows/ci.yml",
    ".github/workflows/moon-ci.yml",
    ".github/workflows/release.yml",
    ".github/workflows/workos-contract.yml",
  ]) {
    assert.doesNotMatch(readFileSync(workflow, "utf8"), /moon-version:/, workflow);
  }
});

// Projects extend renovate/base.json as github>littleorgans/lilo-moon-template//renovate/base, and
// this repository extends it too, so the managers and groups a project needs live in the preset.
await test("this repository's Renovate config extends the preset it hosts", () => {
  const config = JSON.parse(readFileSync("renovate.json", "utf8"));
  assert.deepEqual(config.extends, ["local>littleorgans/lilo-moon-template//renovate/base"]);
  const preset = JSON.parse(readFileSync("renovate/base.json", "utf8"));
  const scope = preset.packageRules.find((rule) => rule.groupName === "littleorgans");
  assert.deepEqual(scope?.matchPackageNames, [
    "@littleorgans/**",
    "littleorgans/lilo-moon-template",
  ]);
});

await test("Renovate discovers both Moon pins in one group", () => {
  const config = JSON.parse(readFileSync("renovate/base.json", "utf8"));
  for (const file of [".prototools", ".moon/workspace.yml"]) {
    const manager = config.customManagers.find(
      (candidate) =>
        candidate.managerFilePatterns.some((pattern) =>
          new RegExp(pattern.slice(1, -1)).test(file),
        ) &&
        candidate.matchStrings.some((pattern) =>
          new RegExp(pattern).test(readFileSync(file, "utf8")),
        ),
    );
    assert.ok(manager, `no version manager matches ${file}`);
  }
  assert.ok(
    config.packageRules.some(
      (rule) => rule.groupName === "moon" && rule.matchDepNames.includes("moon"),
    ),
  );
});
