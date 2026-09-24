// The db-tools commands against this checkout's Postgres container, Atlas and drizzle-kit, run
// in-process so coverage sees them. The fixtures are this repository's: the migrations
// @littleorgans/db ships, and the typed schema the root drizzle-check keeps current.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { main } from "../../src/commands.js";
import {
  dockerIsAvailable,
  exitCodes,
  removePostgres,
  postgresIdentity,
  startPostgres,
  withPostgres,
} from "../../src/index.js";

const migrations = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const artifact = fileURLToPath(new URL("../../../../db/drizzle/_generated", import.meta.url));

async function run(argv) {
  let output = "";
  const write = (text) => (output += text);
  const code = await main(argv, { env: process.env, stdout: write, stderr: write });
  return { code, output };
}

function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe.skipIf(!dockerIsAvailable())("db-tools against Postgres", { timeout: 60_000 }, () => {
  it("drizzle-check passes on the committed schema and fails on an edited copy", async () => {
    expect((await run(["drizzle-check", "--migrations", migrations, "--out", artifact])).code).toBe(
      exitCodes.passed,
    );
    const edited = scratch("db-tools-drizzle-");
    cpSync(artifact, edited, { recursive: true });
    writeFileSync(join(edited, "schema.ts"), "// edited\n", { flag: "a" });
    const { code, output } = await run([
      "drizzle-check",
      "--migrations",
      migrations,
      "--out",
      edited,
    ]);
    expect(code).toBe(exitCodes.failed);
    expect(output).toContain("is stale or was edited by hand");
  });

  it("drizzle-check fails when the schema was never generated", async () => {
    const out = join(scratch("db-tools-drizzle-"), "absent");
    expect((await run(["drizzle-check", "--migrations", migrations, "--out", out])).code).toBe(
      exitCodes.failed,
    );
  });

  it("drizzle-generate writes exactly the committed schema", async () => {
    const out = join(scratch("db-tools-drizzle-"), "generated");
    expect((await run(["drizzle-generate", "--migrations", migrations, "--out", out])).code).toBe(
      exitCodes.passed,
    );
    expect(readdirSync(out)).toStrictEqual(["schema.ts"]);
    expect(readFileSync(join(out, "schema.ts"), "utf8")).toBe(
      readFileSync(join(artifact, "schema.ts"), "utf8"),
    );
  });

  it("atlas-lint passes the shipped migrations", async () => {
    expect((await run(["atlas-lint", "--migrations", migrations])).code).toBe(exitCodes.passed);
  });

  it("atlas-diff writes a migration for a table the desired schema adds", async () => {
    const directory = scratch("db-tools-atlas-");
    const copied = join(directory, "migrations");
    cpSync(migrations, copied, { recursive: true });
    const desired = join(directory, "schema.sql");
    writeFileSync(
      desired,
      `${readFileSync(new URL("../../../../db/schema.sql", import.meta.url), "utf8")}\nCREATE TABLE notes (id bigint PRIMARY KEY);\n`,
    );
    const before = readdirSync(copied);
    expect((await run(["atlas-diff", "--migrations", copied, "--to", desired])).code).toBe(
      exitCodes.passed,
    );
    const added = readdirSync(copied).filter((file) => !before.includes(file));
    expect(added).toHaveLength(1);
    expect(readFileSync(join(copied, added[0]), "utf8")).toContain('CREATE TABLE "notes"');
  });

  it("rls-verify verifies a scratch copy of the migrations in the container", async () => {
    const seed = join(scratch("db-tools-seed-"), "seed.sql");
    writeFileSync(
      seed,
      "INSERT INTO accounts (workos_org_id) VALUES ('org_seed');\nINSERT INTO profiles (workos_user_id) VALUES ('user_seed');\n",
    );
    const { code, output } = await run(["rls-verify", "--migrations", migrations, "--seed", seed]);
    expect(output).toContain("(disposable)");
    expect(output).not.toContain("empty tables");
    expect(code).toBe(exitCodes.passed);
  });

  // Another checkout's container, so the one every other test shares is left alone.
  it("clean removes the checkout's container, and a second clean finds none", async () => {
    const root = scratch("db-tools-checkout-");
    startPostgres({ root });
    expect(() => startPostgres({ root, port: 1024 })).toThrow("Remove it with db-tools clean");
    expect((await run(["clean", "--root", root])).output).toContain("removed");
    expect(removePostgres({ root })).toBe(false);
  });
});

describe.skipIf(!dockerIsAvailable())("scratch database ownership", { timeout: 60_000 }, () => {
  it("reuses a real legacy container without deleting unmarked databases or the container", async () => {
    const root = scratch("db-tools-ownership-");
    const options = { root };
    const identity = postgresIdentity(root);
    // Reproduce the old scripts exactly, without an ownership label. The test owns this ID.
    const containerId = execFileSync(
      "docker",
      [
        "run",
        "--detach",
        "--name",
        identity.container,
        "--env",
        "POSTGRES_PASSWORD=postgres",
        "--publish",
        `127.0.0.1:${identity.port}:5432`,
        "postgres:17-alpine",
      ],
      { encoding: "utf8" },
    ).trim();
    const url = new URL(startPostgres(options));
    const { Client } = await import("pg");
    const client = new Client({ connectionString: url.href });
    await client.connect();
    // A user can restore a scratch-shaped database; the shape alone cannot authorize its drop.
    const foreign = "ownership_4194303_abcdef012345";
    const stale = "ownership_4194303_abcdef012346";
    try {
      await client.query(`CREATE DATABASE ${foreign}`);
      await client.query(`CREATE DATABASE ${stale}`);
      await client.query(`COMMENT ON DATABASE ${stale} IS 'littleorgans/db-tools:${root}'`);
      await withPostgres(
        "ownership",
        async (first) => {
          await withPostgres(
            "ownership",
            async (second) => {
              expect(first).not.toBe(second);
              const { rows } = await client.query("SELECT datname FROM pg_database");
              const names = rows.map((row) => row.datname);
              expect(names).toContain(new URL(first).pathname.slice(1));
              expect(names).toContain(new URL(second).pathname.slice(1));
              expect(names).toContain(foreign);
              expect(names).not.toContain(stale);
            },
            options,
          );
        },
        options,
      );
      expect(() => removePostgres(options)).toThrow("no ownership label");
    } finally {
      await client.end();
      execFileSync("docker", ["rm", "--force", containerId]);
    }
  });
});
