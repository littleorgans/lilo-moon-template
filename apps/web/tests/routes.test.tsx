import type { Principal } from "@lilo-moon/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignedInPanel } from "../src/components/signed-in-panel.js";
import { countVisibleRows } from "../src/server/rows.js";
import { loadSignedOrRedirect, loadSignedView } from "../src/server/signed-in.js";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["owner"],
  permissions: ["billing:manage"],
  entitlements: [],
};

// Sessions, cookies and token verification are `@lilo-moon/auth-session`'s to prove. What is left
// here is what this product does once it knows who is calling.
const signedIn = { principal: () => Promise.resolve(principal), runScoped: null };
const signedOut = { principal: () => Promise.resolve(null), runScoped: null };

describe("loadSignedView", () => {
  it("returns null when nobody is signed in", async () => {
    expect(await loadSignedView(signedOut)).toBeNull();
  });

  // Sign-in has to work before Postgres exists, or the template cannot be run at all until
  // somebody provisions a database.
  it("treats an absent database as a runnable state, not an error", async () => {
    expect(await loadSignedView(signedIn)).toStrictEqual({
      principal,
      rows: null,
      databaseError: null,
    });
  });

  // A database that is down must not hide the Principal. Seeing the claims is exactly what makes
  // the failure diagnosable.
  it("reports a database failure while still showing the verified Principal", async () => {
    const view = await loadSignedView({
      ...signedIn,
      runScoped: () => Promise.reject(new Error("connection refused")),
    });
    expect(view?.principal).toStrictEqual(principal);
    expect(view?.databaseError).toContain("connection refused");
  });

  it("counts rows through the scoped runner, never outside it", async () => {
    let scopedTo: Principal | null = null;
    const view = await loadSignedView({
      ...signedIn,
      runScoped: async (given, body) => {
        scopedTo = given;
        return await body({ execute: () => Promise.resolve({ rows: [{ count: 1 }] }) });
      },
    });
    expect(scopedTo).toStrictEqual(principal);
    expect(view?.rows).toStrictEqual({ accounts: 1, profiles: 1 });
  });

  // A rejected token is not "no session". It has to reach the caller so an expired token and a
  // forged one do not take the same quiet path.
  it("lets a verification failure escape rather than rendering a page", async () => {
    await expect(
      loadSignedView({ ...signedIn, principal: () => Promise.reject(new Error("expired")) }),
    ).rejects.toThrow("expired");
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

  // Not signed in is a person, not a fault. TanStack's redirect is a Response rather than an Error,
  // which is why this is not a rejects.toThrow.
  it("redirects rather than failing when nobody is signed in", async () => {
    const thrown: unknown = await loadSignedOrRedirect(signedOut).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
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

describe("SignedInPanel", () => {
  it("prints the whole Principal so the claims can be read off the screen", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError={null} />,
    );
    expect(html).toContain("user_01HBEQ");
    expect(html).toContain("org_01M0");
    expect(html).toContain("billing:manage");
  });

  it("says plainly that no transaction ran when there is no database", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError={null} />,
    );
    expect(html).toContain("DATABASE_URL is not set");
  });

  it("shows a database failure rather than hiding it behind an empty count", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError="connection refused" />,
    );
    expect(html).toContain("connection refused");
  });

  it("shows the row counts when the scoped transaction ran", () => {
    const html = renderToStaticMarkup(
      <SignedInPanel
        principal={principal}
        rows={{ accounts: 1, profiles: 1 }}
        databaseError={null}
      />,
    );
    expect(html).toContain("accounts: 1");
    expect(html).toContain("profiles: 1");
  });
});
