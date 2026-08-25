import type { Principal } from "@lilo-moon/auth";
import type { Access } from "@lilo-moon/auth-tanstack";
import type { VisibleRows } from "@lilo-moon/views/signed-in-panel";
import { redirect } from "@tanstack/react-router";

import { auth } from "./auth.js";
import { countVisibleRows } from "./rows.js";
import type { ScopedRunner } from "./rows.js";
import { getDatabase } from "./services.js";

/**
 * Everything the signed-in page shows.
 *
 * Exported because the generated route tree names it: the route carries the loader's return type,
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
  readonly access: () => Promise<Access>;
  /** Null when DATABASE_URL is unset. Narrower than a Database on purpose: this page counts rows. */
  readonly runScoped: ScopedRunner | null;
}

function liveDeps(): SignedInDeps {
  const database = getDatabase();
  return {
    access: () => auth.access(),
    // Bound rather than wrapped in an arrow: the arrow would be a function only a live database
    // could ever run, and therefore one no test could reach.
    runScoped: database === null ? null : database.withPrincipal.bind(database),
  };
}

/** Builds the view for a caller who is already known. Exported so a test reaches it directly. */
export async function buildSignedView(
  principal: Principal,
  runScoped: ScopedRunner | null,
): Promise<SignedInView> {
  if (runScoped === null) return { principal, rows: null, databaseError: null };

  try {
    return { principal, rows: await countVisibleRows(runScoped, principal), databaseError: null };
  } catch (error) {
    return {
      principal,
      rows: null,
      databaseError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The loader the signed-in route runs, and the one place the four access states become screens.
 *
 * None of them is an exception. Not being signed in is a person who has not signed in yet; a token
 * that stopped verifying is a session that ended; a token whose shape we cannot read is our
 * outage. Letting any of them propagate would hand the framework an exception to serialise, which
 * is how a failed sign-in once reached a browser as `{"status":400,"message":"HTTPError"}`.
 *
 * The destinations differ on one axis: whether signing in again can possibly help. For `broken` it
 * cannot, so that screen is the only one without a sign-in button.
 */
export async function loadSignedOrRedirect(deps: SignedInDeps = liveDeps()): Promise<SignedInView> {
  const access = await deps.access();
  switch (access.status) {
    case "signed-in":
      return await buildSignedView(access.principal, deps.runScoped);
    case "anonymous":
      throw redirect({ to: "/" });
    case "ended":
      throw redirect({ to: "/", search: { ended: true } });
    case "broken":
      throw redirect({ to: "/session-error" });
    default: {
      // A fifth access state stops compiling here rather than silently becoming a blank page.
      const exhaustive: never = access;
      return exhaustive;
    }
  }
}
