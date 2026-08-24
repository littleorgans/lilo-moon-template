import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "../src/components/button.js";

describe("Button", () => {
  it("renders each variant with its distinguishing class", () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain("bg-primary");
    expect(renderToStaticMarkup(<Button variant="destructive">Go</Button>)).toContain(
      "bg-destructive",
    );
    expect(renderToStaticMarkup(<Button variant="outline">Go</Button>)).toContain("bg-background");
    expect(renderToStaticMarkup(<Button variant="secondary">Go</Button>)).toContain("bg-secondary");
    expect(renderToStaticMarkup(<Button variant="ghost">Go</Button>)).toContain("hover:bg-accent");
    expect(renderToStaticMarkup(<Button variant="link">Go</Button>)).toContain(
      "underline-offset-4",
    );
  });

  it("sizes change the height class", () => {
    expect(renderToStaticMarkup(<Button size="sm">Go</Button>)).toContain("h-8");
    expect(renderToStaticMarkup(<Button size="lg">Go</Button>)).toContain("h-10");
    expect(renderToStaticMarkup(<Button size="icon">Go</Button>)).toContain("size-9");
  });

  // Sign-in and sign-out are top-level navigations, so the app renders them as anchors that look
  // like buttons. asChild is the mechanism, which makes it part of this package's contract.
  it("asChild renders the child element with button classes", () => {
    const markup = renderToStaticMarkup(
      <Button asChild variant="outline">
        <a href="/api/auth/start">Continue</a>
      </Button>,
    );
    expect(markup).toContain("<a ");
    expect(markup).toContain('href="/api/auth/start"');
    expect(markup).toContain("bg-background");
    expect(markup).not.toContain("<button");
  });

  it("buttonVariants is usable directly for class composition", () => {
    expect(buttonVariants({ variant: "secondary" })).toContain("bg-secondary");
  });
});
