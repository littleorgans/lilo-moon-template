import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";

describe("App", () => {
  it("groups tasks by status using collections", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("<h2>done</h2>");
    expect(html).toContain("<h2>todo</h2>");
    expect(html).toContain("Scout baseline");
    expect(html).toContain("Library exemplar");
    expect(html).toContain("Application exemplar");
  });
});
