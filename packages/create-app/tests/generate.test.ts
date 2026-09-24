import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkTemplate,
  CHOICES,
  generateTemplate,
  main,
  repositoryOf,
} from "../src/generate/index.ts";
import {
  dependencies,
  parseObject,
  recordField,
  Reference,
  replace,
  stringField,
} from "../src/generate/reference.ts";
import { editSequence, parseYaml } from "../src/generate/yaml.ts";
import type { Template } from "../src/template.ts";
import { matches } from "../src/template.ts";
import { repository, scratch, template } from "./support.ts";

const version: string = JSON.parse(
  readFileSync(join(repository, "packages/create-app/package.json"), "utf8"),
).version;

const content = (path: string, when: Template["files"][number]["when"] = {}) => {
  const found = template().files.find(
    (file) => file.path === path && JSON.stringify(file.when) === JSON.stringify(when),
  );
  if (found === undefined) throw new Error(`no ${path} for ${JSON.stringify(when)}`);
  return found.content;
};

/**
 * This checkout's files, as Git lists them, in a new repository a test may change. It has no
 * installs, so only a change the generator refuses before formatting can be tried on it.
 */
function copyReference(): string {
  const root = join(scratch(), "reference");
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: repository,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(repository, file)));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(repository, file), join(root, file));
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

function edit(root: string, path: string, change: (text: string) => string) {
  writeFileSync(join(root, path), change(readFileSync(join(root, path), "utf8")));
}

describe("the generated template", () => {
  it("installs every published package at this release and calls its CI workflow tag", () => {
    expect(template().version).toBe(version);
    const workspace = content("pnpm-workspace.yaml");
    expect(workspace).toContain(`"@littleorgans/auth": "^${version}"`);
    expect(workspace).toContain(`"@littleorgans/db-tools": "^${version}"`);
    expect(workspace).not.toContain("catalogs:");
    expect(workspace).not.toContain("workspace:");
    expect(content(".github/workflows/ci.yml")).toContain(
      `uses: littleorgans/lilo-moon-template/.github/workflows/moon-ci.yml@v${version}`,
    );
    expect(JSON.parse(content("renovate.json"))).toStrictEqual({
      $schema: "https://docs.renovatebot.com/renovate-schema.json",
      extends: ["github>littleorgans/lilo-moon-template//renovate/base"],
    });
  });

  it("keeps this repository's publishing, tests and documentation out", () => {
    const paths = new Set(template().files.map(({ path }) => path));
    for (const path of [
      ".changeset/config.json",
      "scripts/published-shape.mjs",
      "README.md",
      "LICENSE",
    ]) {
      expect(paths.has(path)).toBe(false);
    }
    for (const database of [true, false]) {
      const moon = content("moon.yml", { database });
      expect(moon).not.toMatch(/published-shape|scripts-test|release-rehearsal|packages\/db/);
      const tools = JSON.parse(content("package.json", { database })).devDependencies;
      expect(tools).not.toHaveProperty("@changesets/cli");
      expect(tools).not.toHaveProperty("publint");
      expect("@littleorgans/db-tools" in tools).toBe(database);
    }
    expect(content(".gitignore")).not.toContain("skills");
    expect(content("db/schema.sql", { database: true })).not.toContain("packages/db");
  });

  it("writes each path once for every combination a project can choose", () => {
    for (const parts of CHOICES) {
      const paths = template()
        .files.filter(({ when }) => matches(when, parts))
        .map(({ path }) => path);
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths).toContain("moon.yml");
      expect(paths).toContain(".env.example");
      expect(paths).toContain("tsconfig.json");
    }
  });

  it("writes the template for the build", () => {
    const output = join(scratch(), "dist/template.json");
    main([repository, output]);
    expect(JSON.parse(readFileSync(output, "utf8")).version).toBe(version);
    expect(() => main([repository])).toThrow("Usage: node src/generate/index.ts");
  });
});

// The template cannot drift from the reference silently: anything the generator does not know
// what to do with stops the build, and so the release.
describe("a reference change the generator does not know", () => {
  it.each(["apps/web/moon.yml", "services/api/Dockerfile", "services/api/tsconfig.json"])(
    "stops the build for a deleted rewrite target %s",
    (path) => {
      const root = copyReference();
      rmSync(join(root, path));
      expect(() => generateTemplate(root)).toThrow(`no file ${path}`);
    },
  );

  it("refuses binary assets instead of silently replacing invalid UTF-8 bytes", () => {
    const root = copyReference();
    writeFileSync(join(root, "apps/web/photo.png"), Buffer.from([137, 80, 78, 71, 0]));
    expect(() => generateTemplate(root)).toThrow("binary assets need explicit template support");
  });

  it("refuses symlinks and even forcibly tracked environment values", () => {
    const root = copyReference();
    const path = "apps/web/.env.local";
    writeFileSync(join(root, path), "SECRET=do-not-copy");
    execFileSync("git", ["add", "--force", path], { cwd: root });
    expect(() => generateTemplate(root)).toThrow(
      "environment values must never enter the template",
    );
    rmSync(join(root, path));
    symlinkSync(join(root, ".env.example"), join(root, "apps/web/leak.txt"));
    expect(() => generateTemplate(root)).toThrow("classify symbolic links");
  });

  it("stops the build for a new root file", () => {
    const root = copyReference();
    writeFileSync(join(root, "deploy.toml"), "");
    expect(() => generateTemplate(root)).toThrow(/deploy\.toml at the reference root/);
  });

  it("does not mistake Object prototype keys for classified root entries", () => {
    const root = copyReference();
    writeFileSync(join(root, "constructor"), "");
    expect(() => generateTemplate(root)).toThrow(/constructor at the reference root/);
  });

  it("stops the build for a new root task", () => {
    const root = copyReference();
    edit(root, "moon.yml", (text) => `${text}\n  deploy:\n    command: "true"\n`);
    expect(() => generateTemplate(root)).toThrow("new: deploy; gone: none");
  });

  it.each([
    (text: string) => text.replace("WORKOS_API_KEY=", "NEW_SECRET=\nWORKOS_API_KEY="),
    (text: string) => text.replace(/WORKOS_CLIENT_ID=([^\n]+)\n\n/, "WORKOS_CLIENT_ID=$1\n"),
  ])(
    "refuses new variables or merged classifications inside an existing environment paragraph",
    (change) => {
      const root = copyReference();
      edit(root, ".env.example", change);
      expect(() => generateTemplate(root)).toThrow("classify this paragraph");
    },
  );

  it("stops the build for a new .env.example paragraph", () => {
    const root = copyReference();
    edit(root, ".env.example", (text) => `${text}\n# Optional.\nSENTRY_DSN=\n`);
    expect(() => generateTemplate(root)).toThrow(/classify this paragraph[\s\S]*SENTRY_DSN/);
  });

  it("stops the build when an anchor it rewrites moved", () => {
    const root = copyReference();
    edit(root, "services/api/moon.yml", (text) =>
      text.replace("littleorgans-api:local", "api:local"),
    );
    expect(() => generateTemplate(root)).toThrow('expected 1 of "--tag littleorgans-api:local"');
  });

  it("stops the build for a workspace dependency nothing publishes", () => {
    const root = copyReference();
    edit(root, "apps/web/package.json", (text) =>
      text.replace(
        '"dependencies": {',
        '"dependencies": {\n    "@littleorgans/api": "workspace:*",',
      ),
    );
    expect(() => generateTemplate(root)).toThrow(
      "@littleorgans/api, a workspace package nothing publishes",
    );
  });

  it("stops the build when the packages do not share create-app's version", () => {
    const root = copyReference();
    edit(root, "packages/auth/package.json", (text) =>
      text.replace(`"version": "${version}"`, '"version": "9.9.9"'),
    );
    expect(() => generateTemplate(root)).toThrow("they release together");
  });
});

describe("the editing primitives", () => {
  it("refuses an anchor that occurs a different number of times", () => {
    expect(replace("a a", { from: "a", to: "b", file: "f", count: 2 })).toBe("b b");
    expect(() => replace("a", { from: "c", to: "b", file: "f" })).toThrow("expected 1");
  });

  it("refuses to edit a sequence item that is not there", () => {
    const document = parseYaml("list:\n  - a\n", "f.yml");
    expect(() =>
      editSequence(document, { path: ["list"], items: new Map([["b", null]]), file: "f.yml" }),
    ).toThrow("no longer lists b");
    expect(() =>
      editSequence(document, { path: ["missing"], items: new Map(), file: "f.yml" }),
    ).toThrow("is not a sequence");
    expect(() => parseYaml("a: [", "bad.yml")).toThrow("bad.yml");
  });
});

describe("the template checks", () => {
  it("refuses a choice that writes one path twice", () => {
    const twice = [
      { path: "moon.yml", when: {}, content: "" },
      { path: "moon.yml", when: { web: true }, content: "" },
    ];
    expect(() => checkTemplate(twice)).toThrow("writes moon.yml twice");
  });

  it("refuses a manifest the command line would print differently", () => {
    const manifest = { path: "package.json", when: {}, content: '{ "name": "acme" }\n' };
    expect(() => checkTemplate([manifest])).toThrow("not formatted as JSON.stringify prints it");
  });

  it("reads the repository from a GitHub URL only", () => {
    expect(repositoryOf("git+https://github.com/littleorgans/lilo-moon-template.git")).toBe(
      "littleorgans/lilo-moon-template",
    );
    expect(() => repositoryOf("https://gitlab.com/a/b.git")).toThrow("not on GitHub");
  });
});

describe("reading the reference", () => {
  it("refuses manifests whose shape the generator cannot trust", () => {
    expect(() => parseObject("[]", "a.json")).toThrow("a.json is not a JSON object");
    expect(() => dependencies({ dependencies: [] }, "dependencies", "a.json")).toThrow(
      "dependencies is not an object",
    );
    expect(() => dependencies({ dependencies: { a: 1 } }, "dependencies", "a.json")).toThrow(
      "dependencies.a is not a string",
    );
    expect(dependencies({}, "devDependencies", "a.json")).toStrictEqual({});
    expect(() => stringField({}, "name", "a.json")).toThrow("a.json has no string name");
    expect(() => recordField({}, "scripts", "a.json")).toThrow("a.json has no object scripts");
  });

  it("refuses a path it does not hold", () => {
    const reference = new Reference(repository);
    expect(() => reference.read("no/such/file")).toThrow("has no file no/such/file");
    expect(() => reference.files("no-such-directory")).toThrow("no files under no-such-directory/");
  });
});
