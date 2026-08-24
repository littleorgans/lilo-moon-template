import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Code, CodeBlock, Heading, Text } from "../src/components/text.js";

describe("text primitives", () => {
  it("Heading renders the semantic tag for its level", () => {
    expect(renderToStaticMarkup(<Heading>Top</Heading>)).toContain("<h1");
    expect(renderToStaticMarkup(<Heading level={2}>Mid</Heading>)).toContain("<h2");
    expect(renderToStaticMarkup(<Heading level={3}>Low</Heading>)).toContain("<h3");
  });

  it("Text tones and sizes map to classes", () => {
    expect(renderToStaticMarkup(<Text>Body</Text>)).toContain("text-foreground");
    expect(renderToStaticMarkup(<Text tone="muted">Aside</Text>)).toContain(
      "text-muted-foreground",
    );
    expect(renderToStaticMarkup(<Text size="small">Fine</Text>)).toContain("text-xs");
  });

  it("Code is inline and CodeBlock is a block", () => {
    expect(renderToStaticMarkup(<Code>orgId</Code>)).toContain("<code");
    const block = renderToStaticMarkup(<CodeBlock>{"{ }"}</CodeBlock>);
    expect(block).toContain("<pre");
    expect(block).toContain("overflow-x-auto");
  });
});
