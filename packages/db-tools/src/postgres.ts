// A disposable Postgres in Docker for gates that must observe real database behaviour rather than
// inspect an artifact. One container per checkout, on a pinned host port, shared by every task and
// test in that checkout; each caller gets its own database inside it.

import { execFileSync, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export interface PostgresOptions {
  /** The checkout that owns the container. Default: the nearest ancestor of the working directory
   * holding `pnpm-workspace.yaml`, `.moon` or `.git`. */
  readonly root?: string;
  /** Host port. Default: `LILO_PG_PORT`, else a port derived from the root. */
  readonly port?: number;
  /** Default: `postgres:17-alpine`. */
  readonly image?: string;
  /** Environment for Docker and for `LILO_PG_PORT`. Default: `process.env`. */
  readonly env?: Env;
}

export const DEFAULT_IMAGE = "postgres:17-alpine";

/** How long `docker info` may take before Docker counts as unavailable, rather than hanging. */
const DOCKER_ANSWER_MS = 20_000;
const READY_MS = 15_000;

export function findWorkspaceRoot(from = process.cwd()): string {
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    if (
      ["pnpm-workspace.yaml", ".moon", ".git"].some((marker) => existsSync(join(directory, marker)))
    ) {
      return directory;
    }
    if (dirname(directory) === directory) return resolve(from);
  }
}

// The path digest isolates same-named clones and worktrees.
export function postgresIdentity(root: string): { container: string; port: number } {
  const digest = createHash("sha256").update(resolve(root)).digest("hex");
  return {
    container: `baseline-postgres-${digest.slice(0, 12)}`,
    port: 20000 + (Number.parseInt(digest.slice(0, 6), 16) % 30000),
  };
}

interface Server {
  readonly container: string;
  readonly port: number;
  readonly image: string;
  readonly env: Env;
}

function server(options: PostgresOptions = {}): Server {
  const env = options.env ?? process.env;
  const identity = postgresIdentity(options.root ?? findWorkspaceRoot());
  const raw = env["LILO_PG_PORT"];
  const port = options.port ?? (raw === undefined || raw === "" ? identity.port : Number(raw));
  if (!Number.isInteger(port) || port < 1024 || port > 65000) {
    throw new Error(`the Postgres port must be between 1024 and 65000, got ${raw ?? port}`);
  }
  return { container: identity.container, port, image: options.image ?? DEFAULT_IMAGE, env };
}

function errorCode(result: SpawnSyncReturns<string>): unknown {
  return result.error !== undefined && "code" in result.error ? result.error.code : undefined;
}

function docker(target: Server, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("docker", args, {
    encoding: "utf8",
    env: { ...target.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export type DockerStatus =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/** Whether the Docker daemon answers, and why not. A wedged daemon counts as unavailable. */
export function dockerStatus(env: Env = process.env): DockerStatus {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    env: { ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DOCKER_ANSWER_MS,
  });
  const code = errorCode(result);
  if (code === "ENOENT")
    return { available: false, reason: "docker is not installed or not on PATH" };
  if (code === "ETIMEDOUT") {
    return {
      available: false,
      reason: `Docker did not answer within ${DOCKER_ANSWER_MS / 1000} seconds`,
    };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim().split("\n")[0] ?? "";
    return {
      available: false,
      reason: `the Docker daemon is not reachable${detail ? `: ${detail}` : ""}`,
    };
  }
  return { available: true };
}

export function dockerIsAvailable(env: Env = process.env): boolean {
  return dockerStatus(env).available;
}

function requireDocker(env: Env): void {
  const status = dockerStatus(env);
  if (!status.available) throw new Error(`Docker is required: ${status.reason}.`);
}

function waitForPostgres(target: Server): void {
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    const ready = docker(target, [
      "exec",
      target.container,
      "pg_isready",
      "--host",
      "127.0.0.1",
      "--timeout",
      "1",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
    ]);
    if (ready.status === 0) return;
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(250, remaining));
    }
  }
  const logs = docker(target, ["logs", "--tail", "20", target.container]);
  throw new Error(
    `Postgres in ${target.container} did not accept connections within ${READY_MS / 1000} seconds.\n${logs.stdout}${logs.stderr}`,
  );
}

// Null when absent, otherwise its image and host port.
function inspectContainer(target: Server): { image: string; port: number } | null {
  const result = docker(target, [
    "inspect",
    "--format",
    '{{.Config.Image}} {{(index (index .HostConfig.PortBindings "5432/tcp") 0).HostPort}}',
    target.container,
  ]);
  if (result.status !== 0) return null;
  const [image = "", hostPort] = result.stdout.trim().split(" ");
  return { image, port: Number(hostPort) };
}

// Act, then recover, and never judge a right-image container: one first seen in Created state is
// usually a sibling task mid-start, and removing it is how CI produced a name conflict with three
// tasks racing a cold image pull. `docker start` is the idempotent verb for every right-image
// state: a no-op when running, a start when created or exited. A `docker run` that loses the name
// race is the same situation one step later: the conflict error itself proves a sibling just
// created the container, so the loser recovers with the same verb rather than a second `docker
// run`, which CI showed can lose the race twice. `waitForPostgres` is the gate either way.
function ensurePostgres(target: Server): void {
  requireDocker(target.env);
  const existing = inspectContainer(target);
  if (existing !== null && existing.port !== target.port) {
    throw new Error(
      `Postgres container ${target.container} uses port ${existing.port}, requested ${target.port}. Remove it with db-tools clean before changing the port.`,
    );
  }
  if (existing !== null && existing.image !== target.image) {
    docker(target, ["rm", "--force", target.container]);
  }
  if (existing === null || existing.image !== target.image) {
    const started = docker(target, [
      "run",
      "--detach",
      "--name",
      target.container,
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--publish",
      `127.0.0.1:${target.port}:5432`,
      target.image,
    ]);
    if (started.status !== 0 && !/is already in use/.test(started.stderr)) {
      throw new Error(
        `Could not start ${target.container} (${target.image}) on 127.0.0.1:${target.port}:\n${started.stderr}`,
      );
    }
  }
  docker(target, ["start", target.container]);
  waitForPostgres(target);
}

function psql(target: Server, sql: string): string {
  const result = docker(target, [
    "exec",
    target.container,
    "psql",
    "--no-psqlrc",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    sql,
  ]);
  if (result.status !== 0) throw new Error(`psql failed: ${sql}\n${result.stderr}`);
  return result.stdout;
}

// Linux caps pids at 2^22, so a longer run of digits is not a pid (rls-verify's scratch names are
// random hex, which can be all digits).
const PID_MAX = 4_194_304;

// A pid whose process is gone names a database no run is using. Signal 0 probes liveness without
// sending anything. Pid reuse keeps a stale database one round longer, which costs nothing.
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The leak guarantee. An interrupted run cannot clean up after itself, so every new run cleans up
// after the dead: any database with this base whose owning process no longer exists is dropped.
function dropStaleDatabases(target: Server, base: string): void {
  const listed = psql(target, "SELECT datname FROM pg_database WHERE datistemplate = false").trim();
  for (const name of listed === "" ? [] : listed.split("\n")) {
    const suffix = name.startsWith(`${base}_`) ? name.slice(base.length + 1) : "";
    if (!/^\d+$/.test(suffix)) continue;
    const pid = Number(suffix);
    if (pid > PID_MAX || processIsAlive(pid)) continue;
    psql(target, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
}

function urlFor(target: Server, database: string): string {
  return `postgres://postgres:postgres@127.0.0.1:${target.port}/${database}?sslmode=disable`;
}

/** Starts the checkout's container if needed and returns a superuser URL to its `postgres`
 * database, for tools such as `rls-verify --disposable` that create their own databases. */
export function startPostgres(options: PostgresOptions = {}): string {
  const target = server(options);
  ensurePostgres(target);
  return urlFor(target, "postgres");
}

/**
 * Hands the callback a superuser URL to a fresh database inside the checkout's container. The label
 * names the database (`<label>_<pid>`), so concurrent tasks and checkouts never share one. The drop
 * afterwards is a courtesy; the next run with the same label drops databases of dead processes.
 */
export async function withPostgres<T>(
  label: string,
  callback: (databaseUrl: string) => T | Promise<T>,
  options: PostgresOptions = {},
): Promise<T> {
  const base = label.replaceAll("-", "_");
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(base)) {
    throw new Error(
      `Postgres label ${JSON.stringify(label)} must be lowercase letters, digits, - and _.`,
    );
  }
  const target = server(options);
  ensurePostgres(target);
  dropStaleDatabases(target, base);
  const database = `${base}_${process.pid}`;
  psql(target, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  psql(target, `CREATE DATABASE ${database}`);
  try {
    return await callback(urlFor(target, database));
  } finally {
    docker(target, [
      "exec",
      target.container,
      "psql",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
      "--command",
      `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
    ]);
  }
}

/**
 * Runs SQL the way `psql -v ON_ERROR_STOP=1 --single-transaction -f` would, with the psql inside the
 * container, so no host client is needed. The SQL arrives on stdin and each variable becomes a
 * `--set`, which is how files such as `@littleorgans/db`'s grants take their parameters.
 */
export function psqlInput(
  databaseUrl: string,
  sql: string | Buffer,
  variables: Readonly<Record<string, string>> = {},
  options: PostgresOptions = {},
): void {
  const target = server(options);
  execFileSync(
    "docker",
    [
      "exec",
      "--interactive",
      target.container,
      "psql",
      "--no-psqlrc",
      "--username",
      "postgres",
      "--dbname",
      new URL(databaseUrl).pathname.slice(1),
      "--set",
      "ON_ERROR_STOP=1",
      ...Object.entries(variables).flatMap(([name, value]) => ["--set", `${name}=${value}`]),
      "--single-transaction",
      "--file",
      "-",
    ],
    { input: sql, env: { ...target.env }, stdio: ["pipe", "inherit", "inherit"] },
  );
}

/** Removes the checkout's container. Returns whether there was one. Without Docker installed there
 * is nothing to remove; a daemon that does not answer is an error, since the container may exist. */
export function removePostgres(options: PostgresOptions = {}): boolean {
  const target = server(options);
  const result = docker(target, ["rm", "--force", target.container]);
  if (errorCode(result) === "ENOENT") return false;
  // Docker exits 0 for a forced removal of a missing container, and says so only on stderr.
  if (/No such container/.test(result.stderr)) return false;
  if (result.status === 0) return true;
  throw new Error(`Could not remove ${target.container}: ${result.stderr.trim()}`);
}
