import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { workspaceSourceConfig } from "../src/index.js";

const serve = workspaceSourceConfig(
  { command: "serve", mode: "development" },
  new URL("../../../", import.meta.url),
);
const build = workspaceSourceConfig(
  { command: "build", mode: "production" },
  new URL("../../../", import.meta.url),
);

describe("workspaceSourceConfig", () => {
  // Serving from source is a development affordance. A build that kept the condition would resolve
  // packages to files no consumer of the published package ever gets, and prove nothing.
  it("adds the source condition when serving and not when building", () => {
    expect(serve.resolve?.conditions).toContain("@littleorgans/source");
    expect(build.resolve?.conditions).not.toContain("@littleorgans/source");
  });

  // The trap this package exists for. Start and Nitro replace the top-level conditions rather than
  // extending them, so a config that sets them once serves live source to the browser and built
  // output to the server renderer, and the two disagree without saying so.
  it("sets the condition on the SSR environment as well as the client", () => {
    expect(serve.ssr?.resolve?.conditions).toContain("@littleorgans/source");
    expect(build.ssr?.resolve?.conditions).not.toContain("@littleorgans/source");
  });

  // Replacing the defaults rather than extending them is how a config loses `browser` or `node`
  // and starts resolving the wrong half of a dual package.
  it("keeps the defaults it is extending", () => {
    expect(serve.resolve?.conditions?.length).toBeGreaterThan(1);
    expect(serve.ssr?.resolve?.conditions?.length).toBeGreaterThan(1);
  });

  // Derived from the filesystem, so a package added tomorrow is excluded without anyone editing a
  // list. Asserted against packages that exist rather than a count, which would break on every
  // addition and teach the next person to update the number rather than read the test.
  it("excludes every workspace package from prebundling", () => {
    expect(serve.optimizeDeps?.exclude).toEqual(expect.arrayContaining(["@littleorgans/ui"]));
    expect(serve.optimizeDeps?.exclude).toEqual(expect.arrayContaining(["@littleorgans/auth"]));
    expect(serve.optimizeDeps?.exclude).toEqual(
      expect.arrayContaining(["@littleorgans/vite-config"]),
    );
  });
});

it("discovers a consumer with unrelated directory and package names", () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-consumer-"));
  try {
    mkdirSync(join(root, "packages", "arbitrary"), { recursive: true });
    writeFileSync(
      join(root, "packages", "arbitrary", "package.json"),
      JSON.stringify({ name: "@another/actual-name" }),
    );
    const config = workspaceSourceConfig(
      { command: "serve", mode: "development" },
      pathToFileURL(root),
    );
    expect(config.optimizeDeps?.exclude).toEqual(["@another/actual-name"]);
    writeFileSync(join(root, "packages", "arbitrary", "package.json"), "{}");
    expect(() =>
      workspaceSourceConfig({ command: "serve", mode: "development" }, pathToFileURL(root)),
    ).toThrow("Missing package name");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
