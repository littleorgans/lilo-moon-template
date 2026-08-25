import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionErrorPanel } from "./session-error.js";

describe("SessionErrorPanel", () => {
  // The whole point of this screen. Every other verification failure is fixed by signing in again;
  // this one is not, so offering the control would invite pressing it forever.
  it("offers no way to sign in again", () => {
    const html = renderToStaticMarkup(<SessionErrorPanel />);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("/api/auth/");
    expect(html).not.toContain("Sign in");
  });

  it("says the problem is ours and that it was recorded", () => {
    const html = renderToStaticMarkup(<SessionErrorPanel />);
    expect(html).toContain("wrong on our side");
    expect(html).toContain("recorded");
  });

  // No message may name the failed check: a token can fail its signature because somebody minted
  // one, and naming the check tells them which knob to turn.
  it("names no verification reason", () => {
    const html = renderToStaticMarkup(<SessionErrorPanel supportHint="quote the time" />);
    for (const reason of ["signature", "issuer", "audience", "malformed", "claims", "expired"]) {
      expect(html).not.toContain(reason);
    }
  });

  it("shows a support hint only when given one", () => {
    expect(renderToStaticMarkup(<SessionErrorPanel />)).not.toContain("support-hint");
    expect(renderToStaticMarkup(<SessionErrorPanel supportHint="quote the time" />)).toContain(
      "quote the time",
    );
  });
});
