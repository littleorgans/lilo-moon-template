import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskBoard } from "../src/components/task-board.js";

// Cards render in status order as siblings, so the chunk between one data-status marker and the
// next is that status's card.
function statusCard(html: string, status: string): string {
  const chunks = html.split('data-status="');
  const chunk = chunks.find((candidate) => candidate.startsWith(`${status}"`));
  if (chunk === undefined) {
    throw new Error(`missing card for ${status}`);
  }
  return chunk;
}

describe("TaskBoard", () => {
  it("groups tasks by status using collections", () => {
    const html = renderToStaticMarkup(<TaskBoard />);
    const done = statusCard(html, "done");
    const todo = statusCard(html, "todo");

    expect(done).toContain("Scout baseline");
    expect(done).toContain("Library exemplar");
    expect(done).not.toContain("Application exemplar");
    expect(todo).toContain("Application exemplar");
    expect(todo).not.toContain("Scout baseline");
    expect(todo).not.toContain("Library exemplar");
  });

  it("badges distinguish done from todo", () => {
    const html = renderToStaticMarkup(<TaskBoard />);
    expect(statusCard(html, "done")).toContain("bg-secondary");
    expect(statusCard(html, "todo")).toContain("border-border");
  });
});
