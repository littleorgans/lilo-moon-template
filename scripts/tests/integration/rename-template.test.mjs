import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { initializeProject, projectEnvironment, writeJson } from "../../lib/project-files.mjs";

// The tokens are assembled from fragments, as the script does, so a renamed project keeps a
// test that still describes the template rather than one the rename rewrote into nonsense.
const org = ["little", "organs"].join("");
const legacy = ["lilo", "moon"].join("-");
const slug = `${legacy}-template`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rename-template-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["scripts", "packages/auth", "packages/auth-session/src", "apps/web/src"])
    mkdirSync(join(root, path), { recursive: true });
  cpSync("scripts/rename-template.sh", join(root, "scripts/rename-template.sh"));
  mkdirSync(join(root, ".changeset"));
  writeJson(join(root, "package.json"), { name: slug, private: true });
  writeJson(join(root, "packages/auth/package.json"), {
    name: `@${org}/auth`,
    repository: { type: "git", url: `git+https://github.com/${org}/${slug}.git` },
    exports: { ".": { [`@${org}/source`]: "./src/index.ts", default: "./dist/index.js" } },
    dependencies: { [`@${org}/db`]: "workspace:*" },
  });
  writeFileSync(
    join(root, "apps/web/src/index.ts"),
    `import { verify } from "@${org}/auth";\nimport "@${org}/views/sign-in";\n`,
  );
  writeFileSync(
    join(root, "vitest.config.ts"),
    `export default { server: { deps: { inline: [/[/\\\\]@${org}[/\\\\]/] } } };\n`,
  );
  writeFileSync(
    join(root, "packages/auth-session/src/config.ts"),
    `hkdfSync("sha256", password, "${legacy}-session", "session-cookie-v1", 32);\n`,
  );
  writeJson(join(root, ".changeset/config.json"), {
    changelog: ["@changesets/changelog-github", { repo: `${org}/${slug}` }],
  });
  writeFileSync(join(root, ".changeset/pending.md"), `---\n"@${org}/auth": minor\n---\n`);
  writeFileSync(join(root, "LICENSE"), `MIT License\n\nCopyright (c) 2026 ${org}\n`);
  writeFileSync(
    join(root, "README.md"),
    `Packages publish under \`@${org}\`. The GitHub org is ${org}: https://github.com/${org}\n`,
  );
  initializeProject(root, "test: rename fixture");
  return root;
}

function rename(root, args) {
  return spawnSync("bash", ["scripts/rename-template.sh", ...args], {
    cwd: root,
    env: projectEnvironment(),
    encoding: "utf8",
  });
}

const read = (root, path) => readFileSync(join(root, path), "utf8");
const readJson = (root, path) => JSON.parse(read(root, path));

function assertRenamed(root, { org: targetOrg, scope, slug: targetSlug }) {
  const manifest = readJson(root, "packages/auth/package.json");
  assert.equal(manifest.name, `@${scope}/auth`);
  assert.equal(manifest.repository.url, `git+https://github.com/${targetOrg}/${targetSlug}.git`);
  assert.deepEqual(Object.keys(manifest.exports["."]), [`@${scope}/source`, "default"]);
  assert.deepEqual(Object.keys(manifest.dependencies), [`@${scope}/db`]);
  assert.equal(readJson(root, "package.json").name, targetSlug);
  assert.equal(
    read(root, "apps/web/src/index.ts"),
    `import { verify } from "@${scope}/auth";\nimport "@${scope}/views/sign-in";\n`,
  );
  assert.equal(
    read(root, "vitest.config.ts"),
    `export default { server: { deps: { inline: [/[/\\\\]@${scope}[/\\\\]/] } } };\n`,
  );
  assert.equal(
    read(root, "packages/auth-session/src/config.ts"),
    `hkdfSync("sha256", password, "${scope}-session", "session-cookie-v1", 32);\n`,
  );
  assert.equal(
    readJson(root, ".changeset/config.json").changelog[1].repo,
    `${targetOrg}/${targetSlug}`,
  );
  assert.equal(read(root, ".changeset/pending.md"), `---\n"@${scope}/auth": minor\n---\n`);
  assert.equal(read(root, "LICENSE"), `MIT License\n\nCopyright (c) 2026 ${targetOrg}\n`);
  assert.equal(
    read(root, "README.md"),
    `Packages publish under \`@${scope}\`. The GitHub org is ${targetOrg}: https://github.com/${targetOrg}\n`,
  );
}

await test("rename rewrites the scope and the org separately when they differ", (t) => {
  const root = fixture(t);
  const result = rename(root, ["acme", "widgetco", "widget-app", "--no-install"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rename verification passed/);
  assertRenamed(root, { org: "acme", scope: "widgetco", slug: "widget-app" });
  // Exit 1 means no match. An empty stdout alone would also pass when git grep itself fails.
  const leaked = spawnSync("git", ["grep", "-n", "@acme"], {
    cwd: root,
    env: projectEnvironment(),
    encoding: "utf8",
  });
  assert.equal(
    leaked.status,
    1,
    `the org must never appear where the scope belongs\n${leaked.stdout}`,
  );
});

await test("rename produces one token when the org and the scope are the same", (t) => {
  const root = fixture(t);
  const result = rename(root, ["sameco", "sameco", "same-app", "--no-install"]);
  assert.equal(result.status, 0, result.stderr);
  assertRenamed(root, { org: "sameco", scope: "sameco", slug: "same-app" });
});

await test("validation rejects targets that reuse a template identity token", (t) => {
  const root = fixture(t);
  for (const args of [
    ["acme", org, "widget-app"],
    [org, "widgetco", "widget-app"],
    ["acme", legacy, "widget-app"],
    ["acme", "widgetco", slug],
  ]) {
    assert.equal(rename(root, ["--validate", ...args]).status, 64, args.join(" "));
  }
  assert.equal(rename(root, ["--validate", "acme", "widgetco", "widget-app"]).status, 0);
});
