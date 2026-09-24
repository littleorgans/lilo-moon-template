import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The reference repository as a commit of it would hold it: tracked files and untracked ones Git
 * does not ignore, the same list published-shape snapshots. Build output, installs and local
 * environment files are never template material.
 */
export class Reference {
  readonly #root: string;
  readonly #files: readonly string[];

  constructor(root: string) {
    this.#root = root;
    const listed = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8" },
    );
    this.#files = [...new Set(listed.split("\0"))]
      .filter((file) => file !== "" && existsSync(join(root, file)))
      .toSorted();
  }

  /** Every file under `directory`, as paths from the repository root. */
  files(directory: string): string[] {
    const prefix = `${directory}/`;
    const found = this.#files.filter((file) => file.startsWith(prefix));
    if (found.length === 0) throw new Error(`The reference has no files under ${directory}/`);
    return found;
  }

  /** The first segment of every path: the root's files and directories. */
  entries(): Set<string> {
    return new Set(this.#files.map((file) => file.split("/")[0] ?? file));
  }

  read(path: string): string {
    if (!this.#files.includes(path)) throw new Error(`The reference has no file ${path}`);
    return readFileSync(join(this.#root, path), "utf8");
  }

  manifest(path: string): Manifest {
    return parseManifest(JSON.parse(this.read(path)), path);
  }
}

/** A package.json, read as an object whose dependency sections are string maps. */
export type Manifest = Record<string, unknown>;

export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON file whose top level is an object. */
export function parseObject(text: string, path: string): Manifest {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error(`${path} is not a JSON object`);
  return value;
}

function parseManifest(value: unknown, path: string): Manifest {
  if (!isRecord(value)) throw new Error(`${path} is not a JSON object`);
  for (const section of DEPENDENCY_SECTIONS) dependencies(value, section, path);
  return value;
}

/** A manifest's dependency section, or an empty one. */
export function dependencies(
  manifest: Manifest,
  section: DependencySection,
  path: string,
): Record<string, string> {
  const found = manifest[section];
  if (found === undefined) return {};
  if (!isRecord(found)) throw new Error(`${path} ${section} is not an object`);
  const result: Record<string, string> = {};
  for (const [name, spec] of Object.entries(found)) {
    if (typeof spec !== "string") throw new Error(`${path} ${section}.${name} is not a string`);
    result[name] = spec;
  }
  return result;
}

export function stringField(manifest: Manifest, field: string, path: string): string {
  const value = manifest[field];
  if (typeof value !== "string") throw new Error(`${path} has no string ${field}`);
  return value;
}

export function recordField(manifest: Manifest, field: string, path: string): Manifest {
  const value = manifest[field];
  if (!isRecord(value)) throw new Error(`${path} has no object ${field}`);
  return value;
}

/**
 * `content` with `from` replaced by `to`, where `from` must occur exactly `count` times. When the
 * reference moves or rewords an anchor, the build fails here instead of shipping a template that
 * silently kept the reference's value.
 */
export function replace(
  content: string,
  edit: {
    readonly from: string;
    readonly to: string;
    readonly file: string;
    readonly count?: number;
  },
): string {
  const expected = edit.count ?? 1;
  const found = content.split(edit.from).length - 1;
  if (found !== expected) {
    throw new Error(
      `${edit.file}: expected ${expected} of ${JSON.stringify(edit.from)}, found ${found}. Update the create-app generator to match the reference.`,
    );
  }
  return content.replaceAll(edit.from, edit.to);
}
