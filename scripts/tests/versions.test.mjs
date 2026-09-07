import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

await test("Moon installer, workspace constraint and release pins agree", () => {
  const version = readFileSync(".prototools", "utf8").match(/^moon = "([^"]+)"/m)?.[1];
  assert.ok(version);
  assert.equal(
    readFileSync(".moon/workspace.yml", "utf8").match(/versionConstraint: "=([^"]+)"/)?.[1],
    version,
  );
  assert.equal(
    readFileSync(".github/workflows/release.yml", "utf8").match(/moon-version: "([^"]+)"/)?.[1],
    version,
  );
});

await test("Renovate discovers all three Moon pins in one group", () => {
  const config = JSON.parse(readFileSync("renovate.json", "utf8"));
  for (const file of [".prototools", ".moon/workspace.yml", ".github/workflows/release.yml"]) {
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
