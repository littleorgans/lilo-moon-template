import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultClientConditions, defaultServerConditions } from "vite";
import type { ConfigEnv, UserConfig } from "vite";

/** Read the consuming workspace's manifests. Package directories need not match package names. */
function workspacePackages(root: URL): readonly string[] {
  return ["apps", "packages", "services"].flatMap((group) => {
    const directory = join(fileURLToPath(root), group);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const manifest = join(directory, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(manifest)) return [];
      const value: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (
        typeof value !== "object" ||
        value === null ||
        !("name" in value) ||
        typeof value.name !== "string"
      ) {
        throw new Error(`Missing package name in ${manifest}`);
      }
      return [value.name];
    });
  });
}

/**
 * The local export is TypeScript so Vite can bootstrap a clean workspace without a prior build.
 * pnpm publishConfig redirects the packed export to compiled JavaScript: Node refuses type
 * stripping inside node_modules. The external consumer gate exercises that published shape.
 */
/** Development resolves live source in both Vite environments. Production verifies built exports. */
export function workspaceSourceConfig(
  { command }: ConfigEnv,
  workspaceRoot: URL,
): Pick<UserConfig, "resolve" | "optimizeDeps" | "ssr" | "build"> {
  const serving = command === "serve";
  return {
    build: {
      rolldownOptions: {
        plugins: [
          {
            name: "baseline-client-boundary",
            generateBundle(_options, bundle) {
              for (const chunk of Object.values(bundle)) {
                if (chunk.type !== "chunk") continue;
                for (const [id, module] of Object.entries(chunk.modules)) {
                  if (
                    module.renderedLength > 0 &&
                    /(?:__vite-browser-external|browser-external:)/.test(id)
                  ) {
                    this.error(`Server dependency reached the browser: ${id}`);
                  }
                }
              }
            },
          },
        ],
      },
    },
    resolve: {
      conditions: serving
        ? [...defaultClientConditions, "@littleorgans/source"]
        : [...defaultClientConditions],
    },
    optimizeDeps: { exclude: [...workspacePackages(workspaceRoot)] },
    ssr: {
      resolve: {
        conditions: serving
          ? [...defaultServerConditions, "@littleorgans/source"]
          : [...defaultServerConditions],
      },
    },
  };
}
