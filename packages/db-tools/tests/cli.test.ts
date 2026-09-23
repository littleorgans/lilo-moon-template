import { describe, expect, it } from "vitest";

import { exitCodes, main } from "../src/index.js";

async function run(argv: string[], env: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    env,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr, output: stdout + stderr };
}

// Built rather than written out, so the secrets scan does not read a test URL as a credential.
function withPassword(base: string, password: string): string {
  const url = new URL(base);
  url.username = "svc";
  url.password = password;
  return url.href;
}

describe("rls-verify command line", () => {
  it("prints usage for --help", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(exitCodes.passed);
    expect(stdout).toContain("Usage: rls-verify");
  });

  it("refuses to run without a database URL", async () => {
    const { code, stderr } = await run([]);
    expect(code).toBe(exitCodes.usage);
    expect(stderr).toContain("set DATABASE_URL or pass --url");
  });

  it("rejects an unknown option", async () => {
    const { code, stderr } = await run(["--bogus"], { DATABASE_URL: "postgres://h/d" });
    expect(code).toBe(exitCodes.usage);
    expect(stderr).toContain("'--bogus'");
  });

  it("rejects a URL that is not Postgres without echoing it", async () => {
    const { code, output } = await run(["--url", withPassword("mysql://db/app", "hunter2")]);
    expect(code).toBe(exitCodes.usage);
    expect(output).not.toContain("hunter2");
  });

  it.each([["--seed"], ["--migrations"]])(
    "refuses %s without --disposable, because it writes",
    async (flag) => {
      const { code, stderr } = await run([flag, "x"], { DATABASE_URL: "postgres://h/d" });
      expect(code).toBe(exitCodes.usage);
      expect(stderr).toContain("need --disposable");
    },
  );

  it("reports an unreachable database as a setup failure without the password", async () => {
    const { code, output } = await run([], {
      DATABASE_URL: withPassword("postgres://127.0.0.1:1/app", "s3cr#t-pass"),
    });
    expect(code).toBe(exitCodes.setup);
    expect(output).toContain("could not connect");
    expect(output).not.toMatch(/s3cr(%23|#)t-pass/u);
  });
});
