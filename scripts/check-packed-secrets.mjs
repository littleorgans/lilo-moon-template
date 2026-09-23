import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { cli, run } from "secretlint/cli";

import { publishedPackages } from "./lib/published-packages.mjs";
import { readReleaseTarballs } from "./lib/release-tarballs.mjs";

// root:secrets scans the source tree, and both .gitignore and .secretlintignore exclude dist. The
// tarballs npm receives are mostly dist, and a build can inline a value the sources never held.
// This scans what npm would upload, with no ignore file in the way. Given a release directory from
// `node scripts/release.mjs pack`, it scans those tarballs, the files the release publishes.
// Otherwise it packs every published package itself.
const releaseDirectory = process.argv[2];
const release = releaseDirectory === undefined ? undefined : readReleaseTarballs(releaseDirectory);
const packages = publishedPackages();
if (release === undefined && packages.length === 0) {
  console.error("Packed secrets: no published packages found");
  process.exit(1);
}

const secretlintrc = resolve(".secretlintrc.json");
const workspace = realpathSync(mkdtempSync(join(tmpdir(), "packed-secrets-")));
try {
  if (release !== undefined) {
    for (const { file } of release) copyFileSync(file, join(workspace, basename(file)));
  }
  for (const { directory } of release === undefined ? packages : []) {
    try {
      execFileSync("pnpm", ["pack", "--pack-destination", workspace], {
        cwd: directory,
        // Lifecycle scripts can echo credentials, including on failure. Never forward their
        // output or the child-process error (which also contains the captured output).
        stdio: "ignore",
      });
    } catch {
      throw new Error(
        `Packed secrets: pack failed in ${directory}; output suppressed. Run \`pnpm pack\` there to see why.`,
      );
    }
  }

  const tarballs = readdirSync(workspace).filter((name) => name.endsWith(".tgz"));
  const expected = release?.length ?? packages.length;
  if (tarballs.length !== expected) {
    throw new Error(`Packed secrets: expected ${expected} tarballs, found ${tarballs.length}`);
  }
  for (const tarball of tarballs) {
    const target = join(workspace, tarball.slice(0, -".tgz".length));
    mkdirSync(target);
    try {
      execFileSync("tar", ["-xzf", join(workspace, tarball), "-C", target], {
        stdio: "ignore",
      });
    } catch {
      throw new Error("Packed secrets: extraction failed; output suppressed");
    }
  }

  const result = await run(["**/*", "**/.*", "**/.*/**/*"], {
    ...cli.flags,
    cwd: workspace,
    secretlintrc,
    secretlintignore: undefined,
    gitignore: false,
    maskSecrets: true,
  });
  if (result.stdout !== null) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== null) {
    console.error(result.stderr);
  }
  process.exitCode = result.exitStatus;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
