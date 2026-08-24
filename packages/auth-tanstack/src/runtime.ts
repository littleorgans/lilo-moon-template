import type { Principal } from "@lilo-moon/auth";
import {
  createAuthServices,
  handleCallback,
  loadAuthConfig,
  readPrincipal,
  signOut,
  startAuthorization,
} from "@lilo-moon/auth-session";
import type { AuthConfig, AuthServices, CookieJar } from "@lilo-moon/auth-session";
import type { AuthorizationProvider } from "@lilo-moon/auth-workos";

import { requestCookies } from "./cookies.js";

export interface AuthRuntimeOptions {
  /** Which identity path a sign-in takes. `authkit` is the provider's own hosted page. */
  readonly provider: AuthorizationProvider;
  /** Where a completed sign-in lands. */
  readonly signedInPath: string;
  /** Overridable so a test never depends on a filled `.env.local`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Overridable so a test never needs a live request context. */
  readonly cookies?: CookieJar;
}

/**
 * Declared as function-valued properties rather than methods, deliberately.
 *
 * These are closures over the runtime's own state and never touch `this`, and route definitions
 * reference them detached (`GET: runtime.completeSignIn`). Method syntax would make that reference
 * look like a scoping bug to any reader and to the linter, which is right to flag it.
 */
export interface AuthRuntime {
  /** Reads configuration on first use, then holds it. */
  readonly services: () => AuthServices & { readonly config: AuthConfig };
  readonly startSignIn: (context: unknown) => Response;
  readonly completeSignIn: (context: { readonly request: Request }) => Promise<Response>;
  readonly endSession: (context: unknown) => Response;
  /** The verified caller, or null when there is no session. Raises if a token fails a check. */
  readonly principal: () => Promise<Principal | null>;
}

/**
 * Everything an application needs to sign a person in, bound to this framework.
 *
 * Built lazily. Reading the environment at module load would make importing any route in a test
 * depend on a filled `.env.local`, and a package that demands configuration to be imported is a
 * package nobody can unit test.
 *
 * This is the module you rewrite to move to another framework, in the same way
 * `packages/auth-workos` is the module you rewrite to move to another identity vendor. Everything
 * it composes lives in `@lilo-moon/auth-session` and knows nothing about any of this.
 */
export function createAuthRuntime(options: AuthRuntimeOptions): AuthRuntime {
  const jar = options.cookies ?? requestCookies;
  let built: (AuthServices & { readonly config: AuthConfig }) | null = null;

  const services = (): AuthServices & { readonly config: AuthConfig } => {
    if (built === null) {
      const config = loadAuthConfig(options.env);
      built = { config, ...createAuthServices(config) };
    }
    return built;
  };

  return {
    services,

    startSignIn: (context) => {
      const { auth, config } = services();
      return startAuthorization(context, jar, {
        authorizationUrl: (state) =>
          auth.getAuthorizationUrl({
            redirectUri: config.redirectUri,
            state,
            provider: options.provider,
          }),
        secureCookies: config.secureCookies,
      });
    },

    completeSignIn: async (context) => {
      const { auth, config } = services();
      return await handleCallback(context, jar, {
        auth,
        cookieKey: config.cookieKey,
        secureCookies: config.secureCookies,
        signedInPath: options.signedInPath,
      });
    },

    endSession: (context) => {
      return signOut(context, jar);
    },

    principal: async () => {
      const { config, verify } = services();
      return await readPrincipal(jar, { cookieKey: config.cookieKey, verify });
    },
  };
}
