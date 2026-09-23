import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

import { projectCommand } from "../../lib/project-files.mjs";

const query = (kind) => JSON.parse(projectCommand(".", "moon", ["query", kind], true));
const sorted = (values) => [...new Set(values)].toSorted((a, b) => a.localeCompare(b));

// B6: package.json is the one place a member names the workspace packages it uses. Moon infers the
// project edges from it, so a dependsOn list in moon.yml is a second copy that can drift.
function checkProjectEdges(projects, root = ".") {
  const idByPackage = new Map(
    projects.flatMap((project) => (project.aliases ?? []).map(({ alias }) => [alias, project.id])),
  );
  // The root project depends on every member, which is Moon's rule for a root project, not a manifest's.
  // Other languages use their own dependency model, including explicit Moon edges.
  const members = projects.filter(
    (project) => project.source !== "." && existsSync(join(root, project.source, "package.json")),
  );
  for (const project of members) {
    const moonFile = join(root, project.source, "moon.yml");
    const config = existsSync(moonFile) ? parse(readFileSync(moonFile, "utf8")) : {};
    assert.equal(
      config?.dependsOn,
      undefined,
      `${moonFile} declares dependsOn; add the package to ${project.source}/package.json instead`,
    );
    const manifest = JSON.parse(readFileSync(join(root, project.source, "package.json"), "utf8"));
    const declared = Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    })
      .filter(([, range]) => range.startsWith("workspace:"))
      .map(([name]) => {
        assert.ok(idByPackage.has(name), `${project.id} names unknown workspace package ${name}`);
        return idByPackage.get(name);
      });
    assert.deepEqual(
      sorted((project.dependencies ?? []).map(({ id }) => id)),
      sorted(declared),
      `Moon's edges for ${project.id} differ from its package.json`,
    );
  }
}

await test("JavaScript project edges come only from package.json", () => {
  const { projects } = query("projects");
  assert.ok(projects.length > 1, "no workspace members found");
  checkProjectEdges(projects);
});

await test("the edge gate allows other languages and rejects JavaScript drift", (t) => {
  const root = mkdtempSync(join(tmpdir(), "moon-edges-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["app", "lib", "rust"]) mkdirSync(join(root, name));
  const projects = [
    { id: "app", source: "app", dependencies: [{ id: "lib" }] },
    { id: "lib", source: "lib", aliases: [{ alias: "@example/lib" }] },
    { id: "rust", source: "rust", dependencies: [{ id: "lib" }] },
  ];
  writeFileSync(join(root, "rust/moon.yml"), "language: rust\ndependsOn: [lib]\n");
  writeFileSync(join(root, "lib/package.json"), '{"name":"@example/lib"}');
  const manifest = { dependencies: { "@example/lib": "workspace:*" } };
  writeFileSync(join(root, "app/package.json"), JSON.stringify(manifest));
  checkProjectEdges(projects, root);
  writeFileSync(join(root, "app/moon.yml"), "dependsOn: [lib]\n");
  assert.throws(() => checkProjectEdges(projects, root), /declares dependsOn/);
  rmSync(join(root, "app/moon.yml"));
  writeFileSync(join(root, "app/package.json"), "{}");
  assert.throws(() => checkProjectEdges(projects, root), /edges for app differ/);
  writeFileSync(join(root, "app/package.json"), JSON.stringify(manifest));
  assert.throws(
    () => checkProjectEdges([{ ...projects[0], dependencies: [] }, ...projects.slice(1)], root),
    /edges for app differ/,
  );
  writeFileSync(join(root, "app/package.json"), '{"dependencies":{"missing":"workspace:*"}}');
  assert.throws(() => checkProjectEdges(projects, root), /unknown workspace package missing/);
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
