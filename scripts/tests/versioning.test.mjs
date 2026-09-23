import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
