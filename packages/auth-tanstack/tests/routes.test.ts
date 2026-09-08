import { expect, it } from "vitest";

import { postHandlers } from "../src/routes.js";

it("preserves the mutation handler and refuses browser navigation", async () => {
  const handlers = postHandlers(
    async ({ request }: { request: Request }) => new Response(await request.text()),
  );
  const response = await handlers.POST({
    request: new Request("https://example.test", { method: "POST", body: "submitted" }),
  });
  expect(await response.text()).toBe("submitted");
  const refused = handlers.GET();
  expect(refused.status).toBe(405);
  expect(refused.headers.get("allow")).toBe("POST");
});
