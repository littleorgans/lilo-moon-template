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
      ],
      (line) => lines.push(line),
    );
    expect(failures).toStrictEqual(["raises: threw 22P02 boom"]);
    expect(lines.join("")).toContain("  FAIL  raises\n        threw 22P02 boom\n");
  });
  it.each(["08006", "57014", undefined])("propagates unexpected errors (%s)", async (code) => {
    await expect(
      runChecks(
        answering([]),
        [
          {
            name: "broken",
            run: () => Promise.reject(Object.assign(new Error("unexpected"), { code })),
          },
        ],
        () => undefined,
      ),
    ).rejects.toThrow("broken: threw");
  });
});

describe("emptyTables", () => {
  it("cannot tell empty from scoped when the user is subject to row level security", async () => {
    expect(await emptyTables(answering([{ rolname: "api", bypasses: false }]))).toBeNull();
  });
});
