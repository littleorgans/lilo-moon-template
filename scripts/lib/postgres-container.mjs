// A disposable Postgres for tasks that must observe real database behaviour rather than inspect
// an artifact. Shared by root:drizzle-check and root:rls-verify so the container lifecycle exists
// once.

import { execFileSync, spawnSync } from "node:child_process";

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

// Starts a container, waits for TCP, and hands the callback a connection URL. The container is
// removed whether the callback succeeds or throws.
export async function withPostgres(callback) {
  const container = `lilo-postgres-${process.pid}`;
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
      "127.0.0.1::5432",
      "postgres:17-alpine",
    ]);
    waitForPostgres(container);
    const portOutput = run("docker", ["port", container, "5432/tcp"], true).trim();
    const port = portOutput.match(/:(\d+)$/)?.[1];
    if (port === undefined) throw new Error(`Could not parse the Postgres port: ${portOutput}`);
    return await callback(`postgres://postgres:postgres@127.0.0.1:${port}/app?sslmode=disable`);
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  }
}

// Every task here reaches the database through the migrations, never through schema.sql, so what
// is verified is what would actually ship.
export function applyMigrations(databaseUrl) {
  run("atlas", ["migrate", "apply", "--dir", "file://db/migrations", "--url", databaseUrl]);
}
