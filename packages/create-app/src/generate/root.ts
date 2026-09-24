// The workspace root and the database, from this repository's own root. Every root entry, root
// task and .env.example paragraph is classified below. One the lists do not name stops the build,
// so a file or task added to the reference is a decision about projects, not something the
// template silently keeps or drops.

import { isMap, isScalar, Scalar } from "yaml";

import type { Condition, TemplateFile } from "../template.ts";
import { TOKENS } from "../template.ts";
import type { Context, ManifestFile } from "./projects.ts";
import { releasedManifest, SCHEMA, SERVICE, WEB } from "./projects.ts";
import type { Manifest, Reference } from "./reference.ts";
import {
  DEPENDENCY_SECTIONS,
  dependencies,
  parseObject,
  recordField,
  replace,
} from "./reference.ts";
import {
  editSequence,
  expectAt,
  keysAt,
  parseYaml,
  printYaml,
  removeAt,
  replaceAt,
} from "./yaml.ts";

/**
 * What happens to each entry at the reference root. `copy` files are written as they are,
 * `generate` entries are rewritten below, and `reference` entries belong to this repository:
 * its publishing, documentation and tests.
 */
const ROOT: Record<string, "copy" | "generate" | "reference"> = {
  ".changeset": "reference",
  ".editorconfig": "copy",
  ".env.example": "generate",
  ".github": "generate",
  ".gitignore": "generate",
  ".moon": "generate",
  ".npmrc": "copy",
  ".oxfmtrc.json": "generate",
  ".oxlintrc.json": "copy",
  ".prototools": "copy",
  ".secretlintignore": "copy",
  ".secretlintrc.json": "copy",
  ".vscode": "copy",
  // A project gets its own, from templates/AGENTS.md.
  "AGENTS.md": "reference",
  LICENSE: "reference",
  "README.md": "reference",
  "SECURITY.md": "reference",
  apps: "generate",
  "commitlint.config.js": "copy",
  db: "generate",
  docs: "reference",
  justfile: "copy",
  "lefthook.yml": "copy",
  "moon.yml": "generate",
  "package.json": "generate",
  // Only the migrations @littleorgans/db ships, as the project's first ones.
  packages: "generate",
  "pnpm-lock.yaml": "reference",
  "pnpm-workspace.yaml": "generate",
  // The Renovate preset a project extends from this repository rather than copies.
  renovate: "reference",
  "renovate.json": "generate",
  scripts: "generate",
  services: "generate",
  skills: "reference",
  "tsconfig.json": "generate",
  "tsconfig.options.json": "copy",
  "vitest.config.ts": "copy",
};

const GITHUB: Record<string, "generate" | "reference"> = {
  ".github/workflows/ci.yml": "generate",
  // Called from this repository at the release tag, never copied.
  ".github/workflows/moon-ci.yml": "reference",
  ".github/workflows/release.yml": "reference",
};

/** Root tasks a project keeps, the database tasks, and this repository's own. */
const TASKS = {
  project: [
    "audit",
    "clean",
    "format",
    "format-check",
    "lint",
    "lint-fix",
    "project-refs",
    "secrets",
    "tsgolint-lockstep",
  ],
  database: [
    "atlas-apply",
    "atlas-diff",
    "atlas-lint",
    "drizzle-check",
    "drizzle-generate",
    "rls-verify",
  ],
  reference: [
    "packed-secrets",
    "prune-references",
    "published-shape",
    "release-rehearsal",
    "scripts-test",
    "skills-check",
    "skills-sync",
  ],
} as const;

/** The reference's migrations, which a project's own migrations join. */
const MIGRATIONS = "packages/db/migrations";

/** Tools this repository uses to publish and test its packages. */
const REFERENCE_TOOLS = [
  "@arethetypeswrong/cli",
  "@changesets/changelog-github",
  "@changesets/cli",
  "drizzle-orm",
  "publint",
  "yaml",
];

/** Root tools the database tasks run: db-tools, its pg peer, and the drizzle-kit it drives. */
const DATABASE_TOOLS = ["@littleorgans/db-tools", "pg"];

const DATABASE_VARIANTS: readonly boolean[] = [true, false];

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Fails unless every root entry of the reference is classified. */
export function checkRootEntries(reference: Reference) {
  const unknown = [...reference.entries()].filter((entry) => !Object.hasOwn(ROOT, entry));
  if (unknown.length > 0) {
    throw new Error(
      `create-app does not know what a project does with ${unknown.join(", ")} at the reference root. Classify it in src/generate/root.ts.`,
    );
  }
  const workflows = reference.files(".github").filter((file) => !Object.hasOwn(GITHUB, file));
  if (workflows.length > 0) {
    throw new Error(`Classify ${workflows.join(", ")} in src/generate/root.ts.`);
  }
}

function copied(reference: Reference): TemplateFile[] {
  return Object.entries(ROOT)
    .filter(([, kind]) => kind === "copy")
    .flatMap(([entry]) => (entry === ".vscode" ? reference.files(entry) : [entry]))
    .map((path) => ({ path, when: {}, content: reference.read(path) }));
}

function moonFiles(reference: Reference): TemplateFile[] {
  const unknown = reference
    .files(".moon")
    .filter((file) => file !== ".moon/workspace.yml" && file !== ".moon/toolchains.yml")
    .filter((file) => !/^\.moon\/tasks\/[\w-]+\.yml$/.test(file));
  if (unknown.length > 0)
    throw new Error(`Classify ${unknown.join(", ")} in src/generate/root.ts.`);
  return reference.files(".moon").map((path) => {
    const content = reference.read(path);
    if (path !== ".moon/toolchains.yml") return { path, when: {}, content };
    // It names a test that exists only in this repository.
    return {
      path,
      when: {},
      content: replace(content, {
        from: "declares dependsOn\n  # (scripts/tests/integration/project-graph.test.mjs), so there is nothing to write back into the\n  # manifests.",
        to: "declares dependsOn, so there is\n  # nothing to write back into the manifests.",
        file: path,
      }),
    };
  });
}

function rootMoon(reference: Reference, database: boolean): string {
  const file = "moon.yml";
  const document = parseYaml(reference.read(file), file);
  const tasks = keysAt(document, ["tasks"], file).toSorted();
  const known: string[] = [...TASKS.project, ...TASKS.database, ...TASKS.reference].toSorted();
  if (JSON.stringify(tasks) !== JSON.stringify(known)) {
    throw new Error(
      `${file}: classify the root tasks in src/generate/root.ts (new: ${tasks.filter((task) => !known.includes(task)).join(", ") || "none"}; gone: ${known.filter((task) => !tasks.includes(task)).join(", ") || "none"}).`,
    );
  }
  for (const task of [...TASKS.reference, ...(database ? [] : TASKS.database)]) {
    document.deleteIn(["tasks", task]);
  }

  // A project's db/ holds its migrations, its desired state and its typed schema.
  editSequence(document, {
    path: ["fileGroups", "sources"],
    items: new Map([
      [`${MIGRATIONS}/**/*`, "db/**/*"],
      ["db/schema.sql", null],
      ["db/drizzle/**/*", null],
    ]),
    file,
  });
  editSequence(document, {
    path: ["tasks", "format-check", "inputs"],
    items: new Map([[".changeset/**/*", null]]),
    file,
  });

  // db-tools is installed, not built here, so no task waits on a workspace build.
  replaceAt(document, {
    path: ["tasks", "clean", "script"],
    expected: "db-tools clean && moon clean",
    value: database ? "db-tools clean && moon clean" : "moon clean",
    file,
  });
  removeAt(document, { path: ["tasks", "clean", "deps"], expected: ["^:build"], file });
  if (database) {
    for (const task of TASKS.database) {
      removeAt(document, { path: ["tasks", task, "deps"], expected: ["^:build"], file });
    }
    for (const task of [
      "atlas-diff",
      "atlas-lint",
      "atlas-apply",
      "drizzle-generate",
      "drizzle-check",
    ]) {
      replaceAt(document, {
        path: ["tasks", task, "command"],
        expected: `db-tools ${task} --migrations ${MIGRATIONS}`,
        value: `db-tools ${task}`,
        file,
      });
    }
    // This repository's rls-verify also asserts which tenant sees which row. A project runs the
    // generic checks over its own migrations and seed.
    replaceAt(document, {
      path: ["tasks", "rls-verify", "command"],
      expected: "node scripts/rls-verify.mjs",
      value: "db-tools rls-verify --seed db/rls-seed.sql",
      file,
    });
    for (const task of ["drizzle-check", "rls-verify"]) {
      editSequence(document, {
        path: ["tasks", task, "inputs"],
        items: new Map([
          [`${MIGRATIONS}/**/*`, "db/migrations/**/*"],
          ["packages/db-tools/src/**/*", null],
          ...(task === "rls-verify"
            ? ([["scripts/rls-verify.mjs", "db/rls-seed.sql"]] as const)
            : []),
        ]),
        file,
      });
    }
  }
  const printed = printYaml(document);
  for (const path of ["packages/db", "scripts/rls-verify"]) {
    if (printed.includes(path))
      throw new Error(`${file}: the project's root tasks still name ${path}`);
  }
  return printed;
}

function rootManifest(reference: Reference, context: Context, database: boolean): Manifest {
  const file = "package.json";
  const manifest = releasedManifest(reference.manifest(file), file, context);
  manifest["name"] = TOKENS.project;
  delete manifest["license"];
  const scripts = { ...recordField(manifest, "scripts", file) };
  for (const script of ["changeset", "changeset:version"]) {
    if (!(script in scripts)) throw new Error(`${file} has no ${script} script`);
    delete scripts[script];
  }
  manifest["scripts"] = scripts;
  const tools = dependencies(manifest, "devDependencies", file);
  for (const tool of [...REFERENCE_TOOLS, ...(database ? [] : DATABASE_TOOLS)]) {
    if (!(tool in tools)) throw new Error(`${file} no longer lists ${tool}`);
    delete tools[tool];
  }
  if (database) {
    if ("drizzle-kit" in tools) throw new Error(`${file} lists drizzle-kit already`);
    tools["drizzle-kit"] = "catalog:";
  }
  manifest["devDependencies"] = Object.fromEntries(
    Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  return manifest;
}

/**
 * The reference's workspace policy, with a catalog of exactly what the generated manifests
 * install: the published packages at the release, and the reference's own pins for the rest. The
 * named catalogs hold this repository's peer ranges and go.
 */
function workspace(
  reference: Reference,
  manifests: readonly ManifestFile[],
  version: string,
  published: ReadonlySet<string>,
): string {
  const file = "pnpm-workspace.yaml";
  const document = parseYaml(reference.read(file), file);
  const wanted = new Set<string>();
  for (const { path, manifest } of manifests) {
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [name, spec] of Object.entries(dependencies(manifest, section, path))) {
        if (spec === "catalog:") wanted.add(name);
        else if (spec.startsWith("catalog:")) {
          throw new Error(`${path} installs ${name} from the named catalog ${spec}`);
        }
      }
    }
  }
  const catalog: unknown = document.getIn(["catalog"], true);
  if (!isMap(catalog)) throw new Error(`${file} has no catalog`);
  const pinned = new Set<string>();
  catalog.items = catalog.items.filter((pair) => {
    const name = isScalar(pair.key) ? String(pair.key.value) : "";
    pinned.add(name);
    return wanted.has(name);
  });
  for (const name of [...wanted].toSorted()) {
    if (published.has(name)) {
      const range = new Scalar(`^${version}`);
      range.type = Scalar.QUOTE_DOUBLE;
      catalog.add(document.createPair(name, range));
    } else if (!pinned.has(name)) throw new Error(`${file} has no catalog entry for ${name}`);
  }
  catalog.items.sort((a, b) =>
    String(isScalar(a.key) ? a.key.value : "").localeCompare(
      String(isScalar(b.key) ? b.key.value : ""),
    ),
  );
  expectAt(document, ["catalogs", "react-peer", "react"], "^19.0.0", file);
  document.deleteIn(["catalogs"]);
  return printYaml(document);
}

function rootTsconfig(reference: Reference, parts: Condition): string {
  const file = "tsconfig.json";
  const config = parseObject(reference.read(file), file);
  const targets = new Map([
    [`./${WEB}`, parts.web === true ? `./apps/${TOKENS.web}` : null],
    [`./${SCHEMA}`, `./${SCHEMA}`],
    [`./${SERVICE}`, parts.service === true ? `./services/${TOKENS.service}` : null],
  ]);
  const references = config["references"];
  if (!Array.isArray(references)) throw new Error(`${file} has no references`);
  const paths = new Set(
    references.map((entry: unknown) =>
      typeof entry === "object" && entry !== null && "path" in entry ? entry.path : undefined,
    ),
  );
  config["references"] = [...targets].flatMap(([from, to]) => {
    if (!paths.has(from)) throw new Error(`${file} no longer references ${from}`);
    return to === null ? [] : [{ path: to }];
  });
  return json(config);
}

/**
 * .env.example by paragraph. Every paragraph is classified by a line it holds, and one no rule
 * names stops the build.
 */
const ENV_PARAGRAPHS: readonly { readonly marker: string; readonly when: Condition }[] = [
  { marker: "# Copy to .env.local.", when: {} },
  { marker: "# Identity: WorkOS", when: {} },
  { marker: "WORKOS_CLIENT_ID=", when: {} },
  { marker: "WORKOS_API_KEY=", when: { web: true } },
  { marker: "WORKOS_REDIRECT_URI=", when: { web: true } },
  { marker: "WORKOS_COOKIE_PASSWORD=", when: { web: true } },
  { marker: "WORKOS_COOKIE_PASSWORD_PREVIOUS=", when: { web: true } },
  { marker: "# Derived, not configured.", when: {} },
  { marker: "# Persistence: Postgres", when: { database: true } },
  { marker: "DATABASE_URL=", when: { database: true } },
  { marker: "# Not set here", when: {} },
];

const ENV_VARIANTS: readonly Required<Pick<Condition, "web" | "database">>[] = [
  { web: true, database: true },
  { web: true, database: false },
  // A service always has a database.
  { web: false, database: true },
];

function environment(reference: Reference, webPort: number): TemplateFile[] {
  const file = ".env.example";
  let content = reference.read(file);
  for (const [from, to] of [
    ["WORKOS_COOKIE_PASSWORD=generate_at_least_32_random_characters", "WORKOS_COOKIE_PASSWORD="],
    [`http://localhost:${webPort}/callback`, `http://localhost:${TOKENS.webPort}/callback`],
    ["# Nothing in packages/ reads this file.", "# No @littleorgans package reads this file."],
    // This repository's release settings.
    [
      "#   NPM_PUBLISH_ENABLED   variable. Unset means Changesets versions but never publishes.\n#   LILO_GITHUB_PAT       secret. Authors the Version Packages PR so it is not approval-blocked.\n",
      "",
    ],
    [", and are documented in\n# docs/maintaining.md:", ":"],
  ] as const) {
    content = replace(content, { from, to, file });
  }
  const paragraphs = content
    .trimEnd()
    .split("\n\n")
    .map((text) => {
      const rules = ENV_PARAGRAPHS.filter(({ marker }) => text.includes(marker));
      const rule = rules[0];
      const assignments = [...text.matchAll(/^([A-Z][A-Z0-9_]*=)/gm)].map(
        ([assignment]) => assignment,
      );
      if (
        rule === undefined ||
        rules.length !== 1 ||
        assignments.some((assignment) => assignment !== rule.marker)
      ) {
        throw new Error(`${file}: classify this paragraph in src/generate/root.ts:\n${text}`);
      }
      return { text, when: rule.when };
    });
  return ENV_VARIANTS.map((parts) => ({
    path: file,
    when: parts,
    content: `${paragraphs
      .filter(
        ({ when }) =>
          (when.web ?? parts.web) === parts.web &&
          (when.database ?? parts.database) === parts.database,
      )
      .map(({ text }) => text)
      .join("\n\n")}\n`,
  }));
}

/**
 * The reference's format settings, with the project's own scope as internal imports. The build
 * formats the template with the scope still a token, and a sort that compared it with
 * `@littleorgans/*` would place the import by a name no one has chosen yet. As its own group, its
 * place does not depend on the name.
 */
export function formatSettings(reference: Reference): string {
  const file = ".oxfmtrc.json";
  const config = parseObject(reference.read(file), file);
  if (config["sortImports"] !== true) throw new Error(`${file}: expected sortImports: true`);
  config["sortImports"] = { internalPattern: ["~/", "@/", "#", `@${TOKENS.project}/`] };
  return json(config);
}

/** The reference's Renovate settings, extending the preset from this repository. */
function renovate(reference: Reference, repository: string): string {
  const file = "renovate.json";
  const config = parseObject(reference.read(file), file);
  const local = `local>${repository}//renovate/base`;
  if (JSON.stringify(config["extends"]) !== JSON.stringify([local])) {
    throw new Error(`${file} no longer extends ${local} alone`);
  }
  config["extends"] = [`github>${repository}//renovate/base`];
  // Its one manager updates the npm pin in this repository's release workflow.
  const managers = config["customManagers"];
  if (!Array.isArray(managers) || !JSON.stringify(managers).includes("workflows/release")) {
    throw new Error(`${file}: classify its customManagers in src/generate/root.ts`);
  }
  delete config["customManagers"];
  return json(config);
}

/** The CI caller, calling the reusable workflow in this repository at the release tag. */
function ci(reference: Reference, repository: string, version: string): string {
  const file = ".github/workflows/ci.yml";
  return replace(reference.read(file), {
    from: "uses: ./.github/workflows/moon-ci.yml",
    to: `uses: ${repository}/.github/workflows/moon-ci.yml@v${version}`,
    file,
  });
}

function gitignore(reference: Reference): string {
  const file = ".gitignore";
  return replace(reference.read(file), {
    from: "# Not output: `build` is a skill domain, as in skills/lilo/build/start-project.\n!/skills/*/build/\n",
    to: "",
    file,
  });
}

/**
 * The scripts the project's root tasks and manifest run, and nothing else under scripts/. Each is
 * copied alone, so it may import only packages, not its neighbours.
 */
function scriptFiles(reference: Reference, generated: readonly TemplateFile[]): TemplateFile[] {
  const named = new Set(
    generated.flatMap(({ content }) =>
      [...content.matchAll(/scripts\/[\w-]+\.mjs/g)].map(([path]) => path),
    ),
  );
  return [...named].toSorted().map((path) => {
    const content = reference.read(path);
    if (/from "\.\.?\//.test(content))
      throw new Error(`${path} imports a neighbour a project would not have`);
    return { path, when: {}, content };
  });
}

/**
 * The database a project starts with: the migrations @littleorgans/db ships, which its own join,
 * the desired state they were generated from, and the seed rls-verify hides.
 */
function databaseFiles(reference: Reference, seed: string): TemplateFile[] {
  const file = "db/schema.sql";
  const when = { database: true };
  const schema = replace(
    replace(reference.read(file), {
      from: "-- That directory ships in @littleorgans/db, so every table added here reaches every consumer of\n-- the package. Product tables belong in a consuming project's own schema, not here.\n--\n",
      to: "",
      file,
    }),
    { from: `${MIGRATIONS}/`, to: "db/migrations/", file, count: 2 },
  );
  return [
    { path: file, when, content: schema },
    { path: "db/rls-seed.sql", when, content: seed },
    ...reference.files(MIGRATIONS).map((path) => ({
      path: `db/migrations/${path.slice(MIGRATIONS.length + 1)}`,
      when,
      content: reference.read(path),
    })),
  ];
}

export interface RootInputs {
  readonly context: Context;
  readonly version: string;
  readonly repository: string;
  readonly webPort: number;
  /** The web app's, service's and schema package's manifests. */
  readonly manifests: readonly ManifestFile[];
  /** Files create-app owns rather than takes from the reference. */
  readonly owned: { readonly agents: string; readonly seed: string };
}

export function rootFiles(inputs: RootInputs): {
  files: TemplateFile[];
  manifests: ManifestFile[];
} {
  const { reference } = inputs.context;
  checkRootEntries(reference);
  const manifests = DATABASE_VARIANTS.map((variant) => ({
    path: "package.json",
    when: { database: variant },
    manifest: rootManifest(reference, inputs.context, variant),
  }));
  const files: TemplateFile[] = [
    ...copied(reference),
    ...moonFiles(reference),
    ...DATABASE_VARIANTS.map((variant) => ({
      path: "moon.yml",
      when: { database: variant },
      content: rootMoon(reference, variant),
    })),
    {
      path: "pnpm-workspace.yaml",
      when: {},
      content: workspace(
        reference,
        [...manifests, ...inputs.manifests],
        inputs.version,
        inputs.context.published,
      ),
    },
    ...[
      { web: true, service: true },
      { web: true, service: false },
      { web: false, service: true },
    ].map((parts) => ({
      path: "tsconfig.json",
      when: parts,
      content: rootTsconfig(reference, parts),
    })),
    ...environment(reference, inputs.webPort),
    { path: ".oxfmtrc.json", when: {}, content: formatSettings(reference) },
    { path: "renovate.json", when: {}, content: renovate(reference, inputs.repository) },
    {
      path: ".github/workflows/ci.yml",
      when: {},
      content: ci(reference, inputs.repository, inputs.version),
    },
    { path: ".gitignore", when: {}, content: gitignore(reference) },
    { path: "AGENTS.md", when: {}, content: inputs.owned.agents },
    ...databaseFiles(reference, inputs.owned.seed),
  ];
  const withManifests = [
    ...files,
    ...manifests.map(({ path, when, manifest }) => ({ path, when, content: json(manifest) })),
  ];
  return { files: [...files, ...scriptFiles(reference, withManifests)], manifests };
}
