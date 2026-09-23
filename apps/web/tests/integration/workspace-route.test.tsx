import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// Exercise route-to-feature composition without a Start request or an external identity provider.
// The production build and consumer HTTP checks verify the actual server boundary separately.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: <T,>(handler: () => T) => handler }),
}));

vi.mock("../../src/features/workspace/server/load-workspace.js", () => ({
  loadWorkspaceOrRedirect: vi.fn(() =>
    Promise.resolve({
      principal: {
        userId: "user_route",
        orgId: null,
        roles: [],
        permissions: [],
        entitlements: [],
      },
      rows: { accounts: 0, profiles: 1 },
      databaseError: null,
    }),
  ),
}));

it("loads the workspace feature and renders its data through /app", async () => {
  const { getRouter } = await import("../../src/router.js");
  const { loadWorkspaceOrRedirect } =
    await import("../../src/features/workspace/server/load-workspace.js");
  const router = getRouter();
  router.update({ history: createMemoryHistory({ initialEntries: ["/app"] }) });
  await router.load();
  const html = renderToStaticMarkup(<RouterProvider router={router} />);
  expect(loadWorkspaceOrRedirect).toHaveBeenCalledOnce();
  expect(html).toContain("user_route");
  expect(html).toContain("profiles: 1");
  expect(html).toContain("No organization");
});
