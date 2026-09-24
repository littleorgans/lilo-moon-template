// The skills under skills/lilo and the rules that keep them true. The agent-runtimes catalog
// renders them for agents (skills/tm/runtime/skill-matters in that repository), so the shape it
// refuses at load is refused here first. And a skill teaches by pointing at this repository, so
// every repository path it cites must exist.
//
// A cited path is an inline code span naming a file, a directory (trailing slash) or a glob from the
// repository root: its first segment is a top-level directory, or it is one of ROOT_FILES. A span
// with a placeholder segment, such as `apps/<name>/`, names a path in the reader's project and is
// not checked. Fenced code blocks are commands and are not read.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export const OWNER = "lilo";
export const SKILLS_ROOT = `skills/${OWNER}`;

// Root files a skill may name without a directory. Files every project also has at its own root,
// such as package.json and moon.yml, are left out: a bare name there is ambiguous.
const ROOT_FILES = new Set([
  ".env.example",
  ".oxfmtrc.json",
  ".oxlintrc.json",
  ".prototools",
  "AGENTS.md",
  "commitlint.config.js",
  "justfile",
  "lefthook.yml",
  "pnpm-workspace.yaml",
  "renovate.json",
  "tsconfig.options.json",
  "vitest.config.ts",
]);

// Checked even when the tree no longer has them, so deleting a whole directory fails its citations
// instead of turning them into prose.
const ROOT_DIRECTORIES = [
  ".changeset",
  ".github",
  ".moon",
  "apps",
  "db",
  "docs",
  "packages",
  "renovate",
  "scripts",
  "services",
  "skills",
];

// The catalog's own limits (agent_runtime_compiler/skills.py).
const COMPONENT = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_GENERATED_NAME = 64;

function gitOutput(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** The files under skills/lilo in the working tree, as path → content. Symlinks map to null. */
export function workingSkills(root) {
  const files = new Map();
  const walk = (relative) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) files.set(path, null);
      else if (entry.isDirectory()) walk(path);
      else files.set(path, readFileSync(join(root, path), "utf8"));
    }
  };
  if (existsSync(join(root, SKILLS_ROOT))) walk(SKILLS_ROOT);
  return files;
}

/** The files under skills/lilo at a git ref, as path → content. Symlinks map to null. */
export function skillsAt(root, ref) {
  const files = new Map();
  const listing = gitOutput(root, ["ls-tree", "-r", "-z", ref, "--", SKILLS_ROOT]);
  for (const line of listing.split("\0").filter(Boolean)) {
    const [meta, path] = line.split("\t");
    const [mode, , object] = meta.split(" ");
    files.set(path, mode === "120000" ? null : gitOutput(root, ["cat-file", "blob", object]));
  }
  return files;
}

/** Every file a commit of the working tree would hold: tracked or unignored, and still on disk. */
export function workingTree(root) {
  const listed = gitOutput(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return new Set(
    listed
      .split("\0")
      .filter(Boolean)
      .filter((path) => lstatSync(join(root, path), { throwIfNoEntry: false }) !== undefined),
  );
}

/** Every file in the tree of a git ref. */
export function treeAt(root, ref) {
  return new Set(
    gitOutput(root, ["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter(Boolean),
  );
}

/** The newest `v<major>.<minor>.<patch>` tag: the release a reader installs today. */
export function latestReleaseTag(root) {
  const versions = gitOutput(root, ["tag", "--list", "v*"])
    .split("\n")
    .map((tag) => ({ tag, parts: /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)?.slice(1).map(Number) }))
    .filter(({ parts }) => parts !== undefined)
    .toSorted(
      (a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2],
    );
  return versions[0]?.tag ?? null;
}

function withoutFences(markdown) {
  let fenced = false;
  return markdown
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    })
    .join("\n");
}

function expandBraces(pattern) {
  const group = /\{([^{}]*)\}/.exec(pattern);
  if (group === null) return [pattern];
  return group[1]
    .split(",")
    .flatMap((choice) =>
      expandBraces(
        pattern.slice(0, group.index) + choice + pattern.slice(group.index + group[0].length),
      ),
    );
}

/** The repository paths a Markdown body cites, in order, without duplicates. */
export function citations(markdown, directories = ROOT_DIRECTORIES) {
  const roots = new Set([...ROOT_DIRECTORIES, ...directories]);
  const found = [...withoutFences(markdown).matchAll(/`([^`\n]+)`/g)]
    .map(([, span]) => span.replace(/#.*$/, ""))
    .filter((span) => span.length > 0 && !/[\s<>]/.test(span) && !span.includes("://"))
    .filter(
      (span) => ROOT_FILES.has(span) || (span.includes("/") && roots.has(span.split("/")[0])),
    );
  return [...new Set(found)];
}

const GLOB_TOKENS = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*" };

function globPattern(glob) {
  const source = glob
    .split(/(\*\*\/?|\*)/)
    .map((part) => GLOB_TOKENS[part] ?? part.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("");
  return new RegExp(`^${source}$`);
}

function directoriesOf(files) {
  const directories = new Set();
  for (const file of files) {
    for (let at = file.indexOf("/"); at !== -1; at = file.indexOf("/", at + 1)) {
      directories.add(file.slice(0, at));
    }
  }
  return directories;
}

function exists(citation, files, directories) {
  return expandBraces(citation).every((path) => {
    const directoryOnly = path.endsWith("/");
    const bare = directoryOnly ? path.slice(0, -1) : path;
    const candidates = directoryOnly ? [directories] : [files, directories];
    if (!bare.includes("*")) return candidates.some((set) => set.has(bare));
    const pattern = globPattern(bare);
    return candidates.some((set) => [...set].some((entry) => pattern.test(entry)));
  });
}

/** How many paths the skills cite, and each one the tree does not have, as `{ file, path }`. */
export function checkCitations(skills, tree) {
  const directories = directoriesOf(tree);
  const topLevel = [...directories].filter((directory) => !directory.includes("/"));
  const missing = [];
  let cited = 0;
  for (const [file, content] of skills) {
    if (content === null || !file.endsWith(".md")) continue;
    for (const path of citations(content, topLevel)) {
      cited += 1;
      if (!exists(path, tree, directories)) missing.push({ file, path });
    }
  }
  return { cited, missing };
}

/** The top-level `key: value` lines of a SKILL.md frontmatter, or null when there is none. */
function frontmatter(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing === -1) return null;
  return lines
    .slice(1, closing)
    .filter((line) => !/^\s/.test(line) && line.includes(":"))
    .map((line) => [
      line.slice(0, line.indexOf(":")),
      line
        .slice(line.indexOf(":") + 1)
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2"),
    ]);
}

/**
 * The bundles in skills/lilo/settings.toml, read in the one narrow shape this repository writes:
 * `schema_version = 1`, then `[bundles.<name>]` tables of a quoted one-line `description` and a
 * `members` array of quoted strings. Anything else is a problem, not a guess.
 */
export function parseBundles(text) {
  const bundles = new Map();
  const problems = [];
  let schema = null;
  let current = null;
  let members = null;
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const where = `line ${index + 1}`;
    if (line === "" || line.startsWith("#")) continue;
    if (members !== null) {
      const item = /^"([^"]+)",?$/.exec(line);
      if (item !== null) members.push(item[1]);
      else if (line === "]") members = null;
      else problems.push(`${where}: expected a quoted member or ]`);
      continue;
    }
    const table = /^\[bundles\.([a-z0-9-]+)\]$/.exec(line);
    const pair = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
    if (table !== null) {
      current = { description: null, members: [] };
      bundles.set(table[1], current);
    } else if (pair?.[1] === "schema_version" && current === null) {
      schema = pair[2];
    } else if (pair?.[1] === "description" && current !== null) {
      current.description = /^"([^"]+)"$/.exec(pair[2])?.[1] ?? null;
    } else if (pair?.[1] === "members" && current !== null && pair[2] === "[") {
      members = current.members;
    } else {
      problems.push(`${where}: unexpected ${JSON.stringify(line)}`);
    }
  }
  if (schema !== "1") problems.push("schema_version must be 1");
  if (members !== null) problems.push("members is not closed");
  for (const [name, bundle] of bundles) {
    if (bundle.description === null) problems.push(`bundle ${name} needs a one-line description`);
    if (bundle.members.length === 0) problems.push(`bundle ${name} has no members`);
  }
  return { bundles, problems };
}

/**
 * What the catalog would refuse, or would render wrongly: layout, frontmatter, symlinks, bundle
 * members, and links between skills. Cited paths are separate: see checkCitations.
 */
export function shapeProblems(skills) {
  const problems = [];
  const skillDirectories = new Set();
  for (const [file, content] of skills) {
    const parts = file.split("/");
    if (content === null) {
      problems.push(`${file}: skills must not contain symlinks; the catalog refuses them`);
      continue;
    }
    if (parts.at(-1) !== "SKILL.md") continue;
    if (parts.length !== 5) {
      problems.push(`${file}: a skill is ${SKILLS_ROOT}/<domain>/<skill>/SKILL.md`);
      continue;
    }
    const [, , domain, name] = parts;
    skillDirectories.add(`${domain}/${name}`);
    for (const component of [domain, name]) {
      if (!COMPONENT.test(component)) problems.push(`${file}: ${component} is not a valid ID part`);
    }
    if (`${OWNER}-${domain}-${name}`.length > MAX_GENERATED_NAME) {
      problems.push(`${file}: ${OWNER}-${domain}-${name} exceeds ${MAX_GENERATED_NAME} characters`);
    }
    const fields = frontmatter(content);
    if (fields === null) {
      problems.push(`${file}: missing YAML frontmatter`);
      continue;
    }
    const names = fields.filter(([key]) => key === "name");
    if (names.length !== 1 || names[0][1] !== name) {
      problems.push(`${file}: frontmatter needs exactly one name, and it must be ${name}`);
    }
    const descriptions = fields.filter(([key]) => key === "description");
    if (descriptions.length !== 1 || descriptions[0][1].length === 0) {
      problems.push(`${file}: frontmatter needs exactly one one-line description`);
    }
  }
  for (const file of skills.keys()) {
    const parts = file.split("/");
    if (file === `${SKILLS_ROOT}/settings.toml`) continue;
    if (parts.length < 5 || !skillDirectories.has(`${parts[2]}/${parts[3]}`)) {
      problems.push(`${file}: outside any skill; the catalog would never render it`);
    }
  }
  const settings = skills.get(`${SKILLS_ROOT}/settings.toml`);
  if (settings !== undefined && settings !== null) {
    const { bundles, problems: parsing } = parseBundles(settings);
    problems.push(...parsing.map((problem) => `${SKILLS_ROOT}/settings.toml: ${problem}`));
    for (const [name, bundle] of bundles) {
      for (const member of bundle.members) {
        if (!skillDirectories.has(member)) {
          problems.push(
            `${SKILLS_ROOT}/settings.toml: bundle ${name} names unknown skill ${member}`,
          );
        }
      }
    }
  }
  for (const [file, content] of skills) {
    if (content === null || !file.endsWith(".md")) continue;
    for (const [, target] of withoutFences(content).matchAll(
      /\]\(<?([^\s()<>]+)>?(?:\s+"[^"]*")?\)/g,
    )) {
      const path = target.split("#")[0];
      if (path === "" || path.includes(":")) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(file), path));
      if (!resolved.startsWith(`${SKILLS_ROOT}/`)) {
        problems.push(
          `${file}: link ${target} leaves ${SKILLS_ROOT}, which the catalog cannot follow; cite the path in code instead`,
        );
      } else if (!skills.has(resolved)) {
        problems.push(`${file}: link ${target} names nothing in ${SKILLS_ROOT}`);
      }
    }
  }
  return problems;
}
