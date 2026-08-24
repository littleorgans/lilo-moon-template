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
        "app",
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

// Host ports are pinned, not random. Docker's random allocation raced other containers on this
// machine and lost (atlas-lint bound an ephemeral port that was already taken), and a random port
// cannot be diagnosed or reserved. Same philosophy as the Vite 5199 pin: the port belongs to this
// project, on purpose. Each task gets its own slot because moon runs the database tasks in
// parallel, each with its own container.
//
// The default base is this project's committed identity; an instantiated template picks a fresh
// one (docs/how-to-instantiate.md). LILO_PG_PORT_BASE overrides it from the shell environment for
// the machine where two projects still collide. It is deliberately not in .env.example: moon loads
// .env.local for the dev and preview tasks only, so a value there would silently not apply here.
const DEFAULT_PORT_BASE = 54390;

const PORT_SLOTS = {
  "drizzle-check": 0,
  "rls-verify": 1,
  "atlas-lint": 2,
  "atlas-diff": 3,
};

function portFor(slot) {
  const offset = PORT_SLOTS[slot];
  if (offset === undefined) {
    throw new Error(`Unknown Postgres port slot ${JSON.stringify(slot)}.`);
  }
  const raw = process.env.LILO_PG_PORT_BASE;
  const base = raw === undefined || raw === "" ? DEFAULT_PORT_BASE : Number(raw);
  if (!Number.isInteger(base) || base < 1024 || base > 65000) {
    throw new Error(`LILO_PG_PORT_BASE must be a port between 1024 and 65000, got ${raw}.`);
  }
  return base + offset;
}

// Starts a container, waits for TCP, and hands the callback a connection URL. The container is
// removed whether the callback succeeds or throws. `slot` names the calling task so concurrent
// tasks bind distinct pinned ports.
export async function withPostgres(slot, callback) {
  const container = `lilo-postgres-${process.pid}`;
  const port = portFor(slot);
  try {
    run("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_DB=app",
      "--publish",
      `127.0.0.1:${port}:5432`,
      "postgres:17-alpine",
    ]);
    waitForPostgres(container);
    return await callback(`postgres://postgres:postgres@127.0.0.1:${port}/app?sslmode=disable`);
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  }
}

// Every task here reaches the database through the migrations, never through schema.sql, so what
// is verified is what would actually ship.
export function applyMigrations(databaseUrl) {
  const directory = resolve(repositoryRoot, "db", "migrations");
  run("atlas", ["migrate", "apply", "--dir", `file://${directory}`, "--url", databaseUrl]);
}
