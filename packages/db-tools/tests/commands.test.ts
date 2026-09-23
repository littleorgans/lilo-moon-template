import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { main } from "../src/commands.js";
import { drizzleKitBin } from "../src/drizzle.js";
import { exitCodes } from "../src/index.js";

async function run(argv: string[], env: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    env,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

function fakePath(scripts: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "db-tools-path-"));
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(directory, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  return directory;
}

// A docker whose daemon answers, so a command gets as far as its next tool.
const dockerUp = "exit 0";

describe("db-tools command line", () => {
  it("prints usage for --help, and to stderr with a usage error when no command is given", async () => {
    expect(await run(["--help"])).toMatchObject({ code: exitCodes.passed });
    expect((await run(["clean", "--help"])).stdout).toContain("Usage: db-tools <command>");
    const bare = await run([]);
    expect(bare.code).toBe(exitCodes.usage);
    expect(bare.stderr).toContain("Usage: db-tools <command>");
  });

  it("rejects an unknown command, an unknown option, and an option the command does not read", async () => {
    expect(await run(["toString"])).toMatchObject({ code: exitCodes.usage });
    expect(await run(["clean", "--bogus"])).toMatchObject({ code: exitCodes.usage });
    const misplaced = await run(["drizzle-check", "--seed", "seed.sql"]);
    expect(misplaced.code).toBe(exitCodes.usage);
    expect(misplaced.stderr).toContain("does not take --seed");
  });

  it("rejects a port that is not a number", async () => {
    const { code, stderr } = await run(["clean", "--port", "5432x"]);
    expect(code).toBe(exitCodes.usage);
    expect(stderr).toContain("--port must be a whole number");
  });

  it.each(["atlas-lint", "drizzle-check", "rls-verify"])(
    "%s skips locally without Docker, saying why",
    async (command) => {
      const { code, stdout } = await run([command], { PATH: fakePath({}) });
      expect(code).toBe(exitCodes.passed);
      expect(stdout).toContain(`db-tools ${command}: skipped locally, docker is not installed`);
    },
  );

  it.each(["atlas-lint", "drizzle-check", "rls-verify"])(
    "%s fails in CI without Docker",
    async (command) => {
      const { code, stderr } = await run([command], { PATH: fakePath({}), CI: "true" });
      expect(code).toBe(exitCodes.setup);
      expect(stderr).toContain("Docker is required in CI");
    },
  );

  it.each(["atlas-diff", "atlas-lint", "drizzle-generate", "drizzle-check"])(
    "%s names a missing atlas before starting a container",
    async (command) => {
      const { code, stderr } = await run([command], { PATH: fakePath({ docker: dockerUp }) });
      expect(code).toBe(exitCodes.setup);
      expect(stderr).toContain("atlas is not on PATH");
    },
  );

  it("says why an atlas on PATH cannot run, rather than calling it missing", async () => {
    const PATH = fakePath({ atlas: 'echo "atlas is not a built-in plugin" >&2; exit 1' });
    const { code, stderr } = await run(["atlas-apply"], {
      PATH,
      DATABASE_URL: "postgres://db/app",
    });
    expect(code).toBe(exitCodes.setup);
    expect(stderr).toContain("atlas version failed: atlas is not a built-in plugin");
  });

  it("atlas-apply needs a URL", async () => {
    const { code, stderr } = await run(["atlas-apply"]);
    expect(code).toBe(exitCodes.usage);
    expect(stderr).toContain("set DATABASE_URL or pass --url");
  });

  it("atlas-apply hands the directory and URL to atlas, and reports its failure as a failure", async () => {
    const record = join(mkdtempSync(join(tmpdir(), "db-tools-atlas-")), "args");
    const PATH = fakePath({
      atlas: `[ "$1" = version ] && exit 0\necho "$@" > "${record}"\nexit 4`,
    });
    const { code, stderr } = await run(["atlas-apply", "--migrations", "sql"], {
      PATH,
      DATABASE_URL: "postgres://db/app",
    });
    expect(readFileSync(record, "utf8").trim()).toBe(
      "migrate apply --dir file://sql --url postgres://db/app",
    );
    expect(code).toBe(exitCodes.failed);
    expect(stderr).toContain("atlas migrate exited with 4");
  });

  it("finds drizzle-kit installed beside the package", () => {
    expect(existsSync(drizzleKitBin())).toBe(true);
  });

  it("reports a clean with nothing to remove", async () => {
    const { code, stdout } = await run(["clean"], { PATH: fakePath({}) });
    expect(code).toBe(exitCodes.passed);
    expect(stdout).toContain("no Postgres container to remove");
  });
});
