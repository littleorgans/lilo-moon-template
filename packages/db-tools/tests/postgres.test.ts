import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  dockerStatus,
  findWorkspaceRoot,
  postgresIdentity,
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

// Record the commands, so refusing a foreign name proves no start or deletion occurred.
function dockerFixture(owner: string | undefined, image = "postgres:17-alpine") {
  const root = mkdtempSync(join(tmpdir(), "db-tools-owned-"));
  const log = join(root, "calls");
  const info = [
    JSON.stringify("immutable-container-id"),
    JSON.stringify(image),
    JSON.stringify(owner === "self" ? root : (owner ?? null)),
    `${postgresIdentity(root).port} 127.0.0.1`,
  ].join("\n");
  const PATH = fakePath({
    docker: `echo "$*" >> '${log}'\ncase "$1" in\ninfo) exit 0;;\ncontainer) echo '${info}';;\nesac`,
  });
  return { root, env: { PATH }, log };
}

describe("container ownership", () => {
  it.each([undefined, "/another/checkout"])(
    "refuses clean and replacement of foreign ownership %s",
    (owner) => {
      const fixture = dockerFixture(owner, "some-other-image");
      expect(() => removePostgres(fixture)).toThrow("ownership label");
      expect(() => startPostgres(fixture)).toThrow("ownership label");
      expect(readFileSync(fixture.log, "utf8")).not.toMatch(/^(rm|run|start) /m);
    },
  );

  it("removes an owned container by immutable ID, never by reusable name", () => {
    const fixture = dockerFixture("self");
    expect(removePostgres(fixture)).toBe(true);
    expect(readFileSync(fixture.log, "utf8")).toContain("rm --force immutable-container-id");
  });

  it("does not mistake an inspection failure for an absent container", () => {
    const env = { PATH: fakePath({ docker: 'echo "permission denied" >&2; exit 1' }) };
    expect(() => removePostgres({ env })).toThrow("Could not inspect");
  });
});

it("rechecks ownership after losing the container-name race", () => {
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
  echo '"foreign-id"'
  echo '"postgres:17-alpine"'
  echo 'null'
  echo '${postgresIdentity(root).port} 127.0.0.1'
  ;;
run) echo 'container name is already in use' >&2; exit 1;;
esac`,
  });
  expect(() => startPostgres({ root, env: { PATH } })).toThrow("ownership label");
  expect(readFileSync(log, "utf8").trim().split("\n")).toStrictEqual([
    "info",
    "container",
    "run",
    "container",
  ]);
});
