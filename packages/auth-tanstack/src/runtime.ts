import {
  completeEmailSignIn,
  createAuthServices,
  handleCallback,
  loadAuthConfig,
  readAccess,
  signOut,
  startAuthorization,
  startEmailSignIn,
} from "@lilo-moon/auth-session";
import type {
  Access,
  AuthConfig,
  AuthFailureReport,
  AuthServices,
  CookieJar,
} from "@lilo-moon/auth-session";
import type { AuthorizationProvider } from "@lilo-moon/auth-workos";

import { requestCookies } from "./cookies.js";
import { reportAuthFailure } from "./log.js";

export interface AuthRuntimeOptions {
  readonly organizationPolicy: "personal" | "existing";
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
   * Told about every sign-in the provider refuses and every token that fails a check. Defaults to
   * a JSON line on stderr.
   *
   * A default exists because this is the wiring layer, where picking a sensible one is the job. It
   * is overridable because the moment an application has real logging, a line this package prints
   * is a line that misses the aggregator.
   */
  readonly log?: (failure: AuthFailureReport) => void;
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
  readonly endSession: (context: { readonly request: Request }) => Response;
  /** Who is calling: signed in, nobody, or a token this application will not act on. */
  readonly access: () => Promise<Access>;
}

/**
 * Everything an application needs to sign a person in, bound to this framework.
 *
 * Built lazily. Reading the environment at module load would make importing any route in a test
 * depend on a filled `.env.local`, and a package that demands configuration to be imported is a
 * package nobody can unit test.
 *
 * This adapter owns TanStack request context and cookie integration. The session package owns
 * HTTP sign-in flows and WorkOS configuration; the WorkOS package owns SDK calls. Changing the
 * framework leaves those session and provider operations intact.
 */
export function createAuthRuntime(options: AuthRuntimeOptions): AuthRuntime {
  const rawJar = options.cookies ?? requestCookies;
  let built: (AuthServices & { readonly config: AuthConfig }) | null = null;

  const services = (): AuthServices & { readonly config: AuthConfig } => {
    if (built === null) {
      const config = loadAuthConfig(options.env);
      built = { config, ...createAuthServices(config) };
    }
    return built;
  };

  const nameFor = (name: string) => `${services().config.cookieNamespace}_${name}`;
  const jar: CookieJar = {
    read: (name) => rawJar.read(nameFor(name)),
    write: (name, value, cookieOptions) => rawJar.write(nameFor(name), value, cookieOptions),
    clear: (name) => rawJar.clear(nameFor(name)),
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
        organizationPolicy: options.organizationPolicy,
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
        organizationPolicy: options.organizationPolicy,
        codeEntryPath: options.codeEntryPath,
        log: options.log ?? reportAuthFailure,
      });
    },

    endSession: (context) => {
      const { auth, config } = services();
      const returnTo = new URL("/", config.redirectUri).href;
      return signOut(context, jar, {
        cookieKey: config.cookieKey,
        returnTo,
        logoutUrl: (sessionId) => auth.getLogoutUrl({ sessionId, returnTo }),
      });
    },

    access: async () => {
      const { auth, config, verify } = services();
      return await readAccess(jar, {
        auth,
        verify,
        cookieKey: config.cookieKey,
        secureCookies: config.secureCookies,
        log: options.log ?? reportAuthFailure,
      });
    },
  };
}
