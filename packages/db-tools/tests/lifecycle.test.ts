import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";

const state = vi.hoisted(() => ({
  queries: [] as string[],
  onOriginal: [] as string[],
  fault: "",
  originalWritable: false,
  originalEnded: false,
}));
vi.mock("pg", () => ({
  Client: class {
    database: string;
    constructor(config: { connectionString: string }) {
      this.database = new URL(config.connectionString).pathname.slice(1);
    }
    on() {}
    async connect() {}
    async end() {
      if (this.database === "original") state.originalEnded = true;
    }
    async query(sql: string) {
      state.queries.push(sql);
      if (this.database === "original") {
        const previous = state.onOriginal.at(-1);
        state.onOriginal.push(sql);
        if (sql === "SET default_transaction_read_only = off") state.originalWritable = true;
        if (sql === "SET default_transaction_read_only = on") {
          if (
            (state.fault === "restore-create" && previous?.startsWith("CREATE DATABASE")) ||
            (state.fault === "restore-drop" && previous?.startsWith("DROP DATABASE"))
          ) {
            throw new Error("restoring read-only was cancelled");
          }
          state.originalWritable = false;
        }
      }
      if (sql.startsWith("CREATE DATABASE") && state.fault === "collision")
        throw new Error("already exists");
      if (sql.startsWith("DROP DATABASE") && state.fault === "drop")
        throw new Error("drop refused");
      if (sql.includes("current_database()"))
        return { rows: [{ name: state.fault === "redirect" ? "original" : this.database }] };
      if (sql.includes("to_regrole")) return { rows: [{ exists: true, can_set: true }] };
      if (sql.includes("FROM pg_roles"))
        return { rows: [{ rolsuper: false, rolbypassrls: false }] };
      if (sql.includes("FROM pg_class"))
        return {
          rows: [{ qualified: "public.accounts", enabled: true, forced: true, readable: false }],
        };
      return { rows: [] };
    }
  },
}));

const directory = mkdtempSync(join(tmpdir(), "rls-lifecycle-"));
writeFileSync(join(directory, "001.sql"), "SELECT 'migration marker'");
afterAll(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  state.queries = [];
  state.onOriginal = [];
  state.fault = "";
  state.originalWritable = false;
  state.originalEnded = false;
});

async function run() {
  let output = "";
  const code = await main(["--disposable", "--migrations", directory], {
    env: { DATABASE_URL: "postgres://localhost/original" },
    stdout: (text) => {
      output += text;
    },
    stderr: (text) => {
      output += text;
    },
  });
  return { code, output };
}

it("reports failed cleanup as setup failure even when verification passed", async () => {
  state.fault = "drop";
  const { code, output } = await run();
  expect(output).toContain("could not drop rls_verify_");
  expect(code).toBe(3);
  expect(state.originalWritable).toBe(false);
  expect(state.originalEnded).toBe(true);
});

it("does not drop a database when CREATE failed", async () => {
  state.fault = "collision";
  expect((await run()).code).toBe(3);
  expect(state.queries.some((sql) => sql.startsWith("DROP DATABASE"))).toBe(false);
  expect(state.originalWritable).toBe(false);
  expect(state.originalEnded).toBe(true);
});

it("refuses to apply migrations to a redirected scratch connection", async () => {
  state.fault = "redirect";
  expect((await run()).code).toBe(3);
  expect(state.queries).not.toContain("SELECT 'migration marker'");
  const created = state.queries
    .find((sql) => sql.startsWith("CREATE DATABASE"))
    ?.slice("CREATE DATABASE ".length);
  expect(state.queries).toContain(`DROP DATABASE ${created} WITH (FORCE)`);
});

// The session on the original database starts read-only and is writable only while CREATE or
// DROP DATABASE runs, so anything else sent on it stays read-only.
it("makes the original database's session writable only for CREATE and DROP DATABASE", async () => {
  expect((await run()).code).toBe(0);
  let writable = false;
  const whileWritable: string[] = [];
  for (const sql of state.onOriginal) {
    if (sql === "SET default_transaction_read_only = off") writable = true;
    else if (sql === "SET default_transaction_read_only = on") writable = false;
    else if (writable) whileWritable.push(sql.split(" ").slice(0, 2).join(" "));
  }
  expect(whileWritable).toStrictEqual(["CREATE DATABASE", "DROP DATABASE"]);
  expect(writable).toBe(false);
  expect(state.onOriginal.join("\n")).not.toContain("READ WRITE");
});

it.each(["restore-create", "restore-drop"])(
  "reports %s failure, cleans up and closes the admin connection",
  async (fault) => {
    state.fault = fault;
    const { code, output } = await run();
    expect(code).toBe(3);
    expect(output).toContain("restoring read-only was cancelled");
    expect(state.onOriginal.some((sql) => sql.startsWith("DROP DATABASE"))).toBe(true);
    expect(state.originalEnded).toBe(true);
    if (fault === "restore-create") {
      expect(state.queries).not.toContain("SELECT 'migration marker'");
      expect(state.originalWritable).toBe(false);
    }
  },
);
