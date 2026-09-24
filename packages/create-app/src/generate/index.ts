// Generates the template from the reference app at build time. The template is never written by
// hand and never committed: `moon run create-app:build` derives it from apps/web, services/api,
// db/ and the workspace root of the same commit, so what a project receives is what this
// repository's gates just proved. Run as `node src/generate/index.ts <repository root> <output>`.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Parts, Template, TemplateFile } from "../template.ts";
import { matches, parseManifest, serializeManifest } from "../template.ts";
import type { Context } from "./projects.ts";
import { defaults, schemaFiles, serviceFiles, webFiles, webPort } from "./projects.ts";
import { recordField, Reference, stringField } from "./reference.ts";
import { formatSettings, rootFiles } from "./root.ts";

/** The files create-app owns rather than takes from the reference. */
const OWNED = fileURLToPath(new URL("../../templates/", import.meta.url));

/** The combinations a project can choose. A service always has a database. */
export const CHOICES: readonly Parts[] = [
  { web: true, service: false, database: false },
  { web: true, service: false, database: true },
  { web: true, service: true, database: true },
  { web: false, service: true, database: true },
];

/** `owner/name` from a GitHub repository URL in a manifest. */
export function repositoryOf(url: string): string {
  const found = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1];
  if (found === undefined) throw new Error(`create-app's repository.url is not on GitHub: ${url}`);
  return found;
}

/** The published packages and the one version they share, which the template installs. */
function releases(reference: Reference): { version: string; published: Set<string> } {
  const own = reference.manifest("packages/create-app/package.json");
  const version = stringField(own, "version", "packages/create-app/package.json");
  const published = new Set<string>();
  for (const path of reference
    .files("packages")
    .filter((file) => /^packages\/[^/]+\/package\.json$/.test(file))) {
    const manifest = reference.manifest(path);
    if (manifest["private"] === true) continue;
    const name = stringField(manifest, "name", path);
    const found = stringField(manifest, "version", path);
    if (found !== version) {
      throw new Error(`${name} is at ${found} and create-app at ${version}; they release together`);
    }
    published.add(name);
  }
  return { version, published };
}

/**
 * Formats every file as the project's own format gate will: the reference's formatter with the
 * project's settings. Rewritten JSON and YAML then pass `root:format-check` in the new project.
 */
function format(root: string, files: readonly TemplateFile[], settings: string): TemplateFile[] {
  const scratch = mkdtempSync(join(tmpdir(), "create-app-template-"));
  try {
    writeFileSync(join(scratch, ".oxfmtrc.json"), settings);
    const located = files.map((file, index) => ({
      file,
      location: join(scratch, String(index), file.path),
    }));
    for (const { file, location } of located) {
      mkdirSync(dirname(location), { recursive: true });
      writeFileSync(location, file.content);
    }
    execFileSync(join(root, "node_modules/.bin/oxfmt"), ["--no-error-on-unmatched-pattern"], {
      cwd: scratch,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return located.map(({ file, location }) => ({
      path: file.path,
      when: file.when,
      content: readFileSync(location, "utf8"),
    }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Fails when a choice would write one path twice, or when a manifest is not printed as the
 * command line prints it: it sorts dependencies again once names replace tokens, then writes
 * JSON.stringify's output, which must be exactly what the formatter printed.
 */
export function checkTemplate(files: readonly TemplateFile[]) {
  for (const parts of CHOICES) {
    const paths = files.filter(({ when }) => matches(when, parts)).map(({ path }) => path);
    const twice = paths.filter((path, index) => paths.indexOf(path) !== index);
    if (twice.length > 0)
      throw new Error(`${JSON.stringify(parts)} writes ${twice.join(", ")} twice`);
  }
  for (const { path, content } of files) {
    if (path.endsWith("package.json") && content !== serializeManifest(parseManifest(content))) {
      throw new Error(`${path} is not formatted as JSON.stringify prints it`);
    }
  }
}

export function generateTemplate(root: string): Template {
  const reference = new Reference(root);
  const { version, published } = releases(reference);
  const own = "packages/create-app/package.json";
  const repository = repositoryOf(
    stringField(recordField(reference.manifest(own), "repository", own), "url", own),
  );
  const context: Context = {
    reference,
    published,
    schema: stringField(
      reference.manifest("db/drizzle/package.json"),
      "name",
      "db/drizzle/package.json",
    ),
  };
  const projects = [webFiles(context), serviceFiles(context), schemaFiles(context)];
  const manifests = projects.flatMap((project) => project.manifests);
  const rootParts = rootFiles({
    context,
    version,
    repository,
    webPort: webPort(reference),
    manifests,
    owned: {
      agents: readFileSync(join(OWNED, "AGENTS.md"), "utf8"),
      seed: readFileSync(join(OWNED, "rls-seed.sql"), "utf8"),
    },
  });
  const files = [rootParts, ...projects].flatMap((part) =>
    part.files.concat(
      part.manifests.map(({ path, when, manifest }) => ({
        path,
        when,
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      })),
    ),
  );
  const formatted = format(root, files, formatSettings(reference));
  checkTemplate(formatted);
  return { version, repository, defaults: defaults(reference), files: formatted };
}

export function writeTemplate(root: string, output: string) {
  const template = generateTemplate(resolve(root));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(template));
  const count = new Set(template.files.map(({ path }) => path)).size;
  process.stdout.write(
    `create-app: template ${template.version} with ${count} paths in ${output}\n`,
  );
}

export function main(argv: readonly string[]) {
  const [root, output, ...rest] = argv;
  if (root === undefined || output === undefined || rest.length > 0) {
    throw new Error("Usage: node src/generate/index.ts <repository root> <output>");
  }
  writeTemplate(root, output);
}

if (import.meta.main) main(process.argv.slice(2));
