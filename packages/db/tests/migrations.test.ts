import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The package ships these files, and the repository applies its own copies from db/migrations:
// the same position as a consumer that copied them into its migration tool's directory. Every
// Docker-backed gate here runs the repository copies, so they only prove what ships while the two
// stay byte-identical.
const shipped = fileURLToPath(new URL("../migrations/", import.meta.url));
const applied = fileURLToPath(new URL("../../../db/migrations/", import.meta.url));

const shippedFiles = readdirSync(shipped).toSorted();

describe("shipped migrations", () => {
  it("are all versioned SQL that applies in file-name order", () => {
    // Consumers apply the directory in lexical order, and a later version may only append to it.
    // A timestamp prefix makes lexical order the order of creation.
    expect(shippedFiles.length).toBeGreaterThan(0);
    for (const file of shippedFiles) {
      expect(file).toMatch(/^\d{14}(_[a-z0-9_]+)?\.sql$/u);
    }
  });

  it("match the copies the repository's database gates apply", () => {
    for (const file of shippedFiles) {
      expect(readFileSync(`${applied}${file}`, "utf8"), file).toBe(
        readFileSync(`${shipped}${file}`, "utf8"),
      );
    }
  });
});
