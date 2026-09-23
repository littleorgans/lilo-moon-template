// The release directory: every published package packed once, and release.json recording each
// tarball's sha512 at pack time. The secrets scan, published-shape, the publish and the smoke all
// read tarballs through readReleaseTarballs, so each of them refuses bytes that changed after
// packing, and what was scanned is what npm receives.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const RELEASE_MANIFEST = "release.json";

const byText = (a, b) => a.localeCompare(b);

/** The Subresource Integrity string npm records as `dist.integrity`. */
export function integrityOf(file) {
  return `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;
}

/** The package.json inside a packed tarball. */
export function packedManifest(file) {
  return JSON.parse(
    execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }),
  );
}

/**
 * The tarballs release.json records, with absolute paths. Throws unless the directory holds exactly
 * those files and each still has the recorded integrity.
 */
export function readReleaseTarballs(directory) {
  const root = resolve(directory);
  const manifestPath = join(root, RELEASE_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error(`Release: ${manifestPath} is missing; run \`node scripts/release.mjs pack\``);
  }
  const { packages } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error(`Release: ${manifestPath} records no packages`);
  }
  const recorded = packages.map(({ file }) => file).toSorted(byText);
  const present = readdirSync(root)
    .filter((name) => name.endsWith(".tgz"))
    .toSorted(byText);
  if (JSON.stringify(recorded) !== JSON.stringify(present)) {
    throw new Error(
      `Release: ${root} holds ${present.join(", ") || "no tarballs"}, but ${RELEASE_MANIFEST} records ${recorded.join(", ")}`,
    );
  }
  return packages.map(({ name, version, file, integrity }) => {
    const path = join(root, file);
    const found = integrityOf(path);
    if (found !== integrity) {
      throw new Error(
        `Release: ${file} changed after it was packed and scanned: recorded ${integrity}, found ${found}`,
      );
    }
    return { name, version, file: path, integrity };
  });
}

/**
 * Tarballs ordered so each follows the packages it depends on, read from the packed manifests. A
 * consumer who installs a dependent in the window between two uploads then finds its dependencies.
 */
export function publishOrder(tarballs) {
  const byName = new Map(
    tarballs.map((tarball) => {
      const manifest = packedManifest(tarball.file);
      if (manifest.name !== tarball.name || manifest.version !== tarball.version) {
        throw new Error(
          `Release: ${tarball.file} holds ${manifest.name}@${manifest.version}, not ${tarball.name}@${tarball.version}`,
        );
      }
      const internal = Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      });
      return [tarball.name, { tarball, internal }];
    }),
  );
  const ordered = [];
  const visiting = new Set();
  const visit = (name, path) => {
    const node = byName.get(name);
    if (node === undefined || ordered.includes(node.tarball)) return;
    if (visiting.has(name)) {
      throw new Error(`Release: dependency cycle ${[...path, name].join(" -> ")}`);
    }
    visiting.add(name);
    for (const dependency of node.internal.toSorted(byText)) visit(dependency, [...path, name]);
    visiting.delete(name);
    ordered.push(node.tarball);
  };
  for (const name of [...byName.keys()].toSorted(byText)) visit(name, []);
  return ordered;
}

/**
 * The body under a CHANGELOG heading for `version`, as changesets/action puts it in a GitHub
 * release: everything after `## <version>` up to the next heading of the same depth.
 */
export function changelogEntry(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}
