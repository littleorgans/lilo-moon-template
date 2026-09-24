// root:release-rehearsal. The publish half of release.yml, run end to end against a local Verdaccio
// in Docker with the npm release.yml pins: pack, scan, a tarball changed after the scan, a publish
// that fails partway, the rerun that completes it, a rerun with nothing left to do, and the smoke.
// The package scope resolves to the local registry for every npm command here, and that is checked
// before anything is published, so nothing reaches the public registry.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

import { dockerIsAvailable } from "@littleorgans/db-tools";

import { integrityOf, publishOrder, readReleaseTarballs } from "./lib/release-tarballs.mjs";

// verdaccio/verdaccio 6.10.4, pinned by the digest of its multi-platform index.
const IMAGE =
  "verdaccio/verdaccio@sha256:43c4067288b050422265407ea2fe747e511fcd0c407a85ec90ab9a326d9400cd";

const release = resolve("scripts/release.mjs");
const say = (message) => process.stdout.write(`release-rehearsal: ${message}\n`);
const newTags = (output) =>
  output.split("\n").flatMap((line) => /^New tag: (\S+)$/.exec(line)?.[1] ?? []);

if (!process.env.CI && !dockerIsAvailable()) {
  say("skipped locally: Docker is unavailable.");
  process.exit(0);
}

const npmPin = /npm install --global npm@(\S+)/.exec(
  readFileSync(".github/workflows/release.yml", "utf8"),
)?.[1];
assert.ok(npmPin, "release.yml must pin the npm it publishes with");

const scratch = mkdtempSync(join(tmpdir(), "release-rehearsal-"));
const container = `release-rehearsal-${process.pid}`;

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function startRegistry() {
  const config = join(scratch, "config.yaml");
  writeFileSync(
    config,
    `storage: /verdaccio/storage/data
auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
packages:
  "**":
    access: $all
    publish: $authenticated
max_body_size: 100mb
server: { keepAliveTimeout: 60 }
log: { type: stdout, format: pretty, level: warn }
`,
  );
  docker(["create", "--name", container, "--publish", "127.0.0.1::4873", IMAGE]);
  docker(["cp", config, `${container}:/verdaccio/conf/config.yaml`]);
  docker(["start", container]);
  const port = docker(["port", container, "4873/tcp"]).trim().split(":").at(-1);
  const registry = `http://127.0.0.1:${port}/`;
  const ready = async (attempts) => {
    try {
      const response = await fetch(`${registry}-/ping`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch (error) {
      if (attempts === 0) throw error;
    }
    assert.ok(attempts > 0, "Verdaccio did not answer /-/ping");
    await setTimeout(250);
    await ready(attempts - 1);
  };
  await ready(120);
  // Verdaccio's htpasswd plugin registers a user on first PUT and returns a bearer token.
  const response = await fetch(`${registry}-/user/org.couchdb.user:rehearsal`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ name: "rehearsal", password: "rehearsal-password" }),
  });
  assert.equal(response.status, 201, "Verdaccio must register the rehearsal user");
  const { token } = await response.json();
  assert.ok(token, "Verdaccio returned no token");
  return { registry, token };
}

try {
  const { registry, token } = await startRegistry();
  say(`Verdaccio ${IMAGE} at ${registry}`);

  // npm pinned as release.yml pins it, first on PATH.
  const prefix = join(scratch, "npm");
  execFileSync("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", `npm@${npmPin}`], {
    stdio: "inherit",
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  const bin = join(prefix, "node_modules/.bin");

  // The scope goes to Verdaccio, and the token reaches npm the way setup-node passes it in CI.
  // Third-party packages the smoke installs still come from the default registry.
  const packed = join(scratch, "release");
  execFileSync(process.execPath, [release, "pack", packed], { stdio: "inherit" });
  const tarballs = readReleaseTarballs(packed);
  const scope = tarballs[0].name.split("/")[0];
  assert.ok(tarballs.every(({ name }) => name.startsWith(`${scope}/`)));
  const userconfig = join(scratch, "npmrc");
  writeFileSync(
    userconfig,
    `${scope}:registry=${registry}\n${registry.replace(/^http:/, "")}:_authToken=\${NODE_AUTH_TOKEN}\n`,
  );
  const globalconfig = join(scratch, "npmrc-global");
  writeFileSync(globalconfig, "");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    NPM_CONFIG_USERCONFIG: userconfig,
    NPM_CONFIG_GLOBALCONFIG: globalconfig,
    NPM_CONFIG_CACHE: join(scratch, "npm-cache"),
    NODE_AUTH_TOKEN: token,
  };
  const npm = (args) =>
    execFileSync("npm", args, {
      env,
      encoding: "utf8",
      timeout: 120_000,
      killSignal: "SIGKILL",
    }).trim();
  assert.equal(npm(["--version"]), npmPin);
  assert.equal(npm(["config", "get", `${scope}:registry`]), registry);
  say(`npm ${npmPin} resolves ${scope} to ${registry}`);

  const releaseCommand = (command, directory, extra = {}) => {
    const result = spawnSync(process.execPath, [release, command, directory], {
      env: { ...env, ...extra },
      encoding: "utf8",
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result;
  };
  const view = (name, version, field) => {
    const result = spawnSync(
      "npm",
      ["view", `${name}@${version}`, field, "--json", "--prefer-online"],
      {
        env,
        timeout: 120_000,
        killSignal: "SIGKILL",
        encoding: "utf8",
      },
    );
    if (result.error) throw result.error;
    return result.status === 0 ? JSON.parse(result.stdout) : undefined;
  };
  const onRegistry = () => tarballs.filter(({ name, version }) => view(name, version, "version"));

  execFileSync(process.execPath, ["scripts/check-packed-secrets.mjs", packed], {
    stdio: "inherit",
  });
  say(`the secrets scan read the ${tarballs.length} release tarballs`);

  // A tarball changed after the scan: nothing is uploaded, not even the untouched ones.
  const tampered = join(scratch, "tampered");
  cpSync(packed, tampered, { recursive: true });
  const victim = join(tampered, basename(tarballs[0].file));
  const unpacked = join(scratch, "unpacked");
  mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", victim, "-C", unpacked]);
  writeFileSync(join(unpacked, "package/dist/injected.js"), "export const injected = true;\n");
  execFileSync("tar", ["-czf", victim, "-C", unpacked, "package"]);
  const refused = releaseCommand("publish", tampered);
  assert.equal(refused.status, 1, "publish accepted a tarball changed after the scan");
  assert.match(refused.stderr, /changed after it was packed and scanned/);
  assert.deepEqual(onRegistry(), [], "a refused release uploaded something");
  say(`negative proof: a tarball changed after the scan, exit ${refused.status}, nothing uploaded`);

  // The fourth upload fails, as a network error would. The npm shim fails only that publish.
  const order = publishOrder(tarballs);
  const failing = order[3];
  const shim = join(scratch, "shim");
  mkdirSync(shim);
  writeFileSync(
    join(shim, "npm"),
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "publish" && args[1] === ${JSON.stringify(failing.file)}) {
  console.error("npm error code ECONNRESET (rehearsal)");
  process.exit(1);
}
process.exit(spawnSync(${JSON.stringify(join(bin, "npm"))}, args, { stdio: "inherit" }).status ?? 1);
`,
  );
  chmodSync(join(shim, "npm"), 0o755);
  const partial = releaseCommand("publish", packed, { PATH: `${shim}:${env.PATH}` });
  assert.equal(partial.status, 1, "a failed upload must fail the publish");
  const first = newTags(partial.stdout);
  assert.deepEqual(
    first,
    order.slice(0, 3).map(({ name, version }) => `${name}@${version}`),
  );
  assert.deepEqual(
    onRegistry().map(({ name }) => name),
    order
      .slice(0, 3)
      .map(({ name }) => name)
      .toSorted((a, b) => a.localeCompare(b)),
  );
  say(`partial failure at ${failing.name}: exit 1 after ${first.length} uploads`);

  // Rerunning completes the release, skipping what is already up.
  const completed = releaseCommand("publish", packed);
  assert.equal(completed.status, 0, "the rerun must complete the release");
  const skipped = completed.stdout.match(/already published with these bytes; skipped/g) ?? [];
  assert.equal(skipped.length, 3);
  const second = newTags(completed.stdout);
  assert.deepEqual(
    second,
    order.slice(3).map(({ name, version }) => `${name}@${version}`),
  );
  say(`rerun: ${skipped.length} skipped, ${second.length} published, "New tag:" for each`);

  // Every upload followed the packages it depends on.
  const position = new Map(order.map(({ name }, index) => [name, index]));
  for (const { file, name } of order) {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }),
    );
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      if (position.has(dependency)) assert.ok(position.get(dependency) < position.get(name));
    }
  }

  // The registry's bytes are the scanned bytes: its recorded integrity, and the tarball it serves.
  const served = join(scratch, "served");
  mkdirSync(served);
  for (const { name, version, integrity } of tarballs) {
    assert.equal(view(name, version, "dist.integrity"), integrity, `${name} dist.integrity`);
    const file = npm(["pack", `${name}@${version}`, "--pack-destination", served, "--json"]);
    const [{ filename }] = JSON.parse(file);
    assert.equal(integrityOf(join(served, filename)), integrity, `${name} served tarball`);
  }
  say(`all ${tarballs.length} served tarballs and dist.integrity equal the scanned files' sha512`);

  const idle = releaseCommand("publish", packed);
  assert.equal(idle.status, 0);
  assert.deepEqual(newTags(idle.stdout), []);
  assert.equal(
    (idle.stdout.match(/already published with these bytes; skipped/g) ?? []).length,
    tarballs.length,
  );
  say(`a third run skipped all ${tarballs.length} and tagged nothing`);

  const smoke = releaseCommand("smoke", packed);
  assert.equal(smoke.status, 0, "the smoke must pass against the registry");
  say("the smoke installed, typechecked and imported every entry point from the registry");
  // Tags and the release on a scratch clone with a local bare origin; a stub gh records the release.
  // GH_REPO names a host that does not resolve, so no gh call could reach GitHub.
  const repository = join(scratch, "repository");
  const origin = join(scratch, "origin.git");
  const git = (args, cwd = repository) =>
    execFileSync("git", args, { cwd, env: tagEnv, encoding: "utf8" }).trim();
  const tagEnv = {
    ...env,
    PATH: `${join(scratch, "gh")}:${env.PATH}`,
    GH_REPO: "rehearsal.invalid/none/none",
    GIT_AUTHOR_NAME: "Release rehearsal",
    GIT_AUTHOR_EMAIL: "rehearsal@example.invalid",
    GIT_COMMITTER_NAME: "Release rehearsal",
    GIT_COMMITTER_EMAIL: "rehearsal@example.invalid",
  };
  const version = tarballs[0].version;
  for (const { name } of tarballs) {
    const directory = join(repository, "packages", name.split("/")[1]);
    mkdirSync(directory, { recursive: true });
    cpSync(join("packages", name.split("/")[1], "package.json"), join(directory, "package.json"));
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      `# ${name}\n\n## ${version}\n\n### Minor Changes\n\n- ${name} rehearsal notes\n`,
    );
  }
  git(["init", "--quiet", "--bare", origin], scratch);
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "release"]);
  git(["remote", "add", "origin", origin]);
  const releases = join(scratch, "releases");
  mkdirSync(releases);
  mkdirSync(join(scratch, "gh"));
  writeFileSync(
    join(scratch, "gh", "gh"),
    `#!/usr/bin/env node
const { appendFileSync, copyFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const file = join(${JSON.stringify(releases)}, encodeURIComponent(args[2]));
if (args[1] === "view") {
  if (existsSync(file + ".md")) process.exit(0);
  console.error("release not found");
  process.exit(1);
}
if (args[1] === "create") {
  copyFileSync(args[args.indexOf("--notes-file") + 1], file + ".md");
  appendFileSync(${JSON.stringify(join(releases, "calls.log"))}, JSON.stringify(args) + "\\n");
  process.exit(0);
}
process.exit(64);
`,
  );
  chmodSync(join(scratch, "gh", "gh"), 0o755);
  const tagRun = () => {
    const result = spawnSync(process.execPath, [release, "tag", packed], {
      cwd: repository,
      env: tagEnv,
      encoding: "utf8",
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    assert.equal(result.status, 0, "tag must succeed");
    return result.stdout;
  };
  tagRun();
  const head = git(["rev-parse", "HEAD"]);
  const expectedTags = [...tarballs.map(({ name }) => `${name}@${version}`), `v${version}`];
  assert.deepEqual(
    git(["tag", "-l"], origin)
      .split("\n")
      .toSorted((a, b) => a.localeCompare(b)),
    expectedTags.toSorted((a, b) => a.localeCompare(b)),
  );
  for (const tag of expectedTags) {
    assert.equal(git(["cat-file", "-t", `refs/tags/${tag}`], origin), "tag", tag);
    assert.equal(git(["rev-parse", `refs/tags/${tag}^{commit}`], origin), head, tag);
  }
  const calls = readFileSync(join(releases, "calls.log"), "utf8").trim().split("\n");
  assert.equal(calls.length, 1, "one GitHub release for the version");
  assert.equal(JSON.parse(calls[0])[2], `v${version}`);
  const notes = readFileSync(join(releases, `v${version}.md`), "utf8");
  for (const { name } of tarballs) assert.ok(notes.includes(`## ${name}\n`), name);
  const rerun = tagRun();
  assert.doesNotMatch(rerun, /pushed tag|created GitHub release/);
  assert.equal(readFileSync(join(releases, "calls.log"), "utf8").trim().split("\n").length, 1);
  say(
    `tag: ${expectedTags.length - 1} package tags and v${version} on ${head.slice(0, 12)}, one release; a rerun changed nothing`,
  );
  say("passed.");
} finally {
  spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  rmSync(scratch, { recursive: true, force: true });
}
