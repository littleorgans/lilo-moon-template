import type { Principal } from "@lilo-moon/auth";
import {
  completeEmailSignIn,
  createAuthServices,
  handleCallback,
  loadAuthConfig,
  readPrincipal,
  signOut,
  startAuthorization,
  startEmailSignIn,
} from "@lilo-moon/auth-session";
import type { AuthConfig, AuthServices, CallbackFailure, CookieJar } from "@lilo-moon/auth-session";
import type { AuthorizationProvider } from "@lilo-moon/auth-workos";

import { requestCookies } from "./cookies.js";
import { reportAuthFailure } from "./log.js";

export interface AuthRuntimeOptions {
  /** Which identity path a redirect sign-in takes. `authkit` is the provider's own hosted page. */
  readonly provider: AuthorizationProvider;
  /** Where a completed sign-in lands. */
  readonly signedInPath: string;
  /** Where the person types an emailed code. Must match the application's route for that page. */
  readonly codeEntryPath: string;
  /** Overridable so a test never depends on a filled `.env.local`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Overridable so a test never needs a live request context. */
  readonly cookies?: CookieJar;
  /**
   * Told about every sign-in the provider refuses. Defaults to a JSON line on stderr.
   *
   * A default exists because this is the wiring layer, where picking a sensible one is the job. It
   * is overridable because the moment an application has real logging, a line this package prints
   * is a line that misses the aggregator.
   */
  readonly log?: (failure: CallbackFailure) => void;
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
  readonly sendEmailCode: (context: { readonly request: Request }) => Promise<Response>;
  readonly verifyEmailCode: (context: { readonly request: Request }) => Promise<Response>;
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
        log: options.log ?? reportAuthFailure,
      });
    },

    sendEmailCode: async (context) => {
      const { auth, config } = services();
      return await startEmailSignIn(context, jar, {
        auth,
        secureCookies: config.secureCookies,
        codeEntryPath: options.codeEntryPath,
        log: options.log ?? reportAuthFailure,
      });
    },

    verifyEmailCode: async (context) => {
      const { auth, config } = services();
      return await completeEmailSignIn(context, jar, {
        auth,
        cookieKey: config.cookieKey,
        secureCookies: config.secureCookies,
        signedInPath: options.signedInPath,
        codeEntryPath: options.codeEntryPath,
        log: options.log ?? reportAuthFailure,
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
