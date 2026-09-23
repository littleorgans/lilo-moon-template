import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createProject, planProject } from "../../lib/create-project.mjs";
import { git, initializeProject, writeJson } from "../../lib/project-files.mjs";
import {
  ORIGIN_FILE,
  projectRecords,
  readOrigin,
  registerProject,
} from "../../lib/project-registry.mjs";

process.env.GIT_AUTHOR_NAME = "Baseline verification";
process.env.GIT_AUTHOR_EMAIL = "baseline@example.invalid";
process.env.GIT_COMMITTER_NAME = process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_AUTHOR_EMAIL;

const producer = !existsSync(ORIGIN_FILE);
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
  git(source, ["remote", "add", "origin", source]);
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
  "creation preserves history and configures separate project and template remotes",
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
    assert.equal(git(result.path, ["rev-parse", "HEAD^"]), revision);
    assert.equal(git(result.path, ["remote", "get-url", "upstream"]), source);
    assert.equal(
      git(result.path, ["remote", "get-url", "origin"]),
      "git@github.com:sample-org/sample.git",
    );
    assert.equal(git(result.path, ["config", "branch.main.remote"]), "origin");
    assert.equal(git(result.path, ["status", "--porcelain"]), "");
    for (const file of [".env.local", "uncommitted.txt", ".git/objects/info/alternates"])
      assert.equal(existsSync(join(result.path, file)), false);
    assert.equal(projectRecords(source)[0].id, origin.id);
    assert.equal(projectRecords(source)[0].repository, "git@github.com:sample-org/sample.git");
    assert.equal(origin.files, undefined);
    assert.equal(
      git(source, ["ls-files", "--others", "--exclude-standard", ".template/local"]),
      "",
    );
  },
);

await run(
  "a customized project fetches and rebases a template update, then pushes to its own origin",
  (t) => {
    const { root, source, options } = fixture(t);
    const remote = join(root, "project.git");
    git(root, ["init", "--bare", "--initial-branch=main", remote]);
    const project = createProject({ ...options, remote });
    rmSync(join(project.path, "apps/web"), { recursive: true });
    writeFileSync(join(project.path, "product.txt"), "project feature");
    git(project.path, ["add", "."]);
    git(project.path, ["-c", "commit.gpgsign=false", "commit", "-m", "feat: customize project"]);
    writeFileSync(join(source, "packages/auth/src/index.ts"), "export const value = 2;\n");
    git(source, ["add", "."]);
    git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "fix: improve shared auth"]);
    const update = git(source, ["rev-parse", "HEAD"]);
    git(project.path, ["fetch", "upstream"]);
    git(project.path, [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "rebase",
      "upstream/main",
    ]);
    assert.equal(git(project.path, ["merge-base", "HEAD", "upstream/main"]), update);
    assert.equal(
      readFileSync(join(project.path, "packages/auth/src/index.ts"), "utf8"),
      "export const value = 2;\n",
    );
    assert.equal(existsSync(join(project.path, "apps/web")), false);
    assert.equal(readFileSync(join(project.path, "product.txt"), "utf8"), "project feature");
    assert.equal(
      JSON.parse(readFileSync(join(project.path, "package.json"), "utf8")).name,
      "sample",
    );
    assert.equal(git(project.path, ["status", "--porcelain"]), "");
    git(project.path, ["push", "-u", "origin", "main"]);
    assert.equal(git(remote, ["rev-parse", "main"]), git(project.path, ["rev-parse", "HEAD"]));
    assert.equal(git(source, ["rev-parse", "HEAD"]), update);
  },
);

await run(
  "registration refreshes moved checkouts and remote URLs without duplicating projects",
  (t) => {
    const { root, source, options } = fixture(t);
    const project = createProject(options);
    const moved = join(root, "moved");
    renameSync(project.path, moved);
    assert.equal(existsSync(projectRecords(source)[0].path), false);
    git(moved, ["remote", "set-url", "origin", "https://example.test/sample.git"]);
    registerProject(source, moved);
    registerProject(source, moved);
    assert.equal(projectRecords(source).length, 1);
    assert.equal(projectRecords(source)[0].repository, "https://example.test/sample.git");
    assert.equal(projectRecords(source)[0].path, moved);
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
    altered.template.revision = "invalid";
    writeJson(join(project.path, ORIGIN_FILE), altered);
    assert.throws(() => registerProject(source, project.path), /Invalid project origin/);
    writeFileSync(join(source, "next.txt"), "next");
    git(source, ["add", "."]);
    git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "test: next revision"]);
    altered.template.revision = git(source, ["rev-parse", "HEAD"]);
    writeJson(join(project.path, ORIGIN_FILE), altered);
    assert.throws(() => registerProject(source, project.path), /immutable/);
    assert.equal(projectRecords(source)[0].templateRevision, original.template.revision);
  },
);

await run("registration requires the repository root and omits remote credentials", (t) => {
  const { source, options } = fixture(t);
  const project = createProject(options);
  const nested = join(project.path, "nested");
  mkdirSync(nested);
  cpSync(join(project.path, ORIGIN_FILE), join(nested, ORIGIN_FILE));
  assert.throws(() => registerProject(source, nested), /repository root/);
  git(project.path, [
    "remote",
    "set-url",
    "origin",
    "https://user:password@example.test/sample.git?token=secret",
  ]);
  assert.equal(registerProject(source, project.path).repository, "https://example.test/sample.git");
});

await run("CLI dry run and consumer list preserve a destination containing spaces", (t) => {
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
  const listing = cli(["list"]);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /git@github.com:sample-org\/sample.git/);
  assert.ok(listing.stdout.includes(join(parent, "sample")));
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
  assert.equal(
    git(join(root, "shared"), ["rev-parse", "HEAD^"]),
    git(source, ["rev-parse", "HEAD"]),
  );
  assert.equal(readOrigin(join(root, "shared")).name, "shared");
});

await run("creation preserves dangling symlinks from the committed tree", (t) => {
  const { source, options } = fixture(t);
  symlinkSync("missing-original", join(source, "shortcut"));
  git(source, ["add", "."]);
  git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "test: add inherited symlink"]);
  const project = createProject(options);
  assert.equal(readlinkSync(join(project.path, "shortcut")), "missing-original");
});

await run(
  "a selected older revision retains its ancestry independently of the source checkout",
  (t) => {
    const { source, options } = fixture(t);
    const revision = git(source, ["rev-parse", "HEAD"]);
    writeFileSync(join(source, "later.txt"), "later baseline");
    git(source, ["add", "."]);
    git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "feat: later baseline"]);
    const project = createProject({ ...options, ref: revision });
    assert.equal(git(project.path, ["rev-parse", "HEAD^"]), revision);
    assert.equal(existsSync(join(project.path, "later.txt")), false);
    rmSync(source, { recursive: true });
    assert.equal(git(project.path, ["rev-parse", "HEAD^"]), revision);
    assert.equal(
      git(project.path, ["show", `${revision}:packages/auth/src/index.ts`]),
      "export const value = 1;",
    );
  },
);

await run(
  "planning rejects missing upstream, shallow history and a product used as the template",
  (t) => {
    const { root, source, options } = fixture(t);
    assert.throws(() => planProject({ ...options, remote: source }), /distinct/);
    git(source, ["remote", "remove", "origin"]);
    assert.throws(() => planProject(options), /origin remote/);
    git(source, ["remote", "add", "origin", source]);
    const shallow = join(root, "shallow");
    git(root, ["clone", "--depth", "1", `file://${source}`, shallow]);
    assert.throws(() => planProject({ ...options, source: shallow }), /full template history/);
    const project = createProject(options);
    assert.throws(
      () => planProject({ ...options, source: project.path, destination: join(root, "another") }),
      /upstream template checkout/,
    );
  },
);
