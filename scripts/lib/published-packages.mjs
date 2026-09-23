import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Workspace members whose manifests are not private, with their directories and manifests. */
export function publishedPackages() {
  const found = [];
  for (const group of ["apps", "packages", "services"]) {
    if (!existsSync(group)) continue;
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      const directory = join(group, entry.name);
      const manifestPath = join(directory, "package.json");
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private !== true) found.push({ directory, manifest });
    }
  }
  return found;
}
