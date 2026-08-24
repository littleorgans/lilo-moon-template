import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "../src/components/badge.js";
import { Input } from "../src/components/input.js";
import { Label } from "../src/components/label.js";

describe("Badge", () => {
  it("renders each variant with its distinguishing class", () => {
    expect(renderToStaticMarkup(<Badge>Free</Badge>)).toContain("bg-primary");
    expect(renderToStaticMarkup(<Badge variant="secondary">S</Badge>)).toContain("bg-secondary");
    expect(renderToStaticMarkup(<Badge variant="outline">O</Badge>)).toContain("border-border");
    expect(renderToStaticMarkup(<Badge variant="destructive">D</Badge>)).toContain(
      "bg-destructive",
    );
  });

  it("asChild renders the child element", () => {
    const markup = renderToStaticMarkup(
      <Badge asChild>
        <a href="/plans">Pro</a>
      </Badge>,
    );
    expect(markup).toContain("<a ");
    expect(markup).not.toContain("<span");
  });
});

describe("Input and Label", () => {
  it("wire together through id and htmlFor", () => {
    const markup = renderToStaticMarkup(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="you@example.com" />
      </>,
    );
    expect(markup).toContain('for="email"');
    expect(markup).toContain('id="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('data-slot="input"');
    expect(markup).toContain('data-slot="label"');
  });
});
