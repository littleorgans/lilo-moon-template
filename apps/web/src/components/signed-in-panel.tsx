import { getRouteApi } from "@tanstack/react-router";

// Resolved once at module scope: a hook selected off a fresh object on every render is a different
// function each time, which is exactly what the rules of hooks forbid.
const routeApi = getRouteApi("/app");

import { App as TaskBoard } from "../app.js";
import type { SignedInView } from "../server/signed-in.js";

/** Pure on purpose: it takes its data as props so it can be rendered without a router or a session. */
export function SignedInPanel({ principal, rows, databaseError }: SignedInView) {
  return (
    <main>
      <h1>Signed in</h1>

      <h2>Principal</h2>
      <pre>{JSON.stringify(principal, null, 2)}</pre>
      <p>
        <small>
          The whole Principal, verbatim. An empty <code>entitlements</code> list is correct until
          Stripe Connect is configured, and <code>orgId</code> being present is what proves the
          organization was created and the token refreshed afterwards.
        </small>
      </p>

      <h2>Rows visible to this Principal</h2>
      {rows === null ? (
        <p>
          {databaseError === null
            ? "DATABASE_URL is not set, so no scoped transaction ran."
            : `The scoped transaction failed: ${databaseError}`}
        </p>
      ) : (
        <ul>
          <li>accounts: {rows.accounts}</li>
          <li>profiles: {rows.profiles}</li>
        </ul>
      )}

      <h2>The product</h2>
      <TaskBoard />

      <p>
        <a href="/api/auth/signout">Sign out</a>
      </p>
    </main>
  );
}

/**
 * The route's component.
 *
 * Reads the loader's data through `getRouteApi` rather than importing the route, which would be a
 * cycle: the route names this component. Kept separate from the panel so the panel stays pure and
 * can be rendered without a router.
 */
export function SignedInRoute() {
  return <SignedInPanel {...routeApi.useLoaderData()} />;
}
