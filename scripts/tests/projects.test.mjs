import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createProject, planProject } from "../lib/create-project.mjs";
import { git, initializeProject, writeJson } from "../lib/project-files.mjs";
import { projectImpact } from "../lib/project-impact.mjs";
import {
  ORIGIN_FILE,
  projectRecords,
  readOrigin,
  registerProject,
} from "../lib/project-registry.mjs";

process.env.GIT_AUTHOR_NAME = "Baseline verification";
process.env.GIT_AUTHOR_EMAIL = "baseline@example.invalid";
process.env.GIT_COMMITTER_NAME = process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_AUTHOR_EMAIL;

const producer = existsSync(".template/config.json");
const run = (name, fn) => test(name, { skip: !producer }, fn);

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "project-lineage-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "template");
  for (const path of ["scripts", ".template/projects", "packages/auth/src", "apps/web"])
    mkdirSync(join(source, path), { recursive: true });
  cpSync("scripts/rename-template.sh", join(source, "scripts/rename-template.sh"));
  for (const file of [
    "projects.mjs",
    "lib/create-project.mjs",
    "lib/project-files.mjs",
    "lib/project-registry.mjs",
    "lib/project-impact.mjs",
  ]) {
    cpSync(join("scripts", file), join(source, "scripts", file));
  }
  cpSync("package.json", join(source, "package.json"));
  cpSync("packages/auth/package.json", join(source, "packages/auth/package.json"));
  const dependency = JSON.parse(readFileSync("packages/auth/package.json", "utf8")).name;
  writeJson(join(source, "apps/web/package.json"), {
    name: "fixture-app",
    dependencies: { [dependency]: "workspace:*" },
  });
  writeJson(join(source, ".template/config.json"), { schemaVersion: 1, id: randomUUID() });
  writeFileSync(join(source, ".template/projects/never-copy.txt"), "other descendant");
  writeFileSync(join(source, ".gitignore"), ".env.local\n.template/local/\n");
  writeFileSync(join(source, ".env.local"), "ignored local configuration");
  writeFileSync(join(source, "packages/auth/src/index.ts"), "export const value = 1;\n");
  initializeProject(source, "test: create template fixture");
  const options = {
    source,
    name: "sample",
    destination: join(root, "sample"),
    org: "sample-org",
    scope: "sample",
    install: false,
  };
  return { root, source, options };
}

await run(
  "creation records exact provenance without ignored files, history or other descendants",
  (t) => {
    const { source, options } = fixture(t);
    const revision = git(source, ["rev-parse", "HEAD"]);
    writeFileSync(join(source, "uncommitted.txt"), "must not be exported");
    const result = createProject(options);
    const origin = readOrigin(result.path);
    assert.equal(origin.template.revision, revision);
    assert.equal(origin.setup, "pending");
    assert.equal(
      JSON.parse(readFileSync(join(result.path, "package.json"), "utf8")).name,
      "sample",
    );
    assert.equal(git(result.path, ["rev-list", "--count", "HEAD"]), "1");
    assert.equal(git(result.path, ["status", "--porcelain"]), "");
    for (const file of [".env.local", "uncommitted.txt", ".template"])
      assert.equal(existsSync(join(result.path, file)), false);
    assert.equal(projectRecords(source)[0].id, origin.id);
    assert.equal(projectRecords(source)[0].repository, null);
    assert.equal(origin.files[ORIGIN_FILE], undefined);
    assert.match(origin.files["packages/auth/src/index.ts"], /^[a-f0-9]{64}$/);
    assert.equal(
      git(source, ["ls-files", "--others", "--exclude-standard", ".template/local"]),
      "",
    );
  },
);

await run(
  "impact distinguishes customizations, deletions and new files and follows current consumers",
  (t) => {
    const { source, options } = fixture(t);
    const project = createProject(options);
    const changed = "packages/auth/src/index.ts";
    writeFileSync(join(source, changed), "export const value = 2;\n");
    let report = projectImpact(source).projects[0];
    assert.deepEqual(report.changes, [{ path: changed, state: "unchanged" }]);
    assert.deepEqual(report.manifestDependents.map((member) => member.path).toSorted(), [
      "apps/web",
      "packages/auth",
    ]);
    writeFileSync(join(project.path, changed), "export const value = 3;\n");
    assert.equal(projectImpact(source).projects[0].changes[0].state, "modified");
    rmSync(join(project.path, changed));
    assert.equal(projectImpact(source).projects[0].changes[0].state, "deleted");
    writeFileSync(join(source, "new.txt"), "new feature");
    report = projectImpact(source).projects[0];
    assert.equal(report.changes.find(({ path }) => path === "new.txt").state, "new-in-template");
    writeFileSync(join(project.path, "new.txt"), "project already owns it");
    assert.equal(
      projectImpact(source).projects[0].changes.find(({ path }) => path === "new.txt").state,
      "project-only",
    );
    assert.equal(projectImpact(source, { to: "HEAD" }).projects[0].changes.length, 0);
    assert.throws(() => projectImpact(source, { from: "missing-revision" }));
  },
);

await run(
  "registration refreshes moved checkouts and remote URLs without duplicating projects",
  (t) => {
    const { root, source, options } = fixture(t);
    const project = createProject(options);
    const moved = join(root, "moved");
    renameSync(project.path, moved);
    assert.equal(projectImpact(source).projects[0].status, "unavailable");
    git(moved, ["remote", "add", "origin", "https://example.test/sample.git"]);
    registerProject(source, moved);
    registerProject(source, moved);
    assert.equal(projectRecords(source).length, 1);
    assert.equal(projectRecords(source)[0].repository, "https://example.test/sample.git");
    assert.equal(projectRecords(source)[0].path, moved);
    assert.equal(projectImpact(source).projects[0].status, "available");
    const origin = readOrigin(moved);
    origin.id = randomUUID();
    writeJson(join(moved, ORIGIN_FILE), origin);
    assert.equal(projectImpact(source).projects[0].status, "unknown");
  },
);

await run("planning is read only and creation refuses invalid or existing destinations", (t) => {
  const { source, options } = fixture(t);
  assert.equal(planProject(options).name, "sample");
  assert.equal(existsSync(options.destination), false);
  assert.equal(projectRecords(source).length, 0);
  assert.throws(() => planProject({ ...options, name: "../escape" }), /name must/);
  assert.throws(() => planProject({ ...options, destination: join(source, "child") }), /outside/);
  mkdirSync(options.destination);
  writeFileSync(join(options.destination, "keep.txt"), "keep");
  assert.throws(() => createProject(options), /already exists/);
  assert.equal(readFileSync(join(options.destination, "keep.txt"), "utf8"), "keep");
});

await run("failed generation removes only its reservation and records no descendant", (t) => {
  const { source, options } = fixture(t);
  writeFileSync(
    join(source, "scripts/rename-template.sh"),
    'if [[ "$1" == "--validate" ]]; then exit 0; fi\nexit 42\n',
  );
  git(source, ["add", "."]);
  git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "test: fail generation"]);
  assert.throws(() => createProject(options), /creation failed/);
  assert.equal(existsSync(options.destination), false);
  assert.equal(projectRecords(source).length, 0);
});

await run(
  "origin corruption and a changed birth revision cannot be accepted by registration",
  (t) => {
    const { source, options } = fixture(t);
    const project = createProject(options);
    const original = readOrigin(project.path);
    const altered = structuredClone(original);
    altered.files["packages/auth/src/index.ts"] = "invalid";
    writeJson(join(project.path, ORIGIN_FILE), altered);
    assert.equal(projectImpact(source).projects[0].status, "unknown");
    assert.throws(() => registerProject(source, project.path), /Invalid inherited file hash/);
    altered.files = {};
    writeJson(join(project.path, ORIGIN_FILE), altered);
    assert.throws(() => registerProject(source, project.path), /Invalid project origin/);
    writeFileSync(join(source, "next.txt"), "next");
    git(source, ["add", "."]);
    git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "test: next revision"]);
    altered.files = original.files;
    altered.template.revision = git(source, ["rev-parse", "HEAD"]);
    writeJson(join(project.path, ORIGIN_FILE), altered);
    assert.throws(() => registerProject(source, project.path), /immutable/);
    assert.equal(projectRecords(source)[0].templateRevision, original.template.revision);
  },
);

await run(
  "mode changes are customizations and registration requires the actual repository root",
  (t) => {
    const { source, options } = fixture(t);
    const project = createProject(options);
    const file = "packages/auth/src/index.ts";
    writeFileSync(join(source, file), "new template code");
    chmodSync(join(project.path, file), 0o755);
    assert.equal(projectImpact(source).projects[0].changes[0].state, "modified");
    const nested = join(project.path, "nested");
    mkdirSync(nested);
    cpSync(join(project.path, ORIGIN_FILE), join(nested, ORIGIN_FILE));
    assert.throws(() => registerProject(source, nested), /repository root/);
    git(project.path, [
      "remote",
      "add",
      "origin",
      "https://user:password@example.test/sample.git?token=secret",
    ]);
    assert.equal(
      registerProject(source, project.path).repository,
      "https://example.test/sample.git",
    );
  },
);

await run("CLI dry run and JSON impact preserve a destination containing spaces", (t) => {
  const { root, source } = fixture(t);
  const parent = join(root, "parent with spaces");
  const cli = (args) =>
    spawnSync(process.execPath, [join(source, "scripts/projects.mjs"), ...args], {
      encoding: "utf8",
    });
  const args = ["create", "sample", "--dest", parent, "--org", "sample-org", "--no-install"];
  const plan = cli([...args, "--dry-run"]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).destination, join(parent, "sample"));
  assert.equal(existsSync(parent), false);
  const created = cli(args);
  assert.equal(created.status, 0, created.stderr);
  const impact = cli(["impact", "--json"]);
  assert.equal(impact.status, 0, impact.stderr);
  const report = JSON.parse(impact.stdout);
  assert.equal(report.projects.length, 1);
  assert.equal(report.projects[0].status, "available");
  assert.equal(report.projects[0].changes.length, 0);
  assert.deepEqual(
    JSON.parse(cli(["list", "--json"]).stdout).map(({ name }) => name),
    ["sample"],
  );
});

await run("destination aliases are rejected before creating any directories in the source", (t) => {
  const { root, source, options } = fixture(t);
  const alias = join(root, "alias");
  symlinkSync(source, alias, "dir");
  assert.throws(
    () => createProject({ ...options, destination: join(alias, "nested", "project") }),
    /outside/,
  );
  assert.equal(existsSync(join(source, "nested")), false);
});

await run("concurrent creators cannot replace a reserved destination", async (t) => {
  const { root, source } = fixture(t);
  const args = [
    join(source, "scripts/projects.mjs"),
    "create",
    "shared",
    "--dest",
    root,
    "--org",
    "sample-org",
    "--no-install",
  ];
  const create = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", resolve);
    });
  const results = await Promise.all([create(), create()]);
  assert.deepEqual(new Set(results), new Set([0, 1]));
  assert.equal(projectRecords(source).length, 1);
  assert.equal(git(join(root, "shared"), ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(readOrigin(join(root, "shared")).name, "shared");
});

await run("dangling symlinks retain their provenance and can be compared", (t) => {
  const { source, options } = fixture(t);
  symlinkSync("missing-original", join(source, "shortcut"));
  git(source, ["add", "."]);
  git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "test: add inherited symlink"]);
  const project = createProject(options);
  assert.match(readOrigin(project.path).files.shortcut, /^[a-f0-9]{64}$/);
  rmSync(join(source, "shortcut"));
  symlinkSync("missing-next", join(source, "shortcut"));
  assert.equal(projectImpact(source).projects[0].changes[0].state, "unchanged");
  rmSync(join(project.path, "shortcut"));
  symlinkSync("custom-target", join(project.path, "shortcut"));
  assert.equal(projectImpact(source).projects[0].changes[0].state, "modified");
});
