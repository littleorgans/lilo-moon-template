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

// One throwaway database per task, so moon can run the tasks in parallel against one server. The
// allowlist is what keeps the name a safe SQL identifier.
const TASK_DATABASES = {
  "drizzle-check": "drizzle_check",
  "rls-verify": "rls_verify",
  "atlas-lint": "atlas_lint",
  "atlas-diff": "atlas_diff",
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

function psql(sql) {
  run(
    "docker",
    ["exec", CONTAINER, "psql", "--username", "postgres", "--dbname", "postgres", "--command", sql],
    true,
  );
}

// Idempotent: converges on one running container of the right image regardless of what a previous
// run left behind, and survives the race where parallel tasks all find it absent and one wins the
// `docker run`.
function ensurePostgres() {
  const existing = inspectContainer();
  if (existing !== null && (!existing.running || existing.image !== IMAGE)) {
    spawnSync("docker", ["rm", "--force", CONTAINER], { stdio: "ignore" });
  }
  if (existing === null || !existing.running || existing.image !== IMAGE) {
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
    if (started.status !== 0 && inspectContainer() === null) {
      throw new Error(`Could not start ${CONTAINER} on 127.0.0.1:${port()}:\n${started.stderr}`);
    }
  }
  waitForPostgres(CONTAINER);
}

// Hands the callback a URL to a fresh database inside the shared container. The DROP before the
// CREATE is the leak guarantee: whatever an interrupted previous run left behind is removed here,
// so the drop afterwards is a courtesy, not a requirement.
export async function withPostgres(task, callback) {
  const database = TASK_DATABASES[task];
  if (database === undefined) {
    throw new Error(`Unknown Postgres task ${JSON.stringify(task)}.`);
  }
  ensurePostgres();
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
