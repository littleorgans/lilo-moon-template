import { describe, expect, it } from "vitest";

import { callbackRoute, signOutRoute, startRoute } from "../src/routes.js";
import type { AuthRuntime } from "../src/runtime.js";

const runtime = {
  services: () => {
    throw new Error("not part of these tests");
  },
  startSignIn: () => new Response(null, { status: 302, headers: { location: "start" } }),
  completeSignIn: () =>
    Promise.resolve(new Response(null, { status: 302, headers: { location: "callback" } })),
  endSession: () => new Response(null, { status: 302, headers: { location: "signout" } }),
  principal: () => Promise.resolve(null),
} satisfies AuthRuntime;

// Each factory must wire its own handler. Three routes that all point at the same function would
// look correct in every other test and send every sign-in to the wrong place.
describe("route options", () => {
  it("wires the start route to startSignIn", () => {
    expect(startRoute(runtime).server.handlers.GET(null).headers.get("location")).toBe("start");
  });

  it("wires the sign-out route to endSession", () => {
    expect(signOutRoute(runtime).server.handlers.GET(null).headers.get("location")).toBe("signout");
  });

  it("wires the callback route to completeSignIn", async () => {
    const response = await callbackRoute(runtime).server.handlers.GET({
      request: new Request("http://localhost:5199/callback"),
    });
    expect(response.headers.get("location")).toBe("callback");
  });
});
