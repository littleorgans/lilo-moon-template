import { readdirSync } from "node:fs";

import { defaultClientConditions, defaultServerConditions } from "vite";
import type { ConfigEnv, UserConfig } from "vite";

/**
 * Every workspace package, by its published name.
 *
 * Read from the filesystem rather than listed, so adding a package cannot silently leave it out of
 * the exclusions below. The directory name is the name after the scope, by convention; a package
 * that breaks that convention breaks this, which is a reason to keep the convention.
 *
 * `../../` from this file is `packages/`. There is no second answer to check for a built copy,
 * because this package has no built copy. See the note on `workspaceSourceConfig`.
 */
function workspacePackages(): readonly string[] {
  return readdirSync(new URL("../../", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `@lilo-moon/${entry.name}`);
}

/**
 * The part of an application's Vite config that makes workspace packages resolve to their source.
 *
 * Spread into the config rather than wrapping it, so an application still owns its own plugins,
 * port and everything else. What it does not own is the three traps below, each of which fails in
 * a way that does not name its cause:
 *
 * The `@lilo-moon/source` condition is added for `serve` only. In a build, packages must resolve
 * to their built output like any consumer's would, or the build proves nothing about what ships.
 *
 * It is added twice. TanStack Start and Nitro create an SSR environment whose conditions *replace*
 * the top-level list rather than extending it, so setting it once leaves the server half resolving
 * to `dist` while the client half serves live source. That split is the confusing one: edits to a
 * package appear in the browser and not in the server render.
 *
 * Every workspace package is excluded from prebundling. Without this, Vite serves a prebundled copy
 * captured before the condition applied, so a package's source changes and the page does not.
 *
 * This package itself ships source with no build, which is why nothing here needs building before
 * an application can load its Vite config. Vite compiles `vite.config.ts` through its own esbuild
 * pass, and that pass does not honour the `@lilo-moon/source` condition: measured 2026-08-26,
 * pointing the exports map at `./dist` and deleting it failed with "Failed to resolve entry for
 * package". Publishing source as the only export is what removes the build edge, so restoring the
 * usual `dist` shape here would put one back.
 */
export function workspaceSourceConfig({
  command,
}: ConfigEnv): Pick<UserConfig, "resolve" | "optimizeDeps" | "ssr"> {
  const serving = command === "serve";

  return {
    resolve: {
      conditions: serving
        ? [...defaultClientConditions, "@lilo-moon/source"]
        : [...defaultClientConditions],
    },
    optimizeDeps: {
      exclude: [...workspacePackages()],
    },
    ssr: {
      resolve: {
        conditions: serving
          ? [...defaultServerConditions, "@lilo-moon/source"]
          : [...defaultServerConditions],
      },
    },
  };
}
