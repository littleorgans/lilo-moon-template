import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
