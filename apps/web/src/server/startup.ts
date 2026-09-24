import { loadAuthConfig } from "@littleorgans/auth-tanstack";
import { definePlugin } from "nitro";

/**
 * Nitro initializes plugins before the documented standalone Node server listens. Other presets
 * may initialize on a cold request and need their own deployment probe.
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

export function checkStartup(): void {
  checkConfiguration(process.env, import.meta.env.DEV);
}

export default definePlugin(checkStartup);
