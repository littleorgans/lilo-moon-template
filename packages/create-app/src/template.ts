/**
 * The template the build generates from the reference app and the command line writes out. Every
 * file is final except for the tokens below, which stand for the choices a project makes. A file
 * is written when its condition matches those choices.
 */

/** What a project chose to have. A service always has a database. */
export interface Parts {
  readonly web: boolean;
  readonly service: boolean;
  readonly database: boolean;
}

/** Each key present must equal the project's choice; an empty condition always matches. */
export type Condition = Partial<Parts>;

export interface TemplateFile {
  /** The path in the new project, which may contain tokens. */
  readonly path: string;
  readonly when: Condition;
  readonly content: string;
}

export interface Template {
  /** The release every `@littleorgans/*` catalog entry and the CI workflow tag name. */
  readonly version: string;
  /** `owner/name` of the repository that holds the reference app, the guides and the workflow. */
  readonly repository: string;
  /** The reference's own names and ports, which a project keeps unless it chooses others. */
  readonly defaults: Defaults;
  readonly files: readonly TemplateFile[];
}

export interface Defaults {
  readonly web: string;
  readonly webPort: number;
  readonly service: string;
  readonly servicePort: number;
}

/**
 * Placeholders for a project's choices. Each is a valid identifier, so a token inside TypeScript,
 * JSON or YAML keeps the file parseable for the formatter the build runs.
 */
export const TOKENS = {
  project: "__LILO_PROJECT__",
  web: "__LILO_WEB__",
  webPort: "__LILO_WEB_PORT__",
  organizationPolicy: "__LILO_ORGANIZATION_POLICY__",
  service: "__LILO_SERVICE__",
  servicePort: "__LILO_SERVICE_PORT__",
} as const;

const TOKEN_PATTERN = /__LILO_[A-Z_]+__/;

const PARTS = ["web", "service", "database"] as const satisfies readonly (keyof Parts)[];

export function matches(when: Condition, parts: Parts): boolean {
  return PARTS.every((part) => when[part] === undefined || when[part] === parts[part]);
}

/**
 * `text` with each placeholder replaced by its value. A token left over, one without a value or
 * one this version does not know, is a template the build should have refused, so it throws
 * rather than writing it.
 */
export function substitute(text: string, values: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [placeholder, value] of values) result = result.replaceAll(placeholder, value);
  const left = TOKEN_PATTERN.exec(result);
  if (left !== null) throw new Error(`The template left ${left[0]} without a value`);
  return result;
}

/** A package.json as the command line rewrites it: dependency sections, in any order. */
export type ManifestText = Record<string, unknown>;

export function parseManifest(text: string): ManifestText {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A template package.json is not a JSON object");
  }
  return { ...value };
}

const DEPENDENCIES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * `manifest` printed as the formatter prints a package.json: two-space JSON, with each dependency
 * section in code point order. A project's own scope replaces a token in some keys, which moves
 * them in that order.
 */
export function serializeManifest(manifest: ManifestText): string {
  const sorted: ManifestText = { ...manifest };
  for (const section of DEPENDENCIES) {
    const entries = sorted[section];
    if (typeof entries !== "object" || entries === null) continue;
    sorted[section] = Object.fromEntries(
      Object.entries(entries).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
