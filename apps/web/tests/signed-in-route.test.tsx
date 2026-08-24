import type { Principal } from "@lilo-moon/auth";
import type * as ReactRouter from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SignedInView } from "../src/server/signed-in.js";

const view: SignedInView = {
  principal: {
    userId: "user_01HBEQ",
    orgId: "org_01M0",
    roles: ["owner"],
    permissions: ["billing:manage"],
    entitlements: [],
  } satisfies Principal,
  rows: { accounts: 1, profiles: 1 },
  databaseError: null,
};

// getRouteApi is mocked rather than a router being stood up: the component's own job is to hand the
// loader's data to the panel, and that is what this asserts. The panel is tested separately with
// no mocking at all.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  getRouteApi: () => ({ useLoaderData: () => view }),
}));

const { SignedInRoute } = await import("../src/components/signed-in-route.js");

describe("SignedInRoute", () => {
  it("renders the panel from the loader's data", () => {
    const html = renderToStaticMarkup(<SignedInRoute />);

    expect(html).toContain("user_01HBEQ");
    expect(html).toContain("accounts: 1");
  });
});
