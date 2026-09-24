import { loadAuthConfig } from "@littleorgans/auth-tanstack";
import { definePlugin } from "nitro";

/**
 * Refuses to start a server whose auth configuration would refuse every sign-in.
 *
 * The auth runtime reads its configuration on first use, and Nitro imports the application,
 * `auth.ts` included, only when the first request arrives. A plugin is the one hook the standalone
 * Node server runs before it listens, so this is where a short or duplicated cookie password fails
 * the deploy instead of the first request. Other presets may initialize plugins on a cold request
 * and need their own deployment probe. `loadAuthConfig`'s messages name the variable, never the
 * value.
 *
 * An entirely unconfigured dev server can render the sign-in page and theme lab. Once any auth
 * value is supplied, validate the whole configuration, just as production does.
 */
export function checkConfiguration(env: NodeJS.ProcessEnv, dev: boolean): void {
  const configured = [
    "WORKOS_CLIENT_ID",
    "WORKOS_API_KEY",
    "WORKOS_REDIRECT_URI",
    "WORKOS_COOKIE_PASSWORD",
    "WORKOS_COOKIE_PASSWORD_PREVIOUS",
  ].some((name) => (env[name] ?? "").length > 0);
  if (dev && !configured) return;
  loadAuthConfig(env);
}

/** The plugin: this process's environment. */
export function checkStartup(): void {
  checkConfiguration(process.env, import.meta.env.DEV);
}

export default definePlugin(checkStartup);
