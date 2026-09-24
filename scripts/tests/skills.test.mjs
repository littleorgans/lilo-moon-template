import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { commitProject, git } from "../lib/project-files.mjs";
import { citations } from "../lib/skills.mjs";

const check = resolve("scripts/check-skills.mjs");
const sync = resolve("scripts/sync-skills.mjs");

function skill(name, body, description = `Use when testing ${name}.`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`;
}

const BUNDLE = `schema_version = 1

[bundles.build-core]
description = "Fixture skills"
members = [
  "build/alpha",
  "build/beta",
]
`;

// A repository with two skills that cite a file, a directory, a glob and one another, tagged v0.1.0.
function repository(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "skills-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, {
    "docs/guide.md": "# Guide\n",
    "packages/auth/src/verify.ts": "export {};\n",
    "packages/auth-http/src/index.ts": "export {};\n",
    "skills/lilo/settings.toml": BUNDLE,
    "skills/lilo/build/alpha/SKILL.md": skill(
      "alpha",
      "Read `docs/guide.md`, `packages/auth*` and `packages/auth/src/`. See [beta](../beta/SKILL.md).",
    ),
    "skills/lilo/build/beta/SKILL.md": skill("beta", "Your own `apps/<name>/src/server/auth.ts`."),
    ...files,
  });
  git(root, ["init", "--initial-branch=main"]);
  // A global ignore of build/ would drop the skill domain; the repository re-includes it in .gitignore.
  git(root, ["config", "core.excludesFile", "/dev/null"]);
  git(root, ["config", "user.name", "Skills verification"]);
  git(root, ["config", "user.email", "skills@example.invalid"]);
  commitProject(root, "test: initialize skills fixture");
  git(root, ["tag", "v0.1.0"]);
  return root;
}

function write(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

function run(script, root, args = []) {
  const result = spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function catalog(t) {
  const root = mkdtempSync(join(tmpdir(), "skills-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, {
    "skills/tm/runtime/other/SKILL.md": skill("other", "Another owner."),
    "skills/lilo/build/retired/SKILL.md": skill("retired", "Removed from the repository."),
  });
  return root;
}

await test("a cited path is a code span from the repository root, outside fences and placeholders", () => {
  const markdown = [
    "`docs/a.md` `packages/{auth,db}/` `AGENTS.md` `apps/<name>/x.ts` `src/server/` `root:lint`",
    "`@littleorgans/db` `https://example.com/docs/a.md` `moon run web:build` `docs/b.md#section`",
    "```sh",
    "cat `docs/fenced.md`",
    "```",
  ].join("\n");
  assert.deepEqual(citations(markdown), [
    "docs/a.md",
    "packages/{auth,db}/",
    "AGENTS.md",
    "docs/b.md",
  ]);
  // A top-level directory the fixed list lacks is still a root when the tree has it.
  assert.deepEqual(citations("`tools/x.mjs`", ["tools"]), ["tools/x.mjs"]);
});

await test("the check passes cited files, directories and globs, and fails a path that does not exist", (t) => {
  const root = repository(t);
  const passing = run(check, root);
  assert.equal(passing.status, 0, passing.output);
  assert.match(passing.output, /2 skills; the 3 paths they cite exist in the working tree/);

  for (const [bogus, cited] of [
    ["`docs/missing.md`", "docs/missing.md"],
    ["`packages/nothing*`", "packages/nothing*"],
    ["`docs/guide.md/`", "docs/guide.md/"],
    ["`packages/{auth,db}/`", "packages/{auth,db}/"],
  ]) {
    write(root, { "skills/lilo/build/beta/SKILL.md": skill("beta", `Read ${bogus}.`) });
    const failing = run(check, root);
    assert.equal(failing.status, 1, `${bogus} passed: ${failing.output}`);
    assert.match(
      failing.output,
      new RegExp(`beta/SKILL.md: cites ${RegExp.escape(cited)}, which is not`),
    );
  }
});

await test("a tracked file deleted from the working tree fails the skills that cite it", (t) => {
  const root = repository(t);
  unlinkSync(join(root, "docs/guide.md"));
  const result = run(check, root);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /alpha\/SKILL.md: cites docs\/guide.md, which is not in the working tree/,
  );
});

await test("a path added after the release tag passes in the working tree and fails at the tag", (t) => {
  const root = repository(t);
  write(root, {
    "docs/new.md": "# New\n",
    "skills/lilo/build/beta/SKILL.md": skill("beta", "Read `docs/new.md`."),
  });
  assert.equal(run(check, root).status, 0);
  const atTag = run(check, root, ["--at", "v0.1.0"]);
  assert.equal(atTag.status, 1, atTag.output);
  assert.match(atTag.output, /cites docs\/new.md, which is not at v0.1.0/);
  assert.equal(run(check, root, ["--at"]).status, 2);
});

await test("the check refuses what the catalog would refuse or render wrongly", (t) => {
  const cases = [
    [
      { "skills/lilo/build/beta/SKILL.md": skill("gamma", "Named for another directory.") },
      /beta\/SKILL.md: frontmatter needs exactly one name, and it must be beta/,
    ],
    [
      { "skills/lilo/build/beta/SKILL.md": skill("beta", "No description.", "") },
      /beta\/SKILL.md: frontmatter needs exactly one one-line description/,
    ],
    [
      { "skills/lilo/build/beta/SKILL.md": "# beta\n\nNo frontmatter.\n" },
      /beta\/SKILL.md: missing YAML frontmatter/,
    ],
    [
      { "skills/lilo/beta/SKILL.md": skill("beta", "One level short.") },
      /skills\/lilo\/beta\/SKILL.md: a skill is skills\/lilo\/<domain>\/<skill>\/SKILL.md/,
    ],
    [
      { "skills/lilo/build/notes.md": "Loose.\n" },
      /skills\/lilo\/build\/notes.md: outside any skill/,
    ],
    [
      { "skills/lilo/build/Beta_2/SKILL.md": skill("Beta_2", "Bad component.") },
      /Beta_2 is not a valid ID part/,
    ],
    [
      { "skills/lilo/settings.toml": BUNDLE.replace('"build/beta"', '"build/gamma"') },
      /bundle build-core names unknown skill build\/gamma/,
    ],
    [
      { "skills/lilo/settings.toml": BUNDLE.replace("schema_version = 1", "schema_version = 2") },
      /settings.toml: schema_version must be 1/,
    ],
    [
      { "skills/lilo/build/beta/SKILL.md": skill("beta", "[guide](../../../../docs/guide.md)") },
      /link \.\.\/\.\.\/\.\.\/\.\.\/docs\/guide.md leaves skills\/lilo/,
    ],
    [
      { "skills/lilo/build/beta/SKILL.md": skill("beta", "[gamma](../gamma/SKILL.md#top)") },
      /link \.\.\/gamma\/SKILL.md#top names nothing in skills\/lilo/,
    ],
  ];
  for (const [files, expected] of cases) {
    const root = repository(t);
    write(root, files);
    const result = run(check, root);
    assert.equal(result.status, 1, `${expected.source} passed: ${result.output}`);
    assert.match(result.output, expected);
  }

  const root = repository(t);
  symlinkSync("SKILL.md", join(root, "skills/lilo/build/beta/linked.md"));
  const linked = run(check, root);
  assert.equal(linked.status, 1, linked.output);
  assert.match(linked.output, /beta\/linked.md: skills must not contain symlinks/);
});

await test("sync replaces the catalog's lilo skills with the committed ones and leaves other owners alone", (t) => {
  const root = repository(t);
  const target = catalog(t);
  const result = run(sync, root, [target]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /wrote 3 files .* every cited path exists at v0\.1\.0/);
  for (const file of ["settings.toml", "build/alpha/SKILL.md", "build/beta/SKILL.md"]) {
    assert.equal(
      readFileSync(join(target, "skills/lilo", file), "utf8"),
      readFileSync(join(root, "skills/lilo", file), "utf8"),
    );
  }
  assert.ok(!existsSync(join(target, "skills/lilo/build/retired")), "a removed skill must go");
  assert.ok(existsSync(join(target, "skills/tm/runtime/other/SKILL.md")), "other owners stay");
});

await test("sync reads a commit, not the working tree, and refuses uncommitted skills", (t) => {
  const root = repository(t);
  const first = git(root, ["rev-parse", "HEAD"]);
  write(root, { "skills/lilo/build/beta/SKILL.md": skill("beta", "Edited after the commit.") });
  const dirty = run(sync, root, [catalog(t)]);
  assert.equal(dirty.status, 1, dirty.output);
  assert.match(dirty.output, /uncommitted changes/);

  const target = catalog(t);
  const pinned = run(sync, root, [target, "--ref", first]);
  assert.equal(pinned.status, 0, pinned.output);
  assert.doesNotMatch(
    readFileSync(join(target, "skills/lilo/build/beta/SKILL.md"), "utf8"),
    /Edited/,
  );
});

await test("sync refuses a path the newest release does not have, and writes nothing", (t) => {
  const root = repository(t);
  git(root, ["tag", "v0.9.0"]);
  write(root, {
    "docs/new.md": "# New\n",
    "skills/lilo/build/beta/SKILL.md": skill("beta", "Read `docs/new.md`."),
  });
  commitProject(root, "docs: add a page after the release");
  const target = catalog(t);
  const refused = run(sync, root, [target]);
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, /cites docs\/new.md, which is not in v0\.9\.0/);
  assert.ok(existsSync(join(target, "skills/lilo/build/retired/SKILL.md")), "nothing was written");

  // v0.10.0 is the newest release, though it sorts before v0.9.0 as text.
  git(root, ["tag", "v0.10.0"]);
  const released = run(sync, root, [target]);
  assert.equal(released.status, 0, released.output);
  assert.match(released.output, /exists at v0\.10\.0/);
  assert.equal(run(sync, root, [target, "--tag", "v0.1.0"]).status, 1);
});

await test("sync refuses a directory that is not a catalog, and a repository without a release", (t) => {
  const root = repository(t);
  const empty = mkdtempSync(join(tmpdir(), "skills-not-catalog-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const notCatalog = run(sync, root, [empty]);
  assert.equal(notCatalog.status, 2, notCatalog.output);
  assert.match(notCatalog.output, /has no skills\/ directory/);
  assert.equal(run(sync, root, []).status, 2);

  git(root, ["tag", "--delete", "v0.1.0"]);
  const untagged = run(sync, root, [catalog(t)]);
  assert.equal(untagged.status, 1, untagged.output);
  assert.match(untagged.output, /No v<version> release tag found/);
});
