// The publish half of .github/workflows/release.yml, one step per subcommand. `pack` packs every
// published package once into a directory and records each tarball's sha512. The release gate scans
// and shape-checks those files. `publish` uploads the same files, `tag` creates the git tags and the
// GitHub release, and `smoke` installs what the registry then serves. Every subcommand after `pack`
// refuses a tarball whose bytes differ from the record. docs/releasing.md describes the flow.

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

import {
  CONSUMER_TYPESCRIPT,
  consumerCompilerOptions,
  entriesModule,
  entryPoints,
  typecheckConsumer,
} from "./lib/package-entries.mjs";
import { writeJson } from "./lib/project-files.mjs";
import { publishedPackages } from "./lib/published-packages.mjs";
import {
  RELEASE_MANIFEST,
  changelogEntry,
  integrityOf,
  packedManifest,
  publishOrder,
  readReleaseTarballs,
} from "./lib/release-tarballs.mjs";

const log = (message) => process.stdout.write(`${message}\n`);

function pack(directory) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).length > 0) {
    throw new Error(`Release: ${root} is not empty; pack into a fresh directory`);
  }
  const packages = publishedPackages();
  if (packages.length === 0) throw new Error("Release: no published packages found");
  const records = packages.map(({ directory: source, manifest }) => {
    const file = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
    try {
      execFileSync("pnpm", ["pack", "--out", join(root, file)], {
        cwd: source,
        // Lifecycle scripts can echo credentials, including on failure. Never forward their
        // output or the child-process error (which also contains the captured output).
        stdio: "ignore",
      });
    } catch {
      throw new Error(
        `Release: pack failed in ${source}; output suppressed. Run \`pnpm pack\` there to see why.`,
      );
    }
    const record = {
      name: manifest.name,
      version: manifest.version,
      file,
      integrity: integrityOf(join(root, file)),
    };
    log(`Release: packed ${record.name}@${record.version} ${record.integrity}`);
    return record;
  });
  writeJson(join(root, RELEASE_MANIFEST), { packages: records });
}

/**
 * The integrity the registry records for `name@version`, or undefined when it has no such version.
 * Any failure other than a 404 throws, so an unreachable registry never reads as "unpublished".
 */
function registryIntegrity(name, version) {
  const result = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "dist.integrity", "--json", "--prefer-online"],
    { encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL" },
  );
  if (result.error) throw result.error;
  const output = result.stdout.trim();
  if (result.status === 0) return output === "" ? undefined : JSON.parse(output);
  let code;
  try {
    code = JSON.parse(output).error?.code;
  } catch {
    // Not npm's JSON error; fall through and report the raw failure.
  }
  if (code === "E404") return undefined;
  throw new Error(`Release: npm view ${name}@${version} failed:\n${result.stderr}`);
}

function publish(directory) {
  const tarballs = publishOrder(readReleaseTarballs(directory));
  log(`Release: publish order ${tarballs.map(({ name }) => name).join(", ")}`);
  for (const { name, version, file, integrity } of tarballs) {
    const published = registryIntegrity(name, version);
    if (published === integrity) {
      log(`Release: ${name}@${version} is already published with these bytes; skipped`);
      continue;
    }
    if (published !== undefined) {
      throw new Error(
        `Release: the registry holds ${name}@${version} as ${published}, not this release's ${integrity}. A version cannot be republished; release a new one.`,
      );
    }
    // npm reads the registry, the token and provenance from its configuration. A tarball spec runs
    // no lifecycle scripts, so these bytes are exactly what the registry receives.
    const result = spawnSync("npm", ["publish", file, "--access", "public", "--ignore-scripts"], {
      stdio: "inherit",
      timeout: 120_000,
      killSignal: "SIGKILL",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Release: npm publish ${name}@${version} exited ${result.status}. Rerunning publishes the rest and skips what is already up.`,
      );
    }
    // The line `changeset publish` prints for each new version, kept for anyone reading the log that
    // way. `tag` creates the tags and the release.
    log(`New tag: ${name}@${version}`);
  }
}

/** Runs `command`, returning its result without throwing, for commands whose failure is data. */
const probe = (command, args) => spawnSync(command, args, { encoding: "utf8" });

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

/**
 * An annotated tag on `commit`, pushed to origin, as `changeset publish` creates it. A tag already on
 * origin is kept if it points at `commit` and refused otherwise, so a rerun completes a partial run
 * and never moves a released tag.
 */
function checkTag(tagName, commit) {
  const remote = run("git", [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tagName}^{}`,
    `refs/tags/${tagName}`,
  ]);
  if (remote !== "") {
    const lines = remote.split("\n").map((line) => line.split("\t"));
    const [tagged] = lines.find(([, ref]) => ref.endsWith("^{}")) ?? lines[0];
    if (tagged !== commit) {
      throw new Error(
        `Release: tag ${tagName} on origin points at ${tagged}, not the released ${commit}`,
      );
    }
    return true;
  }
  const local = probe("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tagName}`]);
  if (local.status === 0 && run("git", ["rev-parse", `refs/tags/${tagName}^{commit}`]) !== commit) {
    throw new Error(`Release: local tag ${tagName} does not point at the released ${commit}`);
  }
  return false;
}

function pushTag(tagName, commit) {
  if (checkTag(tagName, commit)) {
    log(`Release: tag ${tagName} exists on origin; kept`);
    return;
  }
  const local = probe("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tagName}`]);
  if (local.status !== 0) run("git", ["tag", tagName, "-m", tagName, commit]);
  run("git", ["push", "origin", `refs/tags/${tagName}`]);
  log(`Release: pushed tag ${tagName}`);
}

// Run before the first upload, and again before tagging. A later main commit cannot continue a
// partially tagged release and publish more packages before discovering the conflicting tags.
function preflight(directory) {
  const tarballs = publishOrder(readReleaseTarballs(directory));
  const expected = publishedPackages()
    .map(({ manifest }) => `${manifest.name}@${manifest.version}`)
    .toSorted();
  const actual = tarballs.map(({ name, version }) => `${name}@${version}`).toSorted();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Release: tarballs do not match all published workspace packages");
  }
  const versions = [...new Set(tarballs.map(({ version }) => version))];
  if (versions.length !== 1) throw new Error("Release: packages must share one version (D3)");
  const head = run("git", ["rev-parse", "HEAD"]);
  for (const tagName of [...actual, `v${versions[0]}`]) checkTag(tagName, head);
}

/**
 * Tags the released commit: `<name>@<version>` for each package, as Changesets does, and `v<version>`
 * for the repository, which the adoption guides clone and fetch files at. The packages share one
 * version (D3), so one GitHub release on `v<version>` carries every package's CHANGELOG entry,
 * rather than one release per package. Existing tags and the release are kept, so a rerun completes
 * a partial run.
 */
function tag(directory) {
  const tarballs = readReleaseTarballs(directory);
  const versions = [...new Set(tarballs.map(({ version }) => version))];
  if (versions.length !== 1) {
    throw new Error(
      `Release: the packages must share one version (D3), found ${versions.join(", ")}`,
    );
  }
  const [version] = versions;
  const sources = new Map(
    publishedPackages().map(({ directory: source, manifest }) => [manifest.name, source]),
  );
  // Every entry is read before anything is pushed, so a missing one leaves no tag behind.
  const notes = tarballs.map(({ name }) => {
    const source = sources.get(name);
    if (source === undefined) throw new Error(`Release: ${name} is not a workspace package`);
    const changelog = join(source, "CHANGELOG.md");
    const entry = existsSync(changelog)
      ? changelogEntry(readFileSync(changelog, "utf8"), version)
      : undefined;
    if (entry === undefined) throw new Error(`Release: ${changelog} has no entry for ${version}`);
    return `## ${name}\n\n${entry}`;
  });
  const head = run("git", ["rev-parse", "HEAD"]);
  preflight(directory);
  for (const { name } of tarballs) pushTag(`${name}@${version}`, head);
  const repositoryTag = `v${version}`;
  pushTag(repositoryTag, head);

  const existing = probe("gh", ["release", "view", repositoryTag, "--json", "tagName"]);
  if (existing.status === 0) {
    log(`Release: GitHub release ${repositoryTag} exists; kept`);
    return;
  }
  if (!/release not found/i.test(existing.stderr)) {
    throw new Error(`Release: gh release view ${repositoryTag} failed:\n${existing.stderr}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "release-notes-"));
  try {
    const notesFile = join(scratch, "notes.md");
    writeFileSync(notesFile, `${notes.join("\n\n")}\n`);
    run("gh", [
      "release",
      "create",
      repositoryTag,
      "--verify-tag",
      "--title",
      repositoryTag,
      "--notes-file",
      notesFile,
      ...(version.includes("-") ? ["--prerelease"] : []),
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  log(`Release: created GitHub release ${repositoryTag}`);
}

/** Calls `attempt` until it returns true, waiting longer each time, for registry propagation. */
async function withBackoff(description, attempt, delays = [5, 10, 20, 40, 60, 60, 60, 60]) {
  if (attempt()) return;
  const [delay, ...rest] = delays;
  if (delay === undefined) throw new Error(`Release: ${description} did not succeed in time`);
  log(`Release: ${description} not yet; retrying in ${delay}s`);
  await setTimeout(delay * 1000);
  await withBackoff(description, attempt, rest);
}

// The workspace catalog's type packages, so the smoke consumer typechecks against the same majors
// the packages were built with, without installing the workspace.
function catalogRange(name) {
  const range = new RegExp(`^\\s+"${name}": "([^"]+)"$`, "m").exec(
    readFileSync("pnpm-workspace.yaml", "utf8"),
  )?.[1];
  if (range === undefined)
    throw new Error(`Release: pnpm-workspace.yaml has no ${name} catalog entry`);
  return range;
}

/**
 * A fresh consumer outside any workspace installs the released versions from the registry, then
 * typechecks with TypeScript 5 and imports every entry point, as root:published-shape does for
 * the tarballs before release.
 */
async function smoke(directory) {
  const tarballs = readReleaseTarballs(directory);
  await Promise.all(
    tarballs.map(async ({ name, version, integrity }) => {
      await withBackoff(`the registry serving ${name}@${version}`, () => {
        const served = registryIntegrity(name, version);
        if (served !== undefined && served !== integrity) {
          throw new Error(
            `Release: the registry serves ${name}@${version} as ${served}, not the released ${integrity}`,
          );
        }
        return served === integrity;
      });
      log(`Release: the registry serves ${name}@${version} with the released integrity`);
    }),
  );

  // npm leaves optional peers out. A consumer who imports the entry point that needs one, such as
  // auth-http's hono middleware, installs it, so the smoke does too, at the declared range.
  const names = new Set(tarballs.map(({ name }) => name));
  const optionalPeers = tarballs.flatMap(({ file }) => {
    const manifest = packedManifest(file);
    return Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([name, meta]) => meta.optional && !names.has(name))
      .map(([name]) => [name, manifest.peerDependencies[name]]);
  });
  const root = mkdtempSync(join(tmpdir(), "release-smoke-"));
  try {
    writeJson(join(root, "package.json"), {
      name: "release-smoke",
      private: true,
      type: "module",
      dependencies: {
        ...Object.fromEntries(tarballs.map(({ name, version }) => [name, version])),
        ...Object.fromEntries(optionalPeers),
        typescript: CONSUMER_TYPESCRIPT,
        ...Object.fromEntries(
          ["@types/node", "@types/react", "@types/react-dom"].map((name) => [
            name,
            catalogRange(name),
          ]),
        ),
      },
    });
    writeJson(join(root, "tsconfig.json"), {
      compilerOptions: consumerCompilerOptions,
      include: ["*.ts"],
    });
    await withBackoff("npm install of the released versions", () => {
      const result = spawnSync(
        "npm",
        ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-online"],
        { cwd: root, stdio: "inherit", timeout: 10 * 60_000, killSignal: "SIGKILL" },
      );
      return result.status === 0;
    });
    const entries = tarballs.flatMap(({ name, version }) => {
      const installed = entryPoints(join(root, "node_modules", name));
      if (installed.manifest.version !== version) {
        throw new Error(
          `Release: npm installed ${name}@${installed.manifest.version}, not ${version}`,
        );
      }
      return installed.entries;
    });
    const { modules, assets, source } = entriesModule(entries);
    writeFileSync(join(root, "entries.ts"), source);
    log(`Release: ${typecheckConsumer(root, process.env)}`);
    execFileSync(process.execPath, ["entries.ts"], { cwd: root, stdio: "inherit" });
    log(
      `Release: ${modules.length} module and ${assets.length} file entry points of ${tarballs.length} packages resolve from the registry`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The one version every published package shares (D3). release.yml releases while `v<version>` is
 * not on origin, so a completed release is not attempted again on the next push.
 */
function sharedVersion() {
  const versions = [...new Set(publishedPackages().map(({ manifest }) => manifest.version))];
  if (versions.length !== 1) {
    throw new Error(
      `Release: the packages must share one version (D3), found ${versions.join(", ")}`,
    );
  }
  log(versions[0]);
}

const commands = { pack, publish, preflight, tag, smoke, version: sharedVersion };
const [command, directory] = process.argv.slice(2);
if (!Object.hasOwn(commands, command) || (command !== "version" && directory === undefined)) {
  console.error(
    "Usage: node scripts/release.mjs <pack|publish|preflight|tag|smoke> <directory>, or node scripts/release.mjs version",
  );
  process.exit(2);
}
try {
  await commands[command](directory);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
