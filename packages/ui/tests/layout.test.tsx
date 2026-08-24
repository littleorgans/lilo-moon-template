import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Container, Grid, Row, Stack } from "../src/components/layout.js";

describe("layout primitives", () => {
  it("Stack is a column with the requested gap and alignment", () => {
    const markup = renderToStaticMarkup(
      <Stack gap="lg" align="center" justify="between">
        x
      </Stack>,
    );
    expect(markup).toContain("flex-col");
    expect(markup).toContain("gap-6");
    expect(markup).toContain("items-center");
    expect(markup).toContain("justify-between");
  });

  it("Row is a wrapping row, centered by default", () => {
    const markup = renderToStaticMarkup(<Row>x</Row>);
    expect(markup).toContain("flex-row");
    expect(markup).toContain("flex-wrap");
    expect(markup).toContain("items-center");
    expect(markup).toContain("gap-2");
  });

  it("Grid maps the column count to a literal class", () => {
    expect(renderToStaticMarkup(<Grid columns={3}>x</Grid>)).toContain("grid-cols-3");
    expect(renderToStaticMarkup(<Grid>x</Grid>)).toContain("grid-cols-2");
  });

  it("Container centers at the requested width", () => {
    const markup = renderToStaticMarkup(<Container size="sm">x</Container>);
    expect(markup).toContain("mx-auto");
    expect(markup).toContain("max-w-xl");
    expect(renderToStaticMarkup(<Container>x</Container>)).toContain("max-w-3xl");
  });
});
