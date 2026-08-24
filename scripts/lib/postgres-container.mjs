// A disposable Postgres for tasks that must observe real database behaviour rather than inspect
// an artifact. Shared by root:drizzle-check and root:rls-verify so the container lifecycle exists
// once.

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file rather than from cwd: the package test suites run from their own
// directory, and a repo-relative path silently points at nothing there.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function run(command, args, capture = false) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

export function dockerIsAvailable() {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

function waitForPostgres(container) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = spawnSync(
      "docker",
      [
        "exec",
        container,
        "pg_isready",
        "--host",
        "127.0.0.1",
        "--timeout",
        "1",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
      ],
      { stdio: "ignore" },
    );
    if (ready.status === 0) return;
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(250, remaining));
    }
  }
  throw new Error("Postgres did not accept TCP connections within 15 seconds.");
}

// One persistent container, not one per task run. Random per-run containers leaked on every
// interrupted run: a killed task never reaches its cleanup, `--rm` does not stop a running
// container, and 31 orphans were once found holding random ports. A single named container on one
// pinned host port inverts that: tasks share the server and isolate through throwaway databases,
// a leak self-heals on the next run, and reclaiming everything is `just clean`. Same philosophy
// as the Vite 5199 pin: the port and the name belong to this project, on purpose.
//
// The default port is this project's committed identity; an instantiated template picks a fresh
// one (docs/how-to-instantiate.md), and `just rename` re-prefixes the container name. LILO_PG_PORT
// overrides the port from the shell environment for the machine where two projects still collide.
// It is deliberately not in .env.example: moon loads .env.local for the dev and preview tasks
// only, so a value there would silently not apply here.
const CONTAINER = "lilo-postgres";
const IMAGE = "postgres:17-alpine";
const DEFAULT_PORT = 54390;

// One throwaway database per task invocation, so moon can run the tasks in parallel against one
// server, twice over if two checkouts run at once. The allowlist keeps the base a safe SQL
// identifier; the pid suffix keeps concurrent invocations apart.
const TASK_DATABASES = {
  "drizzle-check": "drizzle_check",
  "rls-verify": "rls_verify",
  "atlas-lint": "atlas_lint",
  "atlas-diff": "atlas_diff",
  "db-test": "db_test",
};

function port() {
  const raw = process.env.LILO_PG_PORT;
  const value = raw === undefined || raw === "" ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65000) {
    throw new Error(`LILO_PG_PORT must be a port between 1024 and 65000, got ${raw}.`);
  }
  return value;
}

// Null when absent, otherwise whether it runs and what image it runs.
function inspectContainer() {
  const result = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Running}} {{.Config.Image}}", CONTAINER],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  const [running, image] = result.stdout.trim().split(" ");
  return { running: running === "true", image };
}

function psql(sql, capture = false) {
  return run(
    "docker",
    [
      "exec",
      CONTAINER,
      "psql",
      "--username",
      "postgres",
      "--dbname",
      "postgres",
      "--tuples-only",
      "--no-align",
      "--command",
      sql,
    ],
    capture,
  );
}

// Act, then recover, and never judge a right-image container: one first seen in Created state is
// usually a sibling task mid-start, and removing it is how CI produced a name conflict with three
// tasks racing a cold image pull. `docker start` is the idempotent verb for every right-image
// state: a no-op when running, a start when created or exited. The one `docker run` conflict a
// race can still produce resolves by looping once onto the winner's container.
function ensurePostgres() {
  for (let attempt = 0; ; attempt += 1) {
    const existing = inspectContainer();
    if (existing !== null && existing.image === IMAGE) {
      spawnSync("docker", ["start", CONTAINER], { stdio: "ignore" });
      break;
    }
    if (existing !== null) {
      spawnSync("docker", ["rm", "--force", CONTAINER], { stdio: "ignore" });
    }
    const started = spawnSync(
      "docker",
      [
        "run",
        "--detach",
        "--name",
        CONTAINER,
        "--env",
        "POSTGRES_PASSWORD=postgres",
        "--publish",
        `127.0.0.1:${port()}:5432`,
        IMAGE,
      ],
      { encoding: "utf8" },
    );
    if (started.status === 0) break;
    if (attempt > 0 || !/is already in use/.test(started.stderr ?? "")) {
      throw new Error(`Could not start ${CONTAINER} on 127.0.0.1:${port()}:\n${started.stderr}`);
    }
  }
  waitForPostgres(CONTAINER);
}

// A pid whose process is gone names a database no run is using. Signal 0 probes liveness without
// sending anything. Pid reuse keeps a stale database one round longer, which costs nothing.
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The leak guarantee. An interrupted run cannot clean up after itself, so every new run cleans up
// after the dead: any database of this task whose owning process no longer exists is dropped.
function dropStaleDatabases(base) {
  const listed = psql("SELECT datname FROM pg_database WHERE datistemplate = false", true).trim();
  for (const name of listed === "" ? [] : listed.split("\n")) {
    if (!name.startsWith(`${base}_`) || !/^[a-z_]+_\d+$/.test(name)) continue;
    const pid = Number(name.slice(base.length + 1));
    if (!Number.isInteger(pid) || processIsAlive(pid)) continue;
    psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
}

// Hands the callback a URL to a fresh database inside the shared container. The drop afterwards
// is a courtesy; dropStaleDatabases on the next run is the guarantee.
export async function withPostgres(task, callback) {
  const base = TASK_DATABASES[task];
  if (base === undefined) {
    throw new Error(`Unknown Postgres task ${JSON.stringify(task)}.`);
  }
  ensurePostgres();
  dropStaleDatabases(base);
  const database = `${base}_${process.pid}`;
  psql(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  psql(`CREATE DATABASE ${database}`);
  try {
    return await callback(
      `postgres://postgres:postgres@127.0.0.1:${port()}/${database}?sslmode=disable`,
    );
  } finally {
    spawnSync(
      "docker",
      [
        "exec",
        CONTAINER,
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
        "--command",
        `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
      ],
      { stdio: "ignore" },
    );
  }
}

// Every task here reaches the database through the migrations, never through schema.sql, so what
// is verified is what would actually ship.
export function applyMigrations(databaseUrl) {
  const directory = resolve(repositoryRoot, "db", "migrations");
  run("atlas", ["migrate", "apply", "--dir", `file://${directory}`, "--url", databaseUrl]);
}
