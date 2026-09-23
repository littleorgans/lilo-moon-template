import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

import { projectCommand } from "../../lib/project-files.mjs";

const query = (kind) => JSON.parse(projectCommand(".", "moon", ["query", kind], true));
const sorted = (values) => [...new Set(values)].toSorted((a, b) => a.localeCompare(b));

// B6: package.json is the one place a member names the workspace packages it uses. Moon infers the
// project edges from it, so a dependsOn list in moon.yml is a second copy that can drift.
await test("project edges come only from package.json", () => {
  const { projects } = query("projects");
  const idByPackage = new Map(
    projects.flatMap((project) => (project.aliases ?? []).map(({ alias }) => [alias, project.id])),
  );
  // The root project depends on every member, which is Moon's rule for a root project, not a manifest's.
  const members = projects.filter((project) => project.source !== ".");
  assert.ok(members.length > 0, "no workspace members found");
  for (const project of members) {
    const moonFile = join(project.source, "moon.yml");
    const config = existsSync(moonFile) ? parse(readFileSync(moonFile, "utf8")) : {};
    assert.equal(
      config?.dependsOn,
      undefined,
      `${moonFile} declares dependsOn; add the package to ${project.source}/package.json instead`,
    );
    const manifest = JSON.parse(readFileSync(join(project.source, "package.json"), "utf8"));
    const declared = Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    })
      .filter(([, range]) => range.startsWith("workspace:"))
      .map(([name]) => idByPackage.get(name));
    assert.deepEqual(
      sorted((project.dependencies ?? []).map(({ id }) => id)),
      sorted(declared),
      `Moon's edges for ${project.id} differ from its package.json`,
    );
  }
});

// Every Moon run rewrites .moon/cache, so a cached task that hashes it never replays. root:scripts-test
// once read .moon/**/* and ran in full every time.
await test("no cached task takes Moon's own cache as an input", () => {
  const { tasks } = query("tasks");
  const probe = ".moon/cache/states/probe.json";
  const checked = Object.values(tasks).flatMap((byId) => Object.values(byId));
  assert.ok(checked.length > 0, "no tasks found");
  for (const task of checked) {
    if (task.options.cache === false) continue;
    const globs = Object.keys(task.inputGlobs ?? {});
    const covered = globs.some((glob) => !glob.startsWith("!") && matchesGlob(probe, glob));
    const excluded = globs.some(
      (glob) => glob.startsWith("!") && matchesGlob(probe, glob.slice(1)),
    );
    assert.ok(!covered || excluded, `${task.target} hashes .moon/cache through its inputs`);
  }
});
