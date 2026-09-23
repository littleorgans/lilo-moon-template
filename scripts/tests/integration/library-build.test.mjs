import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";

import { projectCommand, projectEnvironment, writeJson } from "../../lib/project-files.mjs";

await test("library rebuilds remove artifacts whose source was deleted", (t) => {
  const root = mkdtempSync(join(tmpdir(), "baseline-library-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".moon/tasks"), { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, ".moon/workspace.yml"),
    'projects:\n  sources:\n    fixture: "."\nvcs:\n  defaultBranch: "main"\n',
  );
  writeFileSync(join(root, ".moon/toolchains.yml"), 'javascript:\n  packageManager: "pnpm"\n');
  writeFileSync(
    join(root, ".moon/tasks/node-library.yml"),
    readFileSync(".moon/tasks/node-library.yml", "utf8"),
  );
  writeFileSync(
    join(root, "moon.yml"),
    'language: "typescript"\nlayer: "library"\nfileGroups:\n  sources: ["src/**/*"]\n',
  );
  writeJson(join(root, "package.json"), { name: "fixture-library", type: "module" });
  writeJson(join(root, "tsconfig.build.json"), {
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext",
      rootDir: "src",
      outDir: "dist",
      declaration: true,
      declarationMap: true,
    },
    include: ["src/**/*.ts"],
  });
  for (const name of ["retained", "removed"]) {
    writeFileSync(join(root, `src/${name}.ts`), `export const ${name} = "${name}";\n`);
  }
  const task = JSON.parse(projectCommand(root, "moon", ["task", "fixture:build", "--json"], true));
  assert.equal(typeof task.script, "string");
  const build = () =>
    execFileSync("bash", ["-c", task.script], {
      cwd: root,
      env: {
        ...projectEnvironment(),
        PATH: `${resolve("node_modules/.bin")}${delimiter}${process.env.PATH}`,
      },
      stdio: "pipe",
    });
  build();
  for (const extension of ["js", "d.ts", "d.ts.map"]) {
    assert.ok(existsSync(join(root, `dist/removed.${extension}`)));
  }
  rmSync(join(root, "src/removed.ts"));
  build();
  for (const extension of ["js", "d.ts", "d.ts.map"]) {
    assert.equal(existsSync(join(root, `dist/removed.${extension}`)), false, extension);
    assert.ok(existsSync(join(root, `dist/retained.${extension}`)), extension);
  }
});
