import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";
import { expect, it } from "vitest";

import { workspaceSourceConfig } from "../src/index.js";

it("rejects server builtins in a real browser build and accepts browser code", async () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-browser-"));
  const input = join(root, "entry.js");
  const config = workspaceSourceConfig(
    { command: "build", mode: "production" },
    pathToFileURL(root),
  );
  const compile = () =>
    build({
      configFile: false,
      root,
      logLevel: "silent",
      ...config,
      build: {
        ...config.build,
        write: false,
        rolldownOptions: { ...config.build?.rolldownOptions, input },
      },
    });
  try {
    writeFileSync(
      input,
      'import { AsyncLocalStorage } from "node:async_hooks"; console.log(new AsyncLocalStorage());',
    );
    await expect(compile()).rejects.toThrow("Server dependency reached the browser");
    writeFileSync(input, 'console.log("browser");');
    await expect(compile()).resolves.toBeDefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
