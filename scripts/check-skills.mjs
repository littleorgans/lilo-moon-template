// root:skills-check. Fails when a skill under skills/lilo breaks a rule the agent-runtimes catalog
// enforces, links to something outside the skills, or cites a repository path that does not exist.
//
//   node scripts/check-skills.mjs             cited paths must exist in the working tree
//   node scripts/check-skills.mjs --at <ref>  cited paths must exist at <ref>, such as a release tag
//
// CI checks the working tree, so a change that moves a file updates the skills that cite it in the
// same pull request. --at answers the question a reader asks: does what this skill cites exist in
// the release I installed? scripts/sync-skills.mjs asks it of the latest release before it syncs.

import {
  checkCitations,
  shapeProblems,
  treeAt,
  workingSkills,
  workingTree,
} from "./lib/skills.mjs";

const args = process.argv.slice(2);
const at = args[0] === "--at" ? args[1] : undefined;
if (args.length > 0 && (at === undefined || args.length !== 2)) {
  console.error("Usage: node scripts/check-skills.mjs [--at <ref>]");
  process.exit(2);
}

const root = process.cwd();
const skills = workingSkills(root);
const tree = at === undefined ? workingTree(root) : treeAt(root, at);
const where = at === undefined ? "in the working tree" : `at ${at}`;
const problems = shapeProblems(skills);
const { cited, missing } = checkCitations(skills, tree);
problems.push(...missing.map(({ file, path }) => `${file}: cites ${path}, which is not ${where}`));

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const count = [...skills.keys()].filter((file) => file.endsWith("/SKILL.md")).length;
console.error(`skills-check: ${count} skills; the ${cited} paths they cite exist ${where}.`);
