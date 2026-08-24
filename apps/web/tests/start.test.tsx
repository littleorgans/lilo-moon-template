import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../src/router.js";
import { createProbeResponse } from "../src/routes/api.probe.js";

describe("TanStack Start", () => {
  it("constructs the generated route tree", () => {
    const router = getRouter();

    expect(router.routesByPath["/api/probe"]).toBeDefined();
  });

  it("renders the index route through the router", async () => {
    const router = getRouter();
    router.update({ history: createMemoryHistory({ initialEntries: ["/"] }) });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain("Task board");
    expect(html).toContain("Scout baseline");
  });

  it("computes the probe response in the server process", async () => {
    const response = createProbeResponse();
    const body: unknown = await response.json();

    expect(body).toEqual({
      computedAt: expect.any(String),
      doneCount: 2,
      processId: process.pid,
    });
  });
});
