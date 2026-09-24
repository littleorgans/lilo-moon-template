import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  dockerStatus,
  findWorkspaceRoot,
  postgresIdentity,
  psqlInput,
  removePostgres,
  startPostgres,
  withPostgres,
} from "../src/index.js";

// A PATH holding only the given scripts, so each Docker state is reproducible without Docker.
function fakePath(scripts: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "db-tools-path-"));
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(directory, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  return directory;
}

describe("the checkout's Postgres", () => {
  it("names the container and default port after the checkout", () => {
    const one = postgresIdentity("/one/project");
    const two = postgresIdentity("/two/project");
    expect(postgresIdentity("/one/project")).toStrictEqual(one);
    expect(one.container).not.toBe(two.container);
    expect(one.port).not.toBe(two.port);
    expect(one.container).toMatch(/^baseline-postgres-[a-f0-9]{12}$/);
  });

  it("finds the checkout from a directory inside it", () => {
    const root = mkdtempSync(join(tmpdir(), "db-tools-root-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "");
    mkdirSync(join(root, "packages", "db"), { recursive: true });
    expect(findWorkspaceRoot(join(root, "packages", "db"))).toBe(root);
  });

  it("refuses an out-of-range LILO_PG_PORT before touching Docker", () => {
    expect(() => startPostgres({ env: { LILO_PG_PORT: "80", PATH: fakePath({}) } })).toThrow(
      "between 1024 and 65000, got 80",
    );
  });

  it("refuses a label that cannot name a database", async () => {
    await expect(withPostgres("Drop Table", () => undefined)).rejects.toThrow(
      "must be lowercase letters",
    );
  });
});

describe("Docker availability", () => {
  it("names a missing docker binary", () => {
    expect(dockerStatus({ PATH: fakePath({}) })).toStrictEqual({
      available: false,
      reason: "docker is not installed or not on PATH",
    });
  });

  it("names an unreachable daemon with Docker's own first line", () => {
    const PATH = fakePath({ docker: 'echo "Cannot connect to the Docker daemon" >&2; exit 1' });
    expect(dockerStatus({ PATH })).toStrictEqual({
      available: false,
      reason: "the Docker daemon is not reachable: Cannot connect to the Docker daemon",
    });
  });

  it("fails to start Postgres with the reason rather than hanging", () => {
    const PATH = fakePath({ docker: "exit 1" });
    expect(() => startPostgres({ env: { PATH } })).toThrow(
      "Docker is required: the Docker daemon is not reachable.",
    );
  });

  it("has nothing to clean without Docker installed", () => {
    expect(removePostgres({ env: { PATH: fakePath({}) } })).toBe(false);
  });

  it("refuses to report a clean it could not do", () => {
    const PATH = fakePath({ docker: 'echo "daemon down" >&2; exit 1' });
    expect(() => removePostgres({ env: { PATH } })).toThrow("daemon down");
  });
});

// Record the commands, so a test can prove which container each start, exec or removal targeted.
// An exec reads all of its stdin, as psql does, unless a test replaces it.
function dockerFixture(image = "postgres:17-alpine", owner?: string, exec?: string) {
  const root = mkdtempSync(join(tmpdir(), "db-tools-owned-"));
  const log = join(root, "calls");
  const stdin = join(root, "stdin");
  const info = [
    JSON.stringify("immutable-container-id"),
    JSON.stringify(image),
    JSON.stringify(owner === "self" ? root : (owner ?? null)),
    `${postgresIdentity(root).port} 127.0.0.1`,
  ].join("\n");
  const PATH = fakePath({
    docker: `echo "$*" >> '${log}'\ncase "$1" in\ninfo) exit 0;;\ncontainer) echo '${info}';;\nexec) ${exec ?? `/bin/cat > '${stdin}'`};;\nesac`,
  });
  return { root, env: { PATH }, log, stdin };
}

describe("the checkout's container", () => {
  it("adopts an unlabelled container from the old root scripts, by immutable ID", () => {
    const fixture = dockerFixture();
    expect(startPostgres(fixture)).toContain(`127.0.0.1:${postgresIdentity(fixture.root).port}`);
    const calls = readFileSync(fixture.log, "utf8");
    expect(calls).toContain("start immutable-container-id");
    expect(calls).toContain("exec immutable-container-id pg_isready");
    expect(calls).not.toMatch(/^(rm|run) /m);
  });

  it("removes the owned container by immutable ID, never by reusable name", () => {
    const fixture = dockerFixture("postgres:17-alpine", "self");
    expect(removePostgres(fixture)).toBe(true);
    expect(readFileSync(fixture.log, "utf8")).toContain("rm --force immutable-container-id");
  });

  it("does not mistake an inspection failure for an absent container", () => {
    const env = { PATH: fakePath({ docker: 'echo "permission denied" >&2; exit 1' }) };
    expect(() => removePostgres({ env })).toThrow("Could not inspect");
  });
});

it("rechecks the container after losing the container-name race", () => {
  const root = mkdtempSync(join(tmpdir(), "db-tools-race-"));
  const marker = join(root, "seen");
  const log = join(root, "calls");
  const PATH = fakePath({
    docker: `echo "$1" >> '${log}'
case "$1" in
info) exit 0;;
container)
  if [ ! -f '${marker}' ]; then
    echo seen > '${marker}'
    echo 'No such container' >&2
    exit 1
  fi
  echo '"winner-id"'
  echo '"postgres:16-alpine"'
  echo null
  echo '${postgresIdentity(root).port} 127.0.0.1'
  ;;
run) echo 'container name is already in use' >&2; exit 1;;
esac`,
  });
  expect(() => startPostgres({ root, env: { PATH } })).toThrow("does not match");
  expect(readFileSync(log, "utf8").trim().split("\n")).toStrictEqual([
    "info",
    "container",
    "run",
    "container",
  ]);
});

it("psqlInput runs in the inspected container and only for its URL", () => {
  const fixture = dockerFixture();
  const url = `postgres://127.0.0.1:${postgresIdentity(fixture.root).port}/test`;
  psqlInput(url, "SELECT 1", {}, fixture);
  expect(readFileSync(fixture.log, "utf8")).toContain(
    "exec --interactive immutable-container-id psql",
  );
  expect(readFileSync(fixture.stdin, "utf8")).toBe("SELECT 1");
  expect(() => psqlInput("postgres://remote/app", "SELECT 1", {}, fixture)).toThrow(
    "requires a URL from this checkout",
  );
});

// More SQL than a pipe buffers, so a psql that exits without reading it always makes the write fail
// with EPIPE, never only sometimes.
it.each([
  [
    "reports its exit status and stderr",
    "echo 'psql: connection refused' >&2; exit 2",
    /exited with 2:\npsql: connection refused/,
  ],
  ["still fails when it exits 0", "exit 0", /exited before reading all of its SQL input/],
])("psqlInput that exits without reading its SQL %s", (_name, exec, message) => {
  const fixture = dockerFixture("postgres:17-alpine", undefined, exec);
  const url = `postgres://127.0.0.1:${postgresIdentity(fixture.root).port}/test`;
  expect(() => psqlInput(url, "SELECT 1;\n".repeat(200_000), {}, fixture)).toThrow(message);
});

it("never removes an unlabelled container merely because its name matches", () => {
  const fixture = dockerFixture("unrelated-image");
  const { container } = postgresIdentity(fixture.root);
  expect(() => removePostgres(fixture)).toThrow(`run \`docker rm --force ${container}\``);
  expect(readFileSync(fixture.log, "utf8")).not.toMatch(/^rm /m);
});

it("refuses replacement of an unlabelled container and any use of a foreign-labelled one", () => {
  const legacy = dockerFixture("postgres:16-alpine");
  expect(() => startPostgres(legacy)).toThrow(
    "to replace its image postgres:16-alpine with postgres:17-alpine: it has no ownership label",
  );
  expect(readFileSync(legacy.log, "utf8")).not.toMatch(/^(rm|run|start) /m);
  const foreign = dockerFixture("postgres:17-alpine", "/another/checkout");
  expect(() => startPostgres(foreign)).toThrow("another checkout");
  expect(() => removePostgres(foreign)).toThrow("another checkout");
  expect(() =>
    psqlInput(
      `postgres://127.0.0.1:${postgresIdentity(foreign.root).port}/test`,
      "SELECT 1",
      {},
      foreign,
    ),
  ).toThrow("another checkout");
  expect(readFileSync(foreign.log, "utf8")).not.toMatch(/^(rm|run|start|exec) /m);
});

it("does not claim ownership of a compatible unlabelled legacy container after reuse", () => {
  const legacy = dockerFixture();
  startPostgres(legacy);
  expect(() => removePostgres(legacy)).toThrow("no ownership label");
  expect(() => removePostgres(dockerFixture("postgres:17-alpine", ""))).toThrow(
    "no ownership label",
  );
  expect(readFileSync(legacy.log, "utf8")).not.toMatch(/^rm /m);
});

it("psqlInput refuses a mismatched legacy image or stale port mapping before executing SQL", () => {
  const wrongImage = dockerFixture("unrelated-image");
  const imageUrl = `postgres://127.0.0.1:${postgresIdentity(wrongImage.root).port}/test`;
  expect(() => psqlInput(imageUrl, "SELECT 1", {}, wrongImage)).toThrow("does not match");
  expect(readFileSync(wrongImage.log, "utf8")).not.toMatch(/^exec /m);
  const legacy = dockerFixture();
  const port = postgresIdentity(legacy.root).port + 1;
  expect(() =>
    psqlInput(`postgres://127.0.0.1:${port}/test`, "SELECT 1", {}, { ...legacy, port }),
  ).toThrow("does not match");
  expect(readFileSync(legacy.log, "utf8")).not.toMatch(/^exec /m);
});
