import { describe, expect, it } from "vitest";

import { emptyTables, rlsChecks, runChecks } from "../src/index.js";
import type { Queryable } from "../src/index.js";

// Answers every query with the same rows. Enough for checks that read one catalog row.
const answering = (rows: Record<string, unknown>[]): Queryable => ({
  query: async () => await Promise.resolve({ rows }),
});

const roleCheck = rlsChecks({ role: "api" })[0];

describe("the role check", () => {
  it.each([
    [[], "role api does not exist"],
    [[{ rolsuper: true, rolbypassrls: false }], "api is a superuser"],
    [[{ rolsuper: false, rolbypassrls: true }], "api has BYPASSRLS"],
  ])("fails for %j", async (rows, failure) => {
    expect(await roleCheck?.run(answering(rows))).toContain(failure);
  });

  it("passes for a role that policies apply to", async () => {
    expect(await roleCheck?.run(answering([{ rolsuper: false, rolbypassrls: false }]))).toBe(true);
  });
});

describe("runChecks", () => {
  it("reports a check that throws as a failure, with the error code", async () => {
    const lines: string[] = [];
    const failures = await runChecks(
      answering([]),
      [
        {
          name: "raises",
          run: () => Promise.reject(Object.assign(new Error("boom"), { code: "22P02" })),
        },
        // Something that is not an Error still has to be reported, not crash the run.
        // oxlint-disable-next-line prefer-promise-reject-errors
        { name: "rejects oddly", run: () => Promise.reject("odd") },
      ],
      (line) => lines.push(line),
    );
    expect(failures).toStrictEqual(["raises: threw 22P02 boom", "rejects oddly: threw odd"]);
    expect(lines.join("")).toContain("  FAIL  raises\n        threw 22P02 boom\n");
  });
});

describe("emptyTables", () => {
  it("cannot tell empty from scoped when the user is subject to row level security", async () => {
    expect(await emptyTables(answering([{ rolname: "api", bypasses: false }]))).toBeNull();
  });
});
