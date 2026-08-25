import type { Principal } from "@lilo-moon/auth";
import type { Access } from "@lilo-moon/auth-tanstack";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { countVisibleRows } from "../src/server/rows.js";
import { buildSignedView, loadSignedOrRedirect } from "../src/server/signed-in.js";
import type { SignedInDeps } from "../src/server/signed-in.js";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

// Sessions, cookies and token verification are `@lilo-moon/auth-session`'s to prove. What is left
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
async function redirectedBy(deps: SignedInDeps): Promise<{ to?: string; search?: unknown }> {
  const thrown: unknown = await loadSignedOrRedirect(deps).then(
    () => null,
    (error: unknown) => error,
  );
  if (!isRedirect(thrown)) throw new Error(`Expected a redirect, got ${String(thrown)}`);
  return thrown.options;
}

describe("buildSignedView", () => {
  // Sign-in has to work before Postgres exists, or the template cannot be run at all until
  // somebody provisions a database.
  it("treats an absent database as a runnable state, not an error", async () => {
    expect(await buildSignedView(principal, null)).toStrictEqual({
      principal,
      rows: null,
      databaseError: null,
    });
  });

  // A database that is down must not hide the Principal. Seeing the claims is exactly what makes
  // the failure diagnosable.
  it("reports a database failure while still showing the verified Principal", async () => {
    const view = await buildSignedView(principal, () =>
      Promise.reject(new Error("connection refused")),
    );
    expect(view.principal).toStrictEqual(principal);
    expect(view.databaseError).toContain("connection refused");
  });

  it("counts rows through the scoped runner, never outside it", async () => {
    let scopedTo: Principal | null = null;
    const view = await buildSignedView(principal, async (given, body) => {
      scopedTo = given;
      return await body({ execute: () => Promise.resolve({ rows: [{ count: 1 }] }) });
    });
    expect(scopedTo).toStrictEqual(principal);
    expect(view.rows).toStrictEqual({ accounts: 1, profiles: 1 });
  });
});

describe("loadSignedOrRedirect", () => {
  it("returns the view when somebody is signed in", async () => {
    expect(await loadSignedOrRedirect(signedIn)).toStrictEqual({
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

describe("countVisibleRows", () => {
  // A count query always returns a row, but reading `rows[0]` without a fallback is exactly the
  // kind of assumption that turns an empty result into a crash rather than a zero.
  it("reads zero rather than failing when the result is empty", async () => {
    const rows = await countVisibleRows(
      async (_principal, body) => await body({ execute: () => Promise.resolve({ rows: [] }) }),
      principal,
    );
    expect(rows).toStrictEqual({ accounts: 0, profiles: 0 });
  });

  it("counts accounts and profiles separately", async () => {
    const seen: string[] = [];
    const rows = await countVisibleRows(
      async (_principal, body) =>
        await body({
          execute: (query) => {
            seen.push(JSON.stringify(query.queryChunks ?? ""));
            return Promise.resolve({ rows: [{ count: seen.length }] });
          },
        }),
      principal,
    );
    expect(rows).toStrictEqual({ accounts: 1, profiles: 2 });
  });
});
