// The web app, the service and the typed schema package, taken from apps/web, services/api and
// db/drizzle. What changes is what ties them to this repository: workspace dependencies on the
// published packages become catalog installs, names and ports become the project's choices, and
// project references to packages/ go.

import type { Condition, Defaults, TemplateFile } from "../template.ts";
import { TOKENS } from "../template.ts";
import type { Manifest, Reference } from "./reference.ts";
import {
  DEPENDENCY_SECTIONS,
  dependencies,
  parseObject,
  recordField,
  replace,
  stringField,
} from "./reference.ts";
import { expectAt, parseYaml, valueAt } from "./yaml.ts";

export const WEB = "apps/web";
export const SERVICE = "services/api";
export const SCHEMA = "db/drizzle";

/** The typed schema package's name in a project: its own scope, not this repository's. */
export const PROJECT_SCHEMA = `@${TOKENS.project}/drizzle-schema`;

export interface Context {
  readonly reference: Reference;
  /** The packages this repository publishes, which a project installs from the registry. */
  readonly published: ReadonlySet<string>;
  /** The reference's typed schema package name, which each project renames. */
  readonly schema: string;
}

/** A generated manifest, kept as an object so the root can build the catalog it needs. */
export interface ManifestFile {
  readonly path: string;
  readonly when: Condition;
  readonly manifest: Manifest;
}

export interface ProjectFiles {
  readonly files: TemplateFile[];
  readonly manifests: ManifestFile[];
}

const byName = (a: string, b: string) => a.localeCompare(b);

/**
 * `manifest` as a project installs it. A workspace dependency on a published package becomes
 * `catalog:`, and the typed schema keeps `workspace:` under the project's name. Any other
 * workspace dependency is a package a project cannot install, so the build stops.
 */
export function releasedManifest(manifest: Manifest, path: string, context: Context): Manifest {
  const result: Manifest = { ...manifest };
  for (const section of DEPENDENCY_SECTIONS) {
    if (manifest[section] === undefined) continue;
    const next: Record<string, string> = {};
    for (const [name, spec] of Object.entries(dependencies(manifest, section, path))) {
      if (!spec.startsWith("workspace:")) next[name] = spec;
      else if (name === context.schema) next[PROJECT_SCHEMA] = spec;
      else if (context.published.has(name)) next[name] = "catalog:";
      else throw new Error(`${path} depends on ${name}, a workspace package nothing publishes`);
    }
    result[section] = Object.fromEntries(Object.entries(next).toSorted(([a], [b]) => byName(a, b)));
  }
  return result;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A member tsconfig.json without its references into packages/, which a project installs rather
 * than builds, and with the output directory Moon routes for the project's own path.
 */
function projectTsconfig(content: string, file: string, from: string, to: string): string {
  const config = parseObject(content, file);
  const options = recordField(config, "compilerOptions", file);
  const outDir = `../../.moon/cache/types/${from}`;
  if (options["outDir"] !== outDir) throw new Error(`${file}: expected outDir ${outDir}`);
  options["outDir"] = `../../.moon/cache/types/${to}`;
  const references = config["references"];
  if (!Array.isArray(references)) throw new Error(`${file} has no references`);
  config["references"] = references.filter(
    (reference: unknown) =>
      !(
        typeof reference === "object" &&
        reference !== null &&
        "path" in reference &&
        typeof reference.path === "string" &&
        reference.path.startsWith("../../packages/")
      ),
  );
  return json(config);
}

/**
 * Every file of a reference project, moved to `target`, written under `when`, and passed through
 * `edit`, which returns null to leave a file out. The manifest is returned as an object.
 */
function project(
  context: Context,
  location: { readonly source: string; readonly target: string; readonly when: Condition },
  edit: (relative: string, content: string, file: string) => string | null,
): ProjectFiles {
  const { source, target, when } = location;
  const files: TemplateFile[] = [];
  const manifests: ManifestFile[] = [];
  for (const file of context.reference.files(source)) {
    const relative = file.slice(source.length + 1);
    const path = `${target}/${relative}`;
    if (relative === "package.json") {
      manifests.push({ path, when, manifest: context.reference.manifest(file) });
      continue;
    }
    const content = edit(relative, context.reference.read(file), file);
    if (content !== null) files.push({ path, when, content });
  }
  return { files, manifests };
}

function renameProject(
  manifests: ManifestFile[],
  name: string,
  context: Context,
  change: (manifest: Manifest, path: string) => void = () => {},
): ManifestFile[] {
  return manifests.map(({ path, when, manifest }) => {
    const result = releasedManifest(manifest, path, context);
    result["name"] = name;
    change(result, path);
    return { path, when, manifest: result };
  });
}

/** The reference's development port, which every other port anchor must repeat. */
export function webPort(reference: Reference): number {
  const file = `${WEB}/vite.config.ts`;
  const port = /server: \{ port: (\d+), strictPort: true \}/.exec(reference.read(file))?.[1];
  if (port === undefined) throw new Error(`${file} no longer pins server.port with strictPort`);
  return Number(port);
}

export function servicePort(reference: Reference): number {
  const file = `${SERVICE}/moon.yml`;
  const port = valueAt(parseYaml(reference.read(file), file), ["tasks", "dev", "env", "PORT"]);
  if (typeof port !== "string") throw new Error(`${file} no longer sets the dev task's PORT`);
  return Number(port);
}

export function defaults(reference: Reference): Defaults {
  return {
    web: WEB.split("/")[1] ?? WEB,
    webPort: webPort(reference),
    service: SERVICE.split("/")[1] ?? SERVICE,
    servicePort: servicePort(reference),
  };
}

export function webFiles(context: Context): ProjectFiles {
  const target = `apps/${TOKENS.web}`;
  const port = String(webPort(context.reference));
  const location = { source: WEB, target, when: { web: true } };
  const { files, manifests } = project(context, location, (relative, content, file) => {
    const edited = (() => {
      switch (relative) {
        case "tsconfig.json":
          return projectTsconfig(content, file, WEB, target);
        case "moon.yml":
          return replace(content, {
            from: `PORT: "${port}"`,
            to: `PORT: "${TOKENS.webPort}"`,
            file,
          });
        case "vite.config.ts":
          return replace(content, {
            from: `port: ${port},`,
            to: `port: ${TOKENS.webPort},`,
            file,
          });
        case "src/server/auth.ts": {
          const policy = /organizationPolicy: "(?:personal|existing)",/.exec(content)?.[0];
          if (policy === undefined) throw new Error(`${file} no longer sets organizationPolicy`);
          return replace(content, {
            from: policy,
            to: `organizationPolicy: "${TOKENS.organizationPolicy}",`,
            file,
          });
        }
        default:
          return content;
      }
    })();
    return edited.replaceAll(context.schema, PROJECT_SCHEMA);
  });
  if (!files.some(({ content }) => content.includes(TOKENS.organizationPolicy))) {
    throw new Error(`${WEB}/src/server/auth.ts is missing`);
  }
  return {
    files,
    manifests: renameProject(manifests, `@${TOKENS.project}/${TOKENS.web}`, context),
  };
}

/**
 * The service's moon.yml, edited as text so its folded container script keeps its lines. The
 * result is parsed to prove the edits landed where they were meant to.
 */
function serviceMoon(content: string, file: string, port: string): string {
  // The tests read the migrations and grant from the installed @littleorgans/db, which a project
  // does not build, so this repository's paths to them are not inputs there.
  const inputs =
    '    inputs:\n      - "/packages/db/migrations/**/*"\n      - "/packages/db/grants/**/*"\n';
  const edits: readonly (readonly [string, string, number])[] = [
    ["like apps/web's preview port,", "like a web app's preview port,", 1],
    [`PORT: "${port}"`, `PORT: "${TOKENS.servicePort}"`, 2],
    [
      "--filter @littleorgans/api deploy",
      `--filter @${TOKENS.project}/${TOKENS.service} deploy`,
      1,
    ],
    ["--tag littleorgans-api:local", `--tag ${TOKENS.project}-${TOKENS.service}:local`, 1],
    [inputs, "", 2],
  ];
  const edited = edits.reduce(
    (text, [from, to, count]) => replace(text, { from, to, file, count }),
    content,
  );
  const document = parseYaml(edited, file);
  for (const task of ["dev", "start"]) {
    expectAt(document, ["tasks", task, "env", "PORT"], TOKENS.servicePort, file);
  }
  for (const task of ["test", "test-coverage"]) {
    expectAt(document, ["tasks", task, "inputs"], undefined, file);
  }
  return edited;
}

export function serviceFiles(context: Context): ProjectFiles {
  const target = `services/${TOKENS.service}`;
  const port = String(servicePort(context.reference));
  const location = { source: SERVICE, target, when: { service: true } };
  const { files, manifests } = project(context, location, (relative, content, file) => {
    const edited = (() => {
      switch (relative) {
        // It describes the reference service. A project writes its own.
        case "README.md":
          return null;
        case "tsconfig.json":
          return projectTsconfig(content, file, SERVICE, target);
        case "moon.yml":
          return serviceMoon(content, file, port);
        case "Dockerfile":
          return replace(
            replace(content, { from: `image for ${SERVICE}.`, to: `image for ${target}.`, file }),
            {
              from: "`moon run api:container`",
              to: `\`moon run ${TOKENS.service}:container\``,
              file,
            },
          );
        default:
          return content;
      }
    })();
    return edited?.replaceAll(context.schema, PROJECT_SCHEMA) ?? null;
  });
  return {
    files,
    manifests: renameProject(
      manifests,
      `@${TOKENS.project}/${TOKENS.service}`,
      context,
      (manifest, path) => {
        // It describes the reference service.
        stringField(manifest, "description", path);
        delete manifest["description"];
      },
    ),
  };
}

/** The typed schema package, which both a web app and a service import. */
export function schemaFiles(context: Context): ProjectFiles {
  const location = { source: SCHEMA, target: SCHEMA, when: {} };
  const { files, manifests } = project(context, location, (_relative, content) => content);
  return { files, manifests: renameProject(manifests, PROJECT_SCHEMA, context) };
}
