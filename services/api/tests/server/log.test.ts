import { afterEach, expect, it, vi } from "vitest";

import { jsonLog } from "../../src/server/log.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

it("writes one timestamped JSON line, errors to stderr and the rest to stdout", () => {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  jsonLog({ level: "info", event: "listening", port: 8787 });
  jsonLog({ level: "error", event: "request_failed", code: "internal" });

  const out = String(stdout.mock.calls[0]?.[0]);
  const err = String(stderr.mock.calls[0]?.[0]);
  expect(stdout.mock.calls).toHaveLength(1);
  expect(stderr.mock.calls).toHaveLength(1);
  expect(out.endsWith("\n")).toBe(true);
  expect(JSON.parse(out)).toStrictEqual({
    time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    level: "info",
    event: "listening",
    port: 8787,
  });
  expect(JSON.parse(err)).toMatchObject({ level: "error", event: "request_failed" });
});
