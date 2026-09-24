// root:skills-sync. Copies the committed skills/lilo into a checkout of the agent-runtimes catalog,
// replacing <catalog>/skills/lilo, so the catalog's generator renders what this repository reviewed.
//
//   moon run root:skills-sync -- <catalog> [--ref <ref>] [--tag <tag>]
//
// The skills come from a commit (--ref, HEAD by default), never from unsaved edits. Every path they
// cite must exist at the release a reader installs (--tag, the newest v<version> tag by default),
// because the skills tell readers to read the reference at that tag. It writes nothing when any
// check fails, and it never commits: the catalog change is reviewed as the catalog's own pull request.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  SKILLS_ROOT,
  checkCitations,
  latestReleaseTag,
  shapeProblems,
  skillsAt,
  treeAt,
} from "./lib/skills.mjs";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const args = process.argv.slice(2);
const options = { ref: "HEAD", tag: undefined };
let catalog;
while (args.length > 0) {
  const arg = args.shift();
  if ((arg === "--ref" || arg === "--tag") && args.length > 0) options[arg.slice(2)] = args.shift();
  else if (!arg.startsWith("-") && catalog === undefined) catalog = resolve(arg);
  else catalog = null;
}
if (catalog === undefined || catalog === null) {
  fail("Usage: moon run root:skills-sync -- <catalog> [--ref <ref>] [--tag <tag>]", 2);
}
if (!existsSync(join(catalog, "skills"))) {
  fail(`${catalog} has no skills/ directory; pass a checkout of the agent-runtimes catalog.`, 2);
}

const root = process.cwd();
const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trim();
if (options.ref === "HEAD" && git("status", "--porcelain", "--", SKILLS_ROOT) !== "") {
  fail(`${SKILLS_ROOT} has uncommitted changes. Commit them, or pass --ref, before syncing.`);
}
const tag = options.tag ?? latestReleaseTag(root);
if (tag === null) fail("No v<version> release tag found. Fetch tags, or pass --tag.");

const commit = git("rev-parse", "--verify", `${options.ref}^{commit}`);
const skills = skillsAt(root, commit);
if (skills.size === 0) fail(`${options.ref} has no ${SKILLS_ROOT}.`);
const problems = shapeProblems(skills);
const { missing } = checkCitations(skills, treeAt(root, tag));
problems.push(
  ...missing.map(
    ({ file, path }) =>
      `${file}: cites ${path}, which is not in ${tag}. Sync after the release that adds it.`,
  ),
);
if (problems.length > 0) fail(problems.join("\n"));

const destination = join(catalog, SKILLS_ROOT);
rmSync(destination, { recursive: true, force: true });
for (const [file, content] of skills) {
  const target = join(catalog, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
console.error(
  `skills-sync: wrote ${skills.size} files from ${SKILLS_ROOT} at ${commit.slice(0, 12)} into ${destination}; ` +
    `every cited path exists at ${tag}. Review the change in the catalog and open its pull request.`,
);
