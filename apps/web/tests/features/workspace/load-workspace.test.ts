import type { Principal } from "@littleorgans/auth";
import type { Access } from "@littleorgans/auth-tanstack";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  buildWorkspaceView,
  loadWorkspaceOrRedirect,
} from "../../../src/features/workspace/server/load-workspace.js";
import type { WorkspaceDeps } from "../../../src/features/workspace/server/load-workspace.js";
import { recordingTransaction } from "../../database.js";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

// Sessions, cookies and token verification are `@littleorgans/auth-session`'s to prove. What is left
// here is what this product does once it knows who is calling, and where each state lands.
const accessOf = (access: Access) => ({ access: () => Promise.resolve(access), runScoped: null });
const signedIn = accessOf({ status: "signed-in", principal });

/**
 * Where a loader sent the browser.
 *
 * TanStack's redirect is a Response rather than an Error, so a thrown one is caught rather than
 * awaited, and its destination lives in `options` rather than in a `location` header: the router
 * resolves it into one later. `isRedirect` narrows it, which is what keeps this read cast-free.
 */
async function redirectedBy(deps: WorkspaceDeps): Promise<{ to?: string; search?: unknown }> {
  const thrown: unknown = await loadWorkspaceOrRedirect(deps).then(
    () => null,
    (error: unknown) => error,
  );
  if (!isRedirect(thrown)) throw new Error(`Expected a redirect, got ${String(thrown)}`);
  return thrown.options;
}

describe("buildWorkspaceView", () => {
  // Sign-in has to work before Postgres exists, or the reference app cannot be run at all until
  // somebody provisions a database.
  it("treats an absent database as a runnable state, not an error", async () => {
    expect(await buildWorkspaceView(principal, null)).toStrictEqual({
      principal,
      rows: null,
      databaseError: null,
    });
  });

  // A database that is down must not hide the Principal. Seeing the claims is exactly what makes
  // the failure diagnosable.
  it("reports a database failure while still showing the verified Principal", async () => {
    const view = await buildWorkspaceView(principal, () =>
      Promise.reject(new Error("connection refused")),
    );
    expect(view.principal).toStrictEqual(principal);
    expect(view.databaseError).toContain("temporarily unavailable");
    expect(view.databaseError).not.toContain("connection refused");
  });

  // Provisioning first, in the same transaction, so the counts include the caller's own rows.
  it("provisions and counts through the scoped runner, never outside it", async () => {
    let scopedTo: Principal | null = null;
    const { tx, statements } = recordingTransaction(({ sql }) =>
      sql.startsWith("select count(*)") ? [{ count: 1 }] : [],
    );
    const view = await buildWorkspaceView(principal, async (given, body) => {
      scopedTo = given;
      return await body(tx);
    });
    expect(scopedTo).toStrictEqual(principal);
    expect(view.rows).toStrictEqual({ accounts: 1, profiles: 1 });
    expect(statements.map(({ sql }) => sql)).toStrictEqual([
      expect.stringMatching(/^insert into "accounts"/),
      expect.stringMatching(/^insert into "profiles"/),
      expect.stringMatching(/^select count\(\*\) .* from "accounts"/),
      expect.stringMatching(/^select count\(\*\) .* from "profiles"/),
    ]);
  });
});

describe("loadWorkspaceOrRedirect", () => {
  it("returns the view when somebody is signed in", async () => {
    expect(await loadWorkspaceOrRedirect(signedIn)).toStrictEqual({
      principal,
      rows: null,
      databaseError: null,
    });
  });

  // Not signed in is a person, not a fault, so it redirects rather than raising.
  it("sends somebody with no session to the sign-in page, quietly", async () => {
    expect(await redirectedBy(accessOf({ status: "anonymous" }))).toMatchObject({ to: "/" });
    expect(await redirectedBy(accessOf({ status: "anonymous" }))).not.toHaveProperty("search");
  });

  // The three states that are not a signed-in person must reach three different screens.
  // Collapsing any two is how somebody whose token cannot be read ends up pressing a sign-in
  // button that cannot possibly help them.
  it("marks an ended session so the sign-in page can say so", async () => {
    expect(await redirectedBy(accessOf({ status: "ended" }))).toMatchObject({
      to: "/",
      search: { ended: true },
    });
  });

  it("sends a token we cannot read to its own screen, which has no sign-in button", async () => {
    expect(await redirectedBy(accessOf({ status: "broken" }))).toMatchObject({
      to: "/session-error",
    });
  });
});

it("returns a retryable unavailable response for auth outages", async () => {
  expect(await redirectedBy(accessOf({ status: "unavailable" }))).toMatchObject({
    to: "/session-error",
    search: { retry: true },
  });
});
