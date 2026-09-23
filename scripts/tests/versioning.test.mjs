import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { publishedPackages } from "../lib/published-packages.mjs";

const sorted = (names) => names.toSorted((a, b) => a.localeCompare(b));

// Internal dependencies are exact pins, so published packages release together at one version
// (Changesets `fixed`). A package missing from the group would version on its own.
await test("every published package, and nothing private, is in the one fixed version group", () => {
  const { fixed } = JSON.parse(readFileSync(".changeset/config.json", "utf8"));
  const published = publishedPackages().map(({ manifest }) => manifest.name);
  assert.ok(published.length > 0, "no published packages found");
  assert.equal(fixed.length, 1, "expected exactly one fixed group");
  assert.deepEqual(sorted(fixed[0]), sorted(published));
});

// privatePackages.version is false, so Changesets never versions a private package. A changeset
// that names one beside published packages fails `changeset version` ("mixed changesets"), and one
// that names only private packages is never consumed, so the Version PR path never ends and the
// release workflow never reaches publishing.
await test("changesets name only published packages", () => {
  const { privatePackages } = JSON.parse(readFileSync(".changeset/config.json", "utf8"));
  assert.deepEqual(privatePackages, { version: false, tag: false });
  const published = new Set(publishedPackages().map(({ manifest }) => manifest.name));
  const named = readdirSync(".changeset")
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .flatMap((file) => {
      const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(".changeset", file), "utf8"));
      assert.ok(front, `${file} has no front matter`);
      return front[1]
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ file, name: /^"([^"]+)":/.exec(line)?.[1] ?? line }));
    });
  assert.deepEqual(
    named.filter(({ name }) => !published.has(name)),
    [],
    "remove private or unknown packages from these changesets",
  );
});
