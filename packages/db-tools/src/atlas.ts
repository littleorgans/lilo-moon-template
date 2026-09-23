// Atlas is a Go binary with no npm distribution, so it must be on PATH. Every call runs against a
// database this package manages or the caller names, never Atlas's own `docker://` driver, which
// publishes its container to a random host port with no way to pin one.

import { spawnSync } from "node:child_process";

import type { Env } from "./postgres.js";
import { MissingToolError, runTool } from "./tools.js";

const missing =
  "atlas is not on PATH. Install it from https://atlasgo.io/getting-started, or pin it in .prototools and run proto install.";

/** Fails fast with an install hint, before any container starts. */
export function requireAtlas(env: Env = process.env): void {
  const result = spawnSync("atlas", ["version"], {
    env: { ...env },
    stdio: "ignore",
    timeout: 30_000,
  });
  if (result.error !== undefined || result.status !== 0) throw new MissingToolError(missing);
}

function atlas(args: readonly string[], env: Env | undefined): void {
  runTool("atlas", ["migrate", ...args], { env, missing });
}

// Atlas inspects only the named schema of a dev database, so it must be scratch space.
const devUrl = (databaseUrl: string) => `${databaseUrl}&search_path=public`;

/** `atlas migrate apply` of a migration directory to a database. */
export function applyMigrations(databaseUrl: string, directory: string, env?: Env): void {
  atlas(["apply", "--dir", `file://${directory}`, "--url", databaseUrl], env);
}

export function atlasDiff(options: {
  readonly migrations: string;
  readonly to: string;
  readonly devDatabaseUrl: string;
  readonly env?: Env | undefined;
}): void {
  atlas(
    [
      "diff",
      "--dir",
      `file://${options.migrations}`,
      "--to",
      `file://${options.to}`,
      "--dev-url",
      devUrl(options.devDatabaseUrl),
    ],
    options.env,
  );
}

/** Lints the migrations added since `gitBase`, or the latest one without it. */
export function atlasLint(options: {
  readonly migrations: string;
  readonly devDatabaseUrl: string;
  readonly gitBase?: string | undefined;
  readonly env?: Env | undefined;
}): void {
  const selector =
    options.gitBase === undefined || options.gitBase === ""
      ? "--latest=1"
      : `--git-base=${options.gitBase}`;
  atlas(
    [
      "lint",
      "--dir",
      `file://${options.migrations}`,
      "--dev-url",
      devUrl(options.devDatabaseUrl),
      selector,
    ],
    options.env,
  );
}
