import type { Principal } from "@littleorgans/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspacePage } from "../../../src/features/workspace/workspace-page.js";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["owner"],
  permissions: ["billing:manage"],
  entitlements: [],
};

describe("WorkspacePage", () => {
  it("names the user and organization without dumping the rest of the Principal", () => {
    const html = renderToStaticMarkup(
      <WorkspacePage principal={principal} rows={null} databaseError={null} />,
    );
    expect(html).toContain("user_01HBEQ");
    expect(html).toContain("org_01M0");
    expect(html).not.toContain("billing:manage");
    expect(html).not.toContain("owner");
  });

  it("says so when the session has no organization", () => {
    const html = renderToStaticMarkup(
      <WorkspacePage principal={{ ...principal, orgId: null }} rows={null} databaseError={null} />,
    );
    expect(html).toContain("No organization");
  });

  it("says plainly that no transaction ran when there is no database", () => {
    const html = renderToStaticMarkup(
      <WorkspacePage principal={principal} rows={null} databaseError={null} />,
    );
    expect(html).toContain("DATABASE_URL is not set");
  });

  it("shows a database failure rather than hiding it behind an empty count", () => {
    const html = renderToStaticMarkup(
      <WorkspacePage principal={principal} rows={null} databaseError="connection refused" />,
    );
    expect(html).toContain("connection refused");
  });

  it("shows the row counts when the scoped transaction ran", () => {
    const html = renderToStaticMarkup(
      <WorkspacePage
        principal={principal}
        rows={{ accounts: 1, profiles: 1 }}
        databaseError={null}
      />,
    );
    expect(html).toContain("accounts: 1");
    expect(html).toContain("profiles: 1");
  });
});

it("posts signout through a form instead of a navigation link", () => {
  const html = renderToStaticMarkup(
    <WorkspacePage principal={principal} rows={null} databaseError={null} />,
  );
  expect(html).toMatch(/<form[^>]*action="\/api\/auth\/signout"[^>]*method="post"/);
  expect(html).toContain('type="submit"');
  expect(html).not.toContain('href="/api/auth/signout"');
});
