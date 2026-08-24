import type { Principal } from "@lilo-moon/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignedInPanel } from "./signed-in-panel.js";

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["owner"],
  permissions: ["billing:manage"],
  entitlements: [],
};

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

  it("renders the product slot under its heading only when given children", () => {
    const bare = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError={null} />,
    );
    expect(bare).not.toContain("The product");

    const withProduct = renderToStaticMarkup(
      <SignedInPanel principal={principal} rows={null} databaseError={null}>
        <p>the board</p>
      </SignedInPanel>,
    );
    expect(withProduct).toContain("The product");
    expect(withProduct).toContain("the board");
  });
});
