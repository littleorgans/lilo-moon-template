// What a consumer outside this workspace sees of a package: every entry point its packed `exports`
// declares, imported and typechecked by TypeScript 5. root:published-shape runs it on the tarballs
// before a release, and the release smoke runs it on the versions the registry serves after one.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

// TypeScript 5 is deliberately independent of the workspace compiler (TypeScript 7).
export const CONSUMER_TYPESCRIPT = "5.9.3";

export const consumerCompilerOptions = {
  target: "ES2024",
  lib: ["ES2024", "DOM"],
  types: ["node"],
  module: "NodeNext",
  jsx: "react-jsx",
  strict: true,
  noEmit: true,
  skipLibCheck: false,
};

// Export conditions a packed manifest may use. Anything else is a condition some consumer's
// resolver may select, as `@littleorgans/source` was before publishConfig.exports omitted it.
export const EXPORT_CONDITIONS = ["types", "import", "default"];

const readManifest = (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Every file in `root`, as `./`-relative paths with forward slashes. */
function packageFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return packageFiles(root, path);
    return [`./${relative(root, path).split(sep).join("/")}`];
  });
}

/**
 * A package's manifest and every concrete entry point `exports` declares, with each wildcard
 * subpath expanded against the files in `root`. Reading the manifest covers a new package or
 * subpath without editing a list.
 */
export function entryPoints(root) {
  const manifest = readManifest(root);
  const files = packageFiles(root);
  assert.ok(manifest.exports, `${manifest.name} must declare exports`);
  const entries = Object.entries(manifest.exports).flatMap(([subpath, target]) => {
    const conditions = typeof target === "string" ? { default: target } : target;
    for (const [condition, path] of Object.entries(conditions)) {
      assert.ok(
        EXPORT_CONDITIONS.includes(condition),
        `${manifest.name} exports ${subpath} under the condition "${condition}"; packed exports use only ${EXPORT_CONDITIONS.join(", ")}`,
      );
      assert.equal(typeof path, "string", `${manifest.name} nests conditions under ${subpath}`);
    }
    const runtime = conditions.import ?? conditions.default;
    assert.ok(runtime, `${manifest.name} exports ${subpath} with no import or default target`);
    if (subpath.includes("*")) {
      assert.equal(
        subpath.split("*").length,
        2,
        `${manifest.name} has an unsupported subpath pattern`,
      );
      assert.equal(
        runtime.split("*").length,
        2,
        `${manifest.name} has an unsupported export target pattern`,
      );
    }
    const stars = subpath.includes("*")
      ? files.flatMap((file) => {
          const [prefix, suffix] = runtime.split("*");
          const fits = file.startsWith(prefix) && file.endsWith(suffix);
          return fits && file.length > prefix.length + suffix.length
            ? [file.slice(prefix.length, file.length - suffix.length)]
            : [];
        })
      : [undefined];
    assert.ok(
      stars.length > 0,
      `${manifest.name} exports ${subpath}, which matches no packed file`,
    );
    return stars.map((star) => {
      const expand = (path) => (star === undefined ? path : path?.replaceAll("*", star));
      const entry = {
        subpath: expand(subpath),
        specifier: `${manifest.name}${expand(subpath).slice(1)}`,
        runtime: expand(runtime),
        types: expand(conditions.types),
      };
      // JavaScript is imported and must carry declarations; anything else, CSS or SQL, is a file.
      if (/\.[cm]?js$/.test(entry.runtime)) {
        assert.ok(entry.types, `${entry.specifier} has JavaScript but no types condition`);
      }
      for (const path of [entry.runtime, entry.types].filter(Boolean)) {
        assert.ok(
          files.includes(path),
          `${entry.specifier} points at ${path}, which is not packed`,
        );
      }
      return entry;
    });
  });
  return { manifest, entries };
}

/**
 * A module that imports every typed entry point and resolves every file entry point. A consumer
 * typechecks it, then runs it under Node.
 */
export function entriesModule(entries) {
  const modules = entries.filter((entry) => entry.types);
  const assets = entries.filter((entry) => !entry.types);
  return {
    modules,
    assets,
    source: `import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

${modules.map(({ specifier }, index) => `import * as entry${index} from "${specifier}";`).join("\n")}

assert.equal([${modules.map((_, index) => `entry${index}`).join(", ")}].length, ${modules.length});
for (const specifier of ${JSON.stringify(assets.map(({ specifier }) => specifier))}) {
  assert.ok(existsSync(fileURLToPath(import.meta.resolve(specifier))), specifier);
}
`,
  };
}

// Third-party declaration errors a consumer on skipLibCheck: false sees, by package and code. None
// may come from a published package or the consumer's own files. drizzle-orm's dialects import one
// another, so the node-postgres entry loads its gel, MySQL, SingleStore and SQLite declarations too.
const TOLERATED_DECLARATION_ERRORS = new Map([
  [
    "drizzle-orm",
    new Set([
      // Its gel and mysql2 drivers import optional peers that a Postgres consumer never installs.
      "TS2307",
      // Its query and column builders disagree with their own base classes and interfaces.
      "TS2344",
      "TS2416",
      "TS2420",
      "TS2515",
      // PgRole and its siblings share no property with their own config types.
      "TS2559",
      // utils.d.ts uses TextDecoder as a type, which only the DOM lib declares; a Node service
      // without DOM in lib sees this.
      "TS2749",
    ]),
  ],
]);

/** The package a declaration file belongs to, or undefined for the consumer's own files. */
function declarationOwner(file) {
  if (!/\.d\.[cm]?ts$/.test(file)) return undefined;
  const parts = file.replaceAll("\\", "/").split("node_modules/");
  if (parts.length === 1) return undefined;
  const [first, second] = parts.at(-1).split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

/**
 * TypeScript 5 over the consumer's files with skipLibCheck: false. The only errors allowed are the
 * third-party declaration errors listed in TOLERATED_DECLARATION_ERRORS. Returns a summary line.
 */
export function typecheckConsumer(root, env) {
  const { version } = readManifest(join(root, "node_modules/typescript"));
  assert.match(version, /^5\./, `the consumer installed TypeScript ${version}, not 5.x`);
  const result = spawnSync(
    join(root, "node_modules/.bin/tsc"),
    ["--project", "tsconfig.json", "--pretty", "false"],
    { cwd: root, env, encoding: "utf8" },
  );
  assert.ok(
    !result.error && !result.signal,
    `tsc did not finish: ${result.error ?? result.signal}`,
  );
  assert.equal(result.stderr, "", `tsc wrote unexpected stderr: ${result.stderr}`);
  const errors = result.stdout.split("\n").flatMap((line) => {
    const match = /^(.+?)\(\d+,\d+\): error (TS\d+): /.exec(line);
    if (match) return [{ line, file: match[1], code: match[2] }];
    // Global/config diagnostics have no file location. Never lose one beside tolerated errors.
    return /error TS\d+:/.test(line) ? [{ line, file: "", code: "" }] : [];
  });
  assert.ok(
    result.status === 0 || errors.length > 0,
    `tsc failed without a diagnostic:\n${result.stdout}${result.stderr}`,
  );
  const untolerated = errors.filter(
    ({ file, code }) => !TOLERATED_DECLARATION_ERRORS.get(declarationOwner(file))?.has(code),
  );
  assert.deepEqual(
    untolerated.map(({ line }) => line),
    [],
    "the TypeScript 5 consumer typecheck failed outside the tolerated third-party declarations",
  );
  const tolerated = Object.entries(Object.groupBy(errors, ({ file }) => declarationOwner(file)))
    .map(([name, found]) => `${found.length} in ${name}`)
    .join(", ");
  return `TypeScript ${version}, skipLibCheck false: no errors outside tolerated third-party declarations (${tolerated || "none"})`;
}
