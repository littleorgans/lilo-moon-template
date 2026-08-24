import type { Principal, Verifier } from "@lilo-moon/auth";
import { redirect } from "@tanstack/react-router";

import { requestCookies } from "./cookies.js";
import type { CookieJar } from "./cookies.js";
import { countVisibleRows } from "./rows.js";
import type { ScopedRunner, VisibleRows } from "./rows.js";
import { getServices } from "./services.js";
import { SESSION_COOKIE, readSession } from "./session.js";

/**
 * Everything the signed-in page shows.
 *
 * Exported because the generated route tree names it: `AppRoute` carries the loader's return type,
 * and tsc cannot write a declaration for a type it has no name for.
 */
export interface SignedInView {
  readonly principal: Principal;
  /** Null when DATABASE_URL is unset, which is a runnable state rather than a broken one. */
  readonly rows: VisibleRows | null;
  /** Reported rather than thrown, so a broken database still shows the verified Principal. */
  readonly databaseError: string | null;
}

export interface SignedInDeps {
  readonly cookieKey: Buffer;
  readonly verify: Verifier;
  /** Null when DATABASE_URL is unset. Narrower than a Database on purpose: this page counts rows. */
  readonly runScoped: ScopedRunner | null;
}

function liveDeps(): SignedInDeps {
  const { config, verify, database } = getServices();
  return {
    cookieKey: config.cookieKey,
    verify,
    // Bound rather than wrapped in an arrow: the arrow would be a function only a live database
    // could ever run, and therefore one no test could reach.
    runScoped: database === null ? null : database.withPrincipal.bind(database),
  };
}

/**
 * Builds the signed-in view, or reports that there is no session.
 *
 * The access token is verified on every request. Nothing is trusted merely because it came out of
 * our own cookie: sealing proves we wrote it, and only the signature proves the provider issued it.
 * A cookie that survives a key rotation, or a token that has expired, has to fail here.
 */
export async function loadSignedView(
  jar: CookieJar,
  deps: SignedInDeps = liveDeps(),
): Promise<SignedInView | null> {
  const session = readSession(deps.cookieKey, jar.read(SESSION_COOKIE));
  if (session === null) return null;

  const principal = await deps.verify(session.accessToken);
  if (deps.runScoped === null) return { principal, rows: null, databaseError: null };

  try {
    return {
      principal,
      rows: await countVisibleRows(deps.runScoped, principal),
      databaseError: null,
    };
  } catch (error) {
    return {
      principal,
      rows: null,
      databaseError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The loader the signed-in route runs.
 *
 * No session is not an error, it is a person who has not signed in yet, so it redirects rather than
 * throwing. A token that fails verification is different and is left to propagate.
 */
export async function loadSignedOrRedirect(
  jar: CookieJar = requestCookies,
  deps: SignedInDeps = liveDeps(),
): Promise<SignedInView> {
  const view = await loadSignedView(jar, deps);
  if (view === null) throw redirect({ to: "/" });
  return view;
}
