import { describe, expect, it } from "vitest";

import { createWorkOSAuth } from "../src/provider.js";

const auth = createWorkOSAuth({ apiKey: "test-key", clientId: "client_test" });

describe("provider logout", () => {
  it("uses the SDK logout URL with the session and return destination", () => {
    const url = new URL(
      auth.getLogoutUrl({ sessionId: "session_test", returnTo: "https://app.example/" }),
    );
    expect(url.origin).toBe("https://api.workos.com");
    expect(url.pathname).toBe("/user_management/sessions/logout");
    expect(url.searchParams.get("session_id")).toBe("session_test");
    expect(url.searchParams.get("return_to")).toBe("https://app.example/");
  });
  it("rejects an absent session id", () => {
    expect(() => auth.getLogoutUrl({ sessionId: "", returnTo: "https://app.example/" })).toThrow();
  });
});
