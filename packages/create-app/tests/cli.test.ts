import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CliIo } from "../src/cli.ts";
import { exitCodes, main, processIo } from "../src/cli.ts";
import { scratch, template } from "./support.ts";

async function run(argv: string[], answers?: string[]) {
  const cwd = scratch();
  let stdout = "";
  let stderr = "";
  const questions: string[] = [];
  const io: CliIo = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ask:
      answers === undefined
        ? undefined
        : (question) => {
            questions.push(question);
            return Promise.resolve(answers.shift() ?? "");
          },
    template,
  };
  const code = await main(argv, io);
  return { code, stdout, stderr, cwd, questions };
}

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

describe("create-app", () => {
  it("prints a literal absolute cd command for shell metacharacters in the target", async () => {
    const directory = "space ' $(touch injected) ; project";
    const { stdout, cwd, code } = await run([directory, "--name", "safe", "--service"]);
    expect(code).toBe(exitCodes.created);
    const command = stdout.split("\n").find((line) => line.trimStart().startsWith("cd "));
    expect(command).toBeDefined();
    const landed = execFileSync("/bin/sh", ["-c", `${command} && pwd -P`], {
      cwd,
      encoding: "utf8",
    }).trim();
    expect(landed).toBe(
      execFileSync("/bin/pwd", ["-P"], { cwd: join(cwd, directory), encoding: "utf8" }).trim(),
    );
    expect(existsSync(join(cwd, "injected"))).toBe(false);
  });

  it("prints usage naming the release and the reference's defaults", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(exitCodes.created);
    expect(stdout).toMatch(/^Usage: create-app /);
    expect(stdout).toContain(`@littleorgans packages at ${template().version}`);
    expect(stdout).toContain(`Default: ${template().defaults.webPort}.`);
  });

  it("creates a web app with a database, and prints the steps the guides describe", async () => {
    const { code, stdout, cwd } = await run([
      "acme",
      "--web",
      "--db",
      "--web-name",
      "portal",
      "--web-port",
      "5300",
      "--organization-policy",
      "existing",
    ]);
    expect(code).toBe(exitCodes.created);
    const root = join(cwd, "acme");
    expect(read(root, "apps/portal/vite.config.ts")).toContain("port: 5300,");
    expect(read(root, "apps/portal/src/server/auth.ts")).toContain(
      'organizationPolicy: "existing",',
    );
    expect(read(root, ".env.example")).toContain(
      "WORKOS_REDIRECT_URI=http://localhost:5300/callback",
    );
    expect(stdout).toContain("Register http://localhost:5300/callback under Redirects");
    expect(stdout).toContain(
      "-v login_role=acme_portal -f apps/portal/node_modules/@littleorgans/db/grants/login-role.sql",
    );
    expect(stdout).toContain("moon ci --force");
    expect(stdout).toContain(
      "ERR_PNPM_NO_MATURE_MATCHING_VERSION, wait, or review and approve exact",
    );
    expect(stdout).toContain("moon run portal:dev");
    expect(stdout).toContain("--name acme, the directory's name");
    expect(stdout).toContain(
      `https://github.com/littleorgans/lilo-moon-template/blob/v${template().version}/docs/guides/adopt-web-app.md`,
    );
  });

  it("quotes role identifiers even when valid names combine into a SQL keyword", async () => {
    const { code, stdout } = await run(["current", "--service", "--service-name", "user"]);
    expect(code).toBe(exitCodes.created);
    expect(stdout).toContain(`-c 'CREATE ROLE "current_user" LOGIN`);
    expect(stdout).toContain(`-c '\\password "current_user"'`);
    expect(stdout).toContain("-v login_role=current_user -f services/user/");
  });

  it("points a standalone service at the service guide and its own role", async () => {
    const { code, stdout } = await run(["billing-co", "--service", "--service-name", "billing"]);
    expect(code).toBe(exitCodes.created);
    expect(stdout).toContain('CREATE ROLE "billing_co_billing" LOGIN');
    expect(stdout).toContain("the client of the web app that");
    expect(stdout).not.toContain("Register http");
    expect(stdout).toContain("docs/guides/adopt-service.md");
  });

  it.each([
    ["acme", "typo"],
    ["acme", "web", "personal", "maybe"],
  ])("refuses invalid terminal answers without creating a project: %s", async (...answers) => {
    const { code, stderr, cwd } = await run([], answers);
    expect(code).toBe(exitCodes.usage);
    expect(stderr).toMatch(/Choose web, service or both|Answer yes or no/);
    expect(existsSync(join(cwd, "acme"))).toBe(false);
  });

  it("asks a person at a terminal only for what has no default", async () => {
    const { code, questions, cwd } = await run([], ["acme", "web", "personal", "y"]);
    expect(code).toBe(exitCodes.created);
    expect(questions).toHaveLength(4);
    expect(existsSync(join(cwd, "acme/db/rls-seed.sql"))).toBe(true);
    expect(read(join(cwd, "acme"), "apps/web/src/server/auth.ts")).toContain('"personal"');
  });

  it("asks nothing that flags already answered", async () => {
    const { code, questions, cwd } = await run(["acme", "--service"], []);
    expect(code).toBe(exitCodes.created);
    expect(questions).toStrictEqual([]);
    expect(existsSync(join(cwd, "acme/services/api/src/main.ts"))).toBe(true);
  });

  it("answers both, and no database, from a terminal", async () => {
    const { cwd } = await run(["acme"], ["both", "existing"]);
    expect(existsSync(join(cwd, "acme/apps/web"))).toBe(true);
    expect(existsSync(join(cwd, "acme/services/api"))).toBe(true);
  });

  it("names every missing choice without a terminal, and writes nothing", async () => {
    const { code, stderr, cwd } = await run(["acme", "--web"]);
    expect(code).toBe(exitCodes.usage);
    expect(stderr).toContain("--organization-policy is required with --web");
    expect(existsSync(join(cwd, "acme"))).toBe(false);
  });

  it("refuses unknown options and a second directory", async () => {
    expect((await run(["acme", "--wbe"])).code).toBe(exitCodes.usage);
    const two = await run(["acme", "other", "--service"]);
    expect(two.code).toBe(exitCodes.usage);
    expect(two.stderr).toContain("Give one directory, not 2.");
  });

  it("never writes into a directory that holds anything but .git", async () => {
    const cwd = scratch();
    const target = join(cwd, "acme");
    mkdirSync(join(target, ".git"), { recursive: true });
    const io: CliIo = {
      cwd,
      stdout: () => {},
      stderr: () => {},
      ask: undefined,
      template,
    };
    expect(await main(["acme", "--service"], io)).toBe(exitCodes.created);

    let stderr = "";
    const again = await main(["acme", "--service"], { ...io, stderr: (text) => (stderr += text) });
    expect(again).toBe(exitCodes.failed);
    expect(stderr).toContain("is not empty");

    const kept = join(cwd, "kept");
    mkdirSync(kept);
    writeFileSync(join(kept, "notes.md"), "mine\n");
    expect(await main(["kept", "--service"], io)).toBe(exitCodes.failed);
    expect(read(kept, "notes.md")).toBe("mine\n");
    expect(existsSync(join(kept, "package.json"))).toBe(false);
  });
});

describe("the process's own streams", () => {
  it("asks nothing without a terminal, and reads the template the build writes", () => {
    const io = processIo();
    expect(io.ask).toBeUndefined();
    io.stdout("");
    io.stderr("");
    // Only the build writes dist/template.json; the source directory has none.
    expect(() => io.template()).toThrow(/template\.json/);
  });
});
