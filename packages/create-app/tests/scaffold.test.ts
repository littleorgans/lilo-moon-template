import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import type { Choices } from "../src/choices.ts";
import { scaffold } from "../src/scaffold.ts";
import { matches, parseManifest, serializeManifest, substitute, TOKENS } from "../src/template.ts";
import { repository, scratch, template } from "./support.ts";

const choices = (overrides: Partial<Choices>): Choices => ({
  directory: "acme",
  project: "zeta",
  web: null,
  service: null,
  database: false,
  defaulted: [],
  ...overrides,
});

const web = { name: "portal", port: 5300, organizationPolicy: "existing" } as const;
const service = { name: "billing", port: 8800 } as const;

function files(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(root, join(directory, entry.name))
      : [relative(root, join(directory, entry.name))],
  );
}

function create(overrides: Partial<Choices>) {
  const root = join(scratch(), "acme");
  const written = scaffold(template(), choices(overrides), root);
  return { root, written, read: (path: string) => readFileSync(join(root, path), "utf8") };
}

describe("scaffold", () => {
  it("keeps real environment files ignored and leaves no usable shared cookie secret", () => {
    const { root, read, written } = create({ web });
    expect(read(".env.example")).toMatch(/^WORKOS_COOKIE_PASSWORD=$/m);
    expect(written).not.toContain(".env.local");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const paths = [".env", ".env.local", ".env.production", "apps/portal/.env.local"];
    const ignored = execFileSync("git", ["check-ignore", ...paths], {
      cwd: root,
      encoding: "utf8",
    });
    expect(ignored.trim().split("\n")).toStrictEqual(paths);
  });

  it.each([
    "../outside",
    "/absolute",
    "a/../../outside",
    ".git/config",
    "a\\outside",
    "C:/outside",
  ])("refuses unsafe bundle path %s before writing", (path) => {
    const root = join(scratch(), "target");
    const malformed = {
      ...template(),
      files: [
        { path: "safe", content: "", when: {} },
        { path, content: "", when: {} },
      ],
    };
    expect(() => scaffold(malformed, choices({ web }), root)).toThrow("Unsafe template path");
    expect(existsSync(root)).toBe(false);
  });

  it("writes the web app, the service and the database under the chosen names", () => {
    const { root, written, read } = create({ web, service, database: true });
    expect(files(root).toSorted()).toStrictEqual(written.toSorted());
    expect(written).toContain("apps/portal/src/routes/(auth)/callback.ts");
    expect(written).toContain("services/billing/src/main.ts");
    expect(written).toContain("db/migrations/atlas.sum");
    expect(written).not.toContain("services/billing/README.md");
    for (const path of written) expect(read(path)).not.toMatch(/__LILO_[A-Z_]+__/);

    expect(parseManifest(read("apps/portal/package.json"))).toMatchObject({
      name: "@zeta/portal",
      dependencies: { "@zeta/drizzle-schema": "workspace:*", "@littleorgans/auth": "catalog:" },
    });
    expect(read("services/billing/moon.yml")).toContain("--filter @zeta/billing deploy");
    expect(read("services/billing/moon.yml")).toContain("--tag zeta-billing:local");
    expect(read("services/billing/moon.yml")).toContain('PORT: "8800"');
    expect(read("services/billing/src/server/database.ts")).toContain(
      'from "@zeta/drizzle-schema"',
    );
    expect(read(".oxfmtrc.json")).toContain('"@zeta/"');
    expect(JSON.parse(read("tsconfig.json")).references).toStrictEqual([
      { path: "./apps/portal" },
      { path: "./db/drizzle" },
      { path: "./services/billing" },
    ]);
    expect(read("moon.yml")).toContain("db-tools rls-verify --seed db/rls-seed.sql");
  });

  it("prints each manifest as the formatter would once the scope moves its keys", () => {
    const { read } = create({ web, database: true });
    const manifest = read("apps/portal/package.json");
    expect(manifest).toBe(serializeManifest(parseManifest(manifest)));
    const keys = Object.keys(parseManifest(manifest)["dependencies"] ?? {});
    // "zeta" sorts after "littleorgans"; the token sorted first when the build formatted it.
    expect(keys.indexOf("@zeta/drizzle-schema")).toBeGreaterThan(
      keys.indexOf("@littleorgans/views"),
    );
  });

  it("leaves the database out of a web app without one", () => {
    const { written, read } = create({ web });
    expect(written.filter((path) => path.startsWith("db/"))).toStrictEqual(
      written.filter((path) => path.startsWith("db/drizzle/")),
    );
    expect(read("moon.yml")).not.toContain("db-tools");
    expect(read(".env.example")).not.toContain("DATABASE_URL");
    expect(parseManifest(read("package.json"))["devDependencies"]).not.toHaveProperty(
      "@littleorgans/db-tools",
    );
  });

  it("gives a standalone service only its own environment", () => {
    const { written, read } = create({ service, database: true });
    expect(written.some((path) => path.startsWith("apps/"))).toBe(false);
    const environment = read(".env.example");
    expect(environment).toContain("WORKOS_CLIENT_ID=");
    expect(environment).toContain("DATABASE_URL=");
    expect(environment).not.toContain("WORKOS_API_KEY");
    expect(environment).not.toContain("WORKOS_REDIRECT_URI");
    expect(JSON.parse(read("tsconfig.json")).references).toStrictEqual([
      { path: "./db/drizzle" },
      { path: "./services/billing" },
    ]);
  });

  it("copies the reference files the template does not rewrite", () => {
    const { read } = create({ web, service, database: true });
    for (const path of [
      "lefthook.yml",
      "apps/portal/src/routes/index.tsx",
      "db/migrations/atlas.sum",
    ]) {
      const source = path
        .replace("apps/portal/", "apps/web/")
        .replace("db/migrations/", "packages/db/migrations/");
      expect(read(path)).toBe(readFileSync(join(repository, source), "utf8"));
    }
  });
});

describe("the template format", () => {
  it("matches a condition only on the parts it names", () => {
    const parts = { web: true, service: false, database: true };
    expect(matches({}, parts)).toBe(true);
    expect(matches({ web: true, database: true }, parts)).toBe(true);
    expect(matches({ service: true }, parts)).toBe(false);
  });

  it("refuses to write a token no choice filled", () => {
    const values = new Map([[TOKENS.project, "acme"]]);
    expect(substitute(`@${TOKENS.project}/web`, values)).toBe("@acme/web");
    expect(() => substitute(`apps/${TOKENS.web}`, values)).toThrow(
      "The template left __LILO_WEB__ without a value",
    );
  });

  it("refuses a manifest that is not an object", () => {
    expect(() => parseManifest("[]")).toThrow("not a JSON object");
  });
});
