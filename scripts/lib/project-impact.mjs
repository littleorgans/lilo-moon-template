import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { fileHash, git, projectFile } from "./project-files.mjs";
import {
  originFingerprint,
  projectRecords,
  readOrigin,
  templateConfig,
} from "./project-registry.mjs";

function changedFiles(source, from, to) {
  const args = ["diff", "--name-only", "-z", "--no-renames", from];
  if (to) args.push(to);
  args.push("--");
  const files = git(source, args).split("\0").filter(Boolean);
  if (!to)
    files.push(
      ...git(source, ["ls-files", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean),
    );
  return [...new Set(files)]
    .filter((file) => !file.startsWith(".template/") && file !== ".template-origin.json")
    .toSorted((left, right) => left.localeCompare(right));
}

function members(root) {
  return ["apps", "packages", "services"].flatMap((group) => {
    if (!existsSync(join(root, group))) return [];
    return readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = `${group}/${entry.name}`;
        const manifestPath = join(root, path, "package.json");
        const manifest = existsSync(manifestPath)
          ? JSON.parse(readFileSync(manifestPath, "utf8"))
          : {};
        return {
          path,
          name: manifest.name ?? path,
          dependencies: Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
            ...manifest.peerDependencies,
            ...manifest.optionalDependencies,
          }),
        };
      });
  });
}

function affectedMembers(root, changes) {
  const inventory = members(root);
  const direct = new Set(
    changes.map(({ path }) => {
      const match = /^(apps|packages|services)\/[^/]+/.exec(path);
      return match?.[0] ?? "root";
    }),
  );
  const affected = new Set(
    inventory
      .filter((member) => direct.has("root") || direct.has(member.path))
      .map((member) => member.name),
  );
  let previous;
  do {
    previous = affected.size;
    for (const member of inventory) {
      if (member.dependencies.some((dependency) => affected.has(dependency)))
        affected.add(member.name);
    }
  } while (previous !== affected.size);
  return inventory
    .filter((member) => affected.has(member.name))
    .map(({ path, name }) => ({ path, name }));
}

function inspectRecord(source, record, templateId, from, to) {
  const summary = {
    ...record,
    comparison: { from: from ?? record.templateRevision, to: to ?? "working-tree" },
  };
  try {
    const changed = changedFiles(source, summary.comparison.from, to);
    if (!record.path || !existsSync(record.path))
      return { ...summary, status: "unavailable", changedTemplateFiles: changed };
    const origin = readOrigin(record.path);
    if (
      origin.id !== record.id ||
      origin.template.id !== templateId ||
      origin.template.revision !== record.templateRevision ||
      originFingerprint(origin) !== record.originFingerprint
    ) {
      throw new Error("Checkout provenance does not match the registered project");
    }
    const changes = changed.map((path) => {
      const current = fileHash(projectFile(record.path, path));
      const initial = origin.files[path];
      const state = initial
        ? current === null
          ? "deleted"
          : current === initial
            ? "unchanged"
            : "modified"
        : current === null
          ? "new-in-template"
          : "project-only";
      return { path, state };
    });
    return {
      ...summary,
      status: "available",
      changes,
      manifestDependents: affectedMembers(record.path, changes),
      dependencyCoverage:
        "JavaScript package manifests only; inspect Moon and other language dependencies separately",
    };
  } catch (error) {
    return { ...summary, status: "unknown", reason: error.message };
  }
}

/** Impact is review evidence. File hashes cannot prove semantic compatibility or migration safety. */
export function projectImpact(source, { from, to } = {}) {
  const template = templateConfig(source);
  for (const ref of [from, to].filter(Boolean))
    git(source, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  return {
    schemaVersion: 1,
    templateId: template.id,
    templateHead: git(source, ["rev-parse", "HEAD"]),
    projects: projectRecords(source).map((record) =>
      inspectRecord(source, record, template.id, from, to),
    ),
  };
}
