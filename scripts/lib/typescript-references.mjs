import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Remove references to deleted members without changing any surviving generated configuration. */
function pruneProject(root) {
  const path = join(root, "tsconfig.json");
  if (!existsSync(path)) return;
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(config.references)) return;
  const references = config.references.filter((reference) =>
    existsSync(join(root, reference.path)),
  );
  if (references.length === config.references.length) return;
  writeFileSync(path, `${JSON.stringify({ ...config, references }, null, 2)}\n`);
}

export function pruneReferences(root) {
  pruneProject(root);
  for (const group of ["apps", "packages", "services"]) {
    const directory = join(root, group);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pruneProject(join(directory, entry.name));
    }
  }
}
