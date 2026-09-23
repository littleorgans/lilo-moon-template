import { describe, expect, it } from "vitest";

import { refuseCrossOrigin } from "../src/origin.js";

const appUrl = "https://app.example.test/callback";
const post = (headers: Record<string, string>) =>
  new Request("https://app.example.test/api/anything", { method: "POST", headers });

describe("refuseCrossOrigin", () => {
  it("lets a request from the application's own origin through", () => {
    expect(refuseCrossOrigin(post({ origin: "https://app.example.test" }), appUrl)).toBeNull();
  });

  it.each([
    ["another site", "https://evil.example"],
    ["another scheme", "http://app.example.test"],
    ["another port", "https://app.example.test:8443"],
    ["a subdomain", "https://evil.app.example.test"],
    ["an opaque origin", "null"],
  ])("refuses %s with 403", async (_, origin) => {
    const response = refuseCrossOrigin(post({ origin }), appUrl);
    expect(response?.status).toBe(403);
    expect(await response?.text()).toContain("did not come from this application");
  });

  // Sign-out's semantics, kept: a browser sends Origin on every POST, so a missing one is refused
  // even when the fetch metadata or the referer claim the request is same-origin.
  it("refuses a missing Origin whatever else the request claims", () => {
    const response = refuseCrossOrigin(
      post({ "sec-fetch-site": "same-origin", referer: "https://app.example.test/" }),
      appUrl,
    );
    expect(response?.status).toBe(403);
  });

  // The request's own URL is not the reference. Behind a TLS-terminating proxy it can be http: while
  // the browser's Origin is https:, and the configured URL is the one that is right.
  it("compares against the configured URL, not the request's", () => {
    const behindProxy = new Request("http://internal:3000/api/anything", {
      method: "POST",
      headers: { origin: "https://app.example.test" },
    });
    expect(refuseCrossOrigin(behindProxy, appUrl)).toBeNull();
  });
});
