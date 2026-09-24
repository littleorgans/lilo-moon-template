import { createVerifier } from "@littleorgans/auth";
import { describe, expect, it } from "vitest";

import { startService } from "../../src/server/service.ts";
import type { ServiceDatabase } from "../../src/server/service.ts";
import { createSigner, issuer, recordingLog, recordingTransaction } from "../support.ts";

/**
 * A database whose one transaction waits for the test to release it, recording when the pool is
 * closed relative to everything else.
 */
function heldDatabase(events: string[]) {
  const inside = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const { tx } = recordingTransaction(() => [
    ["0b6f2c1e-5a4d-4b8e-9f10-2c3d4e5f6a7b", "org_A", "2026-09-01T00:00:00.000Z"],
  ]);
  const database: ServiceDatabase = {
    withPrincipal: async (_principal, body) => {
      events.push("transaction");
      inside.resolve();
      await held.promise;
      return await body(tx);
    },
    close: () => {
      events.push("pool closed");
      return Promise.resolve();
    },
  };
  return { database, inside: inside.promise, release: held.resolve };
}

async function setUp(graceMs: number) {
  const signer = await createSigner();
  const events: string[] = [];
  const held = heldDatabase(events);
  const { log } = recordingLog();
  const service = await startService({
    port: 0,
    verify: createVerifier({ issuer, jwks: { keys: [signer.jwk] } }),
    database: held.database,
    log,
    graceMs,
  });
  const origin = `http://127.0.0.1:${service.port}`;
  const token = await signer.sign({ sub: "user_A", org_id: "org_A" });
  const account = () =>
    fetch(`${origin}/v1/account`, {
      headers: { authorization: `Bearer ${token}`, connection: "close" },
      signal: AbortSignal.timeout(5000),
    });
  return { service, origin, events, account, ...held };
}

describe("stop", () => {
  it("refuses new connections, finishes the request in flight, then closes the pool", async () => {
    const { service, origin, events, account, inside, release } = await setUp(5000);

    const inFlight = account();
    await inside;
    const stopped = service.stop();
    expect(service.stop()).toBe(stopped);

    await expect(fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow(
      "fetch failed",
    );
    expect(events).toStrictEqual(["transaction"]);

    release();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orgId: "org_A" });
    await stopped;
    expect(events).toStrictEqual(["transaction", "pool closed"]);
  });

  it("cuts a request that outlives the grace period, and still closes the pool", async () => {
    const { service, events, account, inside } = await setUp(100);

    const inFlight = account();
    await inside;
    await service.stop();

    await expect(inFlight).rejects.toThrow("fetch failed");
    expect(events).toStrictEqual(["transaction", "pool closed"]);
  });
});
