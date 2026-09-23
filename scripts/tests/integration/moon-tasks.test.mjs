import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { commitProject, git, projectCommand } from "../../lib/project-files.mjs";

function moonFixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "baseline-moon-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({
    ".moon/workspace.yml": 'projects:\n  sources:\n    root: "."\nvcs:\n  defaultBranch: "main"\n',
    ".gitignore": ".moon/cache/\n",
    ...files,
  })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Baseline verification"]);
  git(root, ["config", "user.email", "baseline@example.invalid"]);
  commitProject(root, "test: initialize Moon fixture");
  return root;
}

function rootTaskFixture(name, transform = (task) => task) {
  const [header, tasks] = readFileSync("moon.yml", "utf8").split("\ntasks:\n");
  const task = tasks.split(/(?=^  [a-z][\w-]*:)/m).find((entry) => entry.startsWith(`  ${name}:`));
  assert.ok(task, `root must declare ${name}`);
  return `${header}\ntasks:\n${transform(task)}`;
}

function formatTaskFixture() {
  return rootTaskFixture("format-check", (task) =>
    task.replace(
      /^    command:.*$/m,
      `    command: ${JSON.stringify(resolve("node_modules/.bin/oxfmt"))}\n    args: ["--check", "--no-error-on-unmatched-pattern"]`,
    ),
  );
}

await test("web task inheritance requires the web-app tag and has no shared preview port", (t) => {
  const root = moonFixture(t, {
    ".moon/workspace.yml": 'projects:\n  globs: ["apps/*"]\nvcs:\n  defaultBranch: "main"\n',
    ".moon/toolchains.yml": 'javascript:\n  packageManager: "pnpm"\n',
    ".moon/tasks/node.yml": readFileSync(".moon/tasks/node.yml", "utf8"),
    ".moon/tasks/node-application.yml": readFileSync(".moon/tasks/node-application.yml", "utf8"),
    "apps/cli/moon.yml": 'language: "javascript"\nlayer: "application"\n',
    "apps/cli/package.json": '{"name":"fixture-cli","private":true}\n',
    "apps/site/moon.yml": 'language: "javascript"\nlayer: "application"\ntags: ["web-app"]\n',
    "apps/site/package.json": '{"name":"fixture-site","private":true}\n',
  });
  const cli = JSON.parse(projectCommand(root, "moon", ["project", "cli", "--json"], true));
  for (const name of ["build", "dev", "preview"]) {
    assert.equal(cli.tasks?.[name], undefined, `generic JavaScript app inherited ${name}`);
    const task = JSON.parse(projectCommand(root, "moon", ["task", `site:${name}`, "--json"], true));
    assert.equal(task.command, name === "preview" ? "node" : "vite");
    assert.equal(task.env?.PORT, undefined, "each app owns its preview port");
  }
});

await test("format checking invalidates cached success when documentation changes", (t) => {
  const formatter = resolve("node_modules/.bin/oxfmt");
  const root = moonFixture(t, {
    "moon.yml": formatTaskFixture(),
    "docs/guide.md": "# Guide\n",
  });
  projectCommand(root, formatter, [], true);
  projectCommand(root, "moon", ["run", "root:format-check"], true);
  writeFileSync(join(root, "docs/guide.md"), "# Guide\n\n-   malformed\n");
  assert.throws(
    () => projectCommand(root, "moon", ["run", "root:format-check"], true),
    (error) => error.status === 1 && /docs\/guide\.md/.test(`${error.stdout}${error.stderr}`),
    "a documentation change must not reuse the previous green formatting result",
  );
  projectCommand(root, formatter, [], true);
  projectCommand(root, "moon", ["run", "root:format-check"], true);
});

await test("root lockstep gate rejects incompatible pins without application or library members", (t) => {
  const workspace = 'catalog:\n  typescript: "7.0.2"\n';
  const root = moonFixture(t, {
    "moon.yml": rootTaskFixture("tsgolint-lockstep"),
    "scripts/assert-tsgolint-lockstep.mjs": readFileSync(
      "scripts/assert-tsgolint-lockstep.mjs",
      "utf8",
    ),
    "package.json": '{"private":true,"devDependencies":{"oxlint-tsgolint":"7.0.2001"}}\n',
    "pnpm-workspace.yaml": workspace,
  });
  projectCommand(root, "moon", ["run", "root:tsgolint-lockstep"], true);
  writeFileSync(join(root, "pnpm-workspace.yaml"), workspace.replace("7.0.2", "7.0.3"));
  assert.throws(
    () => projectCommand(root, "moon", ["run", "root:tsgolint-lockstep"], true),
    (error) =>
      error.status === 1 && /encodes TypeScript 7\.0\.2/.test(`${error.stdout}${error.stderr}`),
    "the repository gate must reject mismatched tooling pins without relying on members",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), workspace);
  projectCommand(root, "moon", ["run", "root:tsgolint-lockstep"], true);
});

await Promise.all(
  ["format-check", "lint", "secrets"].map((taskName) =>
    test(`${taskName} forwards grouped filenames and shell characters as literal arguments`, (t) => {
      const names = ["apps/web/src/routes/(auth)/callback.ts", "docs/a file.md", "docs/$HOME.md"];
      const root = moonFixture(t, {
        "moon.yml": rootTaskFixture(taskName, (task) =>
          task
            .replace(/^    command:.*$/m, '    command: "node record-argv.mjs"')
            .replace(/^    deps:\n(?:      .*\n)+/m, ""),
        ),
        "record-argv.mjs":
          'import {writeFileSync} from "node:fs"; writeFileSync("argv.json", JSON.stringify(process.argv.slice(2)));\n',
      });
      projectCommand(root, "moon", ["run", `root:${taskName}`, "--", ...names], true);
      assert.deepEqual(JSON.parse(readFileSync(join(root, "argv.json"), "utf8")), names);
    }),
  ),
);

await test("format checking accepts grouped paths and rejects malformed selected files", (t) => {
  const file = "apps/web/src/routes/(auth)/a $value.ts";
  const root = moonFixture(t, {
    "moon.yml": formatTaskFixture(),
    [file]: "export const value = 1;\n",
  });
  projectCommand(root, "moon", ["run", "root:format-check", "--", file], true);
  writeFileSync(join(root, file), "export const value={a:1}\n");
  assert.throws(
    () => projectCommand(root, "moon", ["run", "root:format-check", "--", file], true),
    (error) => error.status === 1 && `${error.stdout}${error.stderr}`.includes(file),
    "the selected file must reach the formatter without shell interpretation",
  );
  projectCommand(root, resolve("node_modules/.bin/oxfmt"), [file], true);
  projectCommand(root, "moon", ["run", "root:format-check", "--", file], true);
});
