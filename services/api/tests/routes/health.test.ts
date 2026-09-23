import { expect, it } from "vitest";

import { createApp } from "../../src/server/app.ts";
import { recordingLog, recordingRunner } from "../support.ts";

const refuseEverything = () => Promise.reject(new Error("health must not verify a token"));

it("answers without a token, without the verifier, and without the database", async () => {
  const { run, scopedTo } = recordingRunner(() => []);
  const app = createApp({ verify: refuseEverything, run, log: recordingLog().log });

  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toStrictEqual({ status: "ok" });
  expect(scopedTo).toHaveLength(0);
});

it("answers 404 not_found outside the known routes", async () => {
  const app = createApp({
    verify: refuseEverything,
    run: recordingRunner(() => []).run,
    log: recordingLog().log,
  });

  const response = await app.request("/healthz");

  expect(response.status).toBe(404);
  expect(await response.json()).toStrictEqual({ error: "not_found" });
});
