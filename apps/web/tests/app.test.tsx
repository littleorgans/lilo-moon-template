import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";

function sectionList(html: string, heading: string): string {
  const match = html.match(new RegExp(`<section><h2>${heading}</h2><ul>(.*?)</ul></section>`));

  if (!match) {
    throw new Error(`missing <section> for ${heading}`);
  }

  return match[1] ?? "";
}

describe("App", () => {
  it("groups tasks by status using collections", () => {
    const html = renderToStaticMarkup(<App />);
    const done = sectionList(html, "done");
    const todo = sectionList(html, "todo");

    expect(done).toContain("Scout baseline");
    expect(done).toContain("Library exemplar");
    expect(done).not.toContain("Application exemplar");
    expect(todo).toContain("Application exemplar");
    expect(todo).not.toContain("Scout baseline");
    expect(todo).not.toContain("Library exemplar");
  });
});
