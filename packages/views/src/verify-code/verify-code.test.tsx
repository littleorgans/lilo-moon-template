import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VerifyCodePanel } from "./verify-code.js";

const render = (retry: boolean) =>
  renderToStaticMarkup(
    <VerifyCodePanel verifyPath="/api/auth/email/verify" startOverPath="/" retry={retry} />,
  );

describe("VerifyCodePanel", () => {
  it("posts the code to the verify route with one-time-code semantics", () => {
    const html = render(false);
    expect(html).toContain('action="/api/auth/email/verify"');
    expect(html).toContain('name="code"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
  });

  it("never echoes an email address into the page", () => {
    expect(render(false)).not.toContain("@");
  });

  it("says so when the previous code was refused, and only then", () => {
    expect(render(false)).not.toContain("did not work");
    const retry = render(true);
    expect(retry).toContain("did not work");
    expect(retry).toContain('data-status="retry"');
  });

  it("offers the way back to a fresh start", () => {
    const html = render(false);
    expect(html).toContain('href="/"');
    expect(html).toContain("Use a different address");
  });
});
