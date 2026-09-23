import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// npm never copies a repository-root LICENSE into a workspace package's tarball, so every
// published package carries its own copy. This keeps the copies identical to the root file.
function publishedPackages() {
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

await test("every published package ships the repository LICENSE unchanged", () => {
  const license = readFileSync("LICENSE", "utf8");
  assert.match(license, /^MIT License\n/);
  const published = publishedPackages();
  assert.ok(published.length > 0, "no published packages found");
  for (const { directory, manifest } of published) {
    assert.equal(manifest.license, "MIT", `${directory} manifest license`);
    const copy = join(directory, "LICENSE");
    assert.ok(existsSync(copy), `${copy} is missing`);
    assert.equal(readFileSync(copy, "utf8"), license, `${copy} differs from the root LICENSE`);
  }
});
