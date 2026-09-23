import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const shipped = fileURLToPath(new URL("../migrations/", import.meta.url));
const shippedFiles = readdirSync(shipped)
  .filter((file) => file !== "atlas.sum")
  .toSorted();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

describe("shipped migrations", () => {
  it("have unique versions in file-name order", () => {
    expect(shippedFiles.length).toBeGreaterThan(0);
    for (const file of shippedFiles) {
      expect(file).toMatch(/^\d{14}(_[a-z0-9_]+)?\.sql$/u);
    }
    const versions = shippedFiles.map((file) => file.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("only appends migrations after the base revision, preserving every existing byte", () => {
    const base = process.env["MOON_BASE"] || "origin/main";
    // The fallback supports the one-time move from the original Atlas directory.
    const paths = git(
      "ls-tree",
      "-r",
      "--name-only",
      base,
      "packages/db/migrations",
      "db/migrations",
    )
      .trim()
      .split("\n")
      .filter((path) => path.endsWith(".sql"));
    expect(paths.length, `migration history must exist at ${base}`).toBeGreaterThan(0);
    const existing = paths.map((path) => path.slice(path.lastIndexOf("/") + 1)).toSorted();
    for (const path of paths) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      expect(readFileSync(`${shipped}${name}`, "utf8"), `${name} is immutable`).toBe(
        git("show", `${base}:${path}`),
      );
    }
    const latestVersion = existing.at(-1)!.slice(0, 14);
    for (const file of shippedFiles.filter((name) => !existing.includes(name))) {
      expect(file.slice(0, 14) > latestVersion, `${file} must follow ${latestVersion}`).toBe(true);
    }
  });
});
