import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { cli, run } from "secretlint/cli";

import { publishedPackages } from "./lib/published-packages.mjs";

// root:secrets scans the source tree, and both .gitignore and .secretlintignore exclude dist. The
// tarballs npm receives are mostly dist, and a build can inline a value the sources never held.
// This packs every published package the way `changeset publish` does and scans what it would
// upload, with no ignore file in the way.
const packages = publishedPackages();
if (packages.length === 0) {
  console.error("Packed secrets: no published packages found");
  process.exit(1);
}

const secretlintrc = resolve(".secretlintrc.json");
const workspace = realpathSync(mkdtempSync(join(tmpdir(), "packed-secrets-")));
try {
  for (const { directory } of packages) {
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
  if (tarballs.length !== packages.length) {
    throw new Error(
      `Packed secrets: ${packages.length} packages produced ${tarballs.length} tarballs`,
    );
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
