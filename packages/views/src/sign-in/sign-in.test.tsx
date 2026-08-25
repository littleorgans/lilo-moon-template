import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignInPanel } from "./sign-in.js";

const html = renderToStaticMarkup(
  <SignInPanel
    title="Task board"
    description="Sign in to see the tasks your workspace can see."
    oauthStartPath="/api/auth/start"
    emailStartPath="/api/auth/email/start"
  />,
);

describe("the session-ended notice", () => {
  it("is absent on an ordinary visit", () => {
    expect(html).not.toContain("session-ended");
    expect(html).not.toContain("Your session ended");
  });

  it("says the session ended without naming which check failed", () => {
    const ended = renderToStaticMarkup(
      <SignInPanel
        title="Task board"
        description="Sign in to see the tasks your workspace can see."
        oauthStartPath="/api/auth/start"
        emailStartPath="/api/auth/email/start"
        sessionEnded
      />,
    );
    expect(ended).toContain('data-status="session-ended"');
    expect(ended).toContain("Your session ended");
    for (const reason of ["signature", "issuer", "audience", "malformed", "expired"]) {
      expect(ended).not.toContain(reason);
    }
    // Still both ways in: this one is fixed by signing in again, which is the whole difference
    // from the screen a broken token reaches.
    expect(ended).toContain('href="/api/auth/start"');
    expect(ended).toContain('action="/api/auth/email/start"');
  });
});

describe("SignInPanel", () => {
  it("renders the redirect sign-in as an anchor, not a fetch", () => {
    expect(html).toContain('href="/api/auth/start"');
    expect(html).toContain("Continue with Google");
  });

  it("renders the email path as a form posting to the start route", () => {
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/auth/email/start"');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain("required");
  });

  it("shows the product copy it was given", () => {
    expect(html).toContain("Task board");
    expect(html).toContain("workspace can see");
  });
});
