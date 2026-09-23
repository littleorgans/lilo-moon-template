import { loadAuthConfig } from "@littleorgans/auth-tanstack";
import { definePlugin } from "nitro";

/**
 * Refuses to start a production server whose auth configuration would refuse every sign-in.
 *
 * The auth runtime reads its configuration on first use, so without this a short or duplicated
 * `WORKOS_COOKIE_PASSWORD` or `WORKOS_COOKIE_PASSWORD_PREVIOUS` passes a deploy and fails the first
 * request. This runs as a Nitro plugin, the one hook a built server calls before it listens: the
 * application itself, routes and `auth.ts` included, is imported only when the first request
 * arrives. The process exits with `loadAuthConfig`'s message, which names the variable and never
 * the value.
 *
 * Skipped by the dev server, which renders the sign-in page and the theme lab without a filled
 * `.env.local` and reports the same message from the first auth request instead.
 */
export function checkConfiguration(env: NodeJS.ProcessEnv, dev: boolean): void {
  if (dev) return;
  loadAuthConfig(env);
}

/** The plugin: this process's environment, checked only in a production build. */
export function checkStartup(): void {
  checkConfiguration(process.env, import.meta.env.DEV);
}

export default definePlugin(checkStartup);
