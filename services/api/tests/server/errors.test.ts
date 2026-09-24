import { DrizzleQueryError } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { handleError, isUnavailable } from "../../src/server/errors.ts";
import { recordingLog } from "../support.ts";

const withCode = (code: unknown) => Object.assign(new Error("boom"), { code });

describe("isUnavailable", () => {
  it.each(["ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "57P01", "57P03", "53300", "08006", "08001"])(
    "is true for %s",
    (code) => {
      expect(isUnavailable(withCode(code))).toBe(true);
    },
  );

  it.each([
    ["a missing grant", withCode("42501")],
    ["a unique violation", withCode("23505")],
    ["an unlisted errno", withCode("EACCES")],
    ["a numeric code", withCode(8006)],
    ["no code", new Error("boom")],
    ["a string", "ECONNREFUSED"],
    ["null", null],
  ])("is false for %s", (_, error) => {
    expect(isUnavailable(error)).toBe(false);
  });

  // Every query error reaches the handler this way, so a code read only from the top would miss all
  // of them.
  it("reads the driver's code through Drizzle's query error", () => {
    const failed = (code: string) => new DrizzleQueryError("select 1", [], withCode(code));
    expect(isUnavailable(failed("57P01"))).toBe(true);
    expect(isUnavailable(failed("23505"))).toBe(false);
  });
});

describe("handleError", () => {
  it("keeps the response a Hono HTTPException was built with", async () => {
    const { log, records } = recordingLog();
    const app = new Hono()
      .get("/", () => {
        throw new HTTPException(413, { message: "too large" });
      })
      .onError(handleError(log));

    const response = await app.request("/");

    expect(response.status).toBe(413);
    expect(records).toHaveLength(0);
  });

  it("logs only a code of a fixed format, never an arbitrary one", async () => {
    const { log, records } = recordingLog();
    const app = new Hono()
      .get("/", () => {
        throw withCode("token=eyJhbGciOi");
      })
      .onError(handleError(log));

    expect((await app.request("/")).status).toBe(500);
    expect(records).toStrictEqual([
      { level: "error", event: "request_failed", requestId: null, code: "internal", cause: null },
    ]);
  });
});
