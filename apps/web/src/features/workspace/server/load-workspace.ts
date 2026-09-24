import type { Principal } from "@littleorgans/auth";
import type { Access } from "@littleorgans/auth-tanstack";
import { redirect } from "@tanstack/react-router";

import { auth } from "../../../server/auth.js";
import { getDatabase } from "../../../server/database.js";
import type { ScopedRunner } from "../../../server/database.js";
import { ensureIdentityRows } from "../../../server/identity.js";
import type { WorkspaceView } from "../model.js";
import { countVisibleRows } from "./rows.js";

export interface WorkspaceDeps {
  readonly access: () => Promise<Access>;
  /** Null when DATABASE_URL is unset. Narrower than a Database on purpose: a test supplies it. */
  readonly runScoped: ScopedRunner | null;
}

function liveDeps(): WorkspaceDeps {
  const database = getDatabase();
  return {
    access: () => auth.access(),
    // Bound rather than wrapped in an arrow: the arrow would be a function only a live database
    // could ever run, and therefore one no test could reach.
    runScoped: database === null ? null : database.withPrincipal.bind(database),
  };
}

/**
 * Builds the view for a caller who is already known. Exported so a test reaches it directly.
 *
 * `/app` is where every sign-in lands, so this is where the caller's identity rows are provisioned,
 * in the same scoped transaction that then reads them back.
 */
export async function buildWorkspaceView(
  principal: Principal,
  runScoped: ScopedRunner | null,
): Promise<WorkspaceView> {
  if (runScoped === null) return { principal, rows: null, databaseError: null };

  try {
    const rows = await runScoped(principal, async (tx) => {
      await ensureIdentityRows(tx, principal);
      return await countVisibleRows(tx);
    });
    return { principal, rows, databaseError: null };
  } catch (error) {
    console.error("database.query_failed", error);
    return {
      principal,
      rows: null,
      databaseError: "The database is temporarily unavailable. Please retry.",
    };
  }
}

/**
 * The workspace loader maps authentication outcomes to page data or redirects.
 *
 * None of them is an exception. Not being signed in is a person who has not signed in yet; a token
 * that stopped verifying is a session that ended; a token whose shape we cannot read is our
 * outage. Letting any of them propagate would hand the framework an exception to serialise, which
 * is how a failed sign-in once reached a browser as `{"status":400,"message":"HTTPError"}`.
 *
 * The destinations differ on one axis: whether signing in again can possibly help. For `broken` it
 * cannot, so that screen is the only one without a sign-in button.
 */
export async function loadWorkspaceOrRedirect(
  deps: WorkspaceDeps = liveDeps(),
): Promise<WorkspaceView> {
  const access = await deps.access();
  switch (access.status) {
    case "signed-in":
      return await buildWorkspaceView(access.principal, deps.runScoped);
    case "anonymous":
      throw redirect({ to: "/" });
    case "ended":
      throw redirect({ to: "/", search: { ended: true } });
    case "unavailable":
      throw redirect({ to: "/session-error", search: { retry: true } });
    case "broken":
      throw redirect({ to: "/session-error", search: {} });
    default: {
      // Keep this exhaustive when authentication adds an outcome.
      const exhaustive: never = access;
      return exhaustive;
    }
  }
}
