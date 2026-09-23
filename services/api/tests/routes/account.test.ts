import { AuthError, createVerifier } from "@littleorgans/auth";
import type { Verifier } from "@littleorgans/auth";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app.ts";
import { createSigner, issuer, recordingLog, recordingRunner } from "../support.ts";
import type { Signer } from "../support.ts";

const account = {
  id: "0b6f2c1e-5a4d-4b8e-9f10-2c3d4e5f6a7b",
  workos_org_id: "org_A",
  created_at: "2026-09-01T00:00:00.000Z",
};

let signer: Signer;
let verify: Verifier;
beforeAll(async () => {
  signer = await createSigner();
  verify = createVerifier({ issuer, jwks: { keys: [signer.jwk] } });
});

function appWith(
  respond: (text: string) => readonly Record<string, unknown>[],
  verifier: Verifier = verify,
) {
  const runner = recordingRunner(respond);
  const logged = recordingLog();
  const app = createApp({ verify: verifier, run: runner.run, log: logged.log });
  return { app, ...runner, ...logged };
}

const down: Verifier = () =>
  Promise.reject(new AuthError("unavailable", "JWKS fetch failed: ECONNREFUSED"));

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("GET /v1/account", () => {
  it("answers the caller's account from a transaction scoped to their verified Principal", async () => {
    const { app, scopedTo, statements } = appWith(() => [account]);
    const token = await signer.sign({ sub: "user_A", org_id: "org_A" });

    const response = await app.request("/v1/account", bearer(token));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({
      id: account.id,
      orgId: "org_A",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect(scopedTo).toStrictEqual([
      { userId: "user_A", orgId: "org_A", roles: [], permissions: [], entitlements: [] },
    ]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT id::text, workos_org_id,[^]* FROM accounts$/);
  });

  it("is 404 account_not_found when the organization has no account yet", async () => {
    const { app } = appWith(() => []);
    const response = await app.request(
      "/v1/account",
      bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: "account_not_found" });
  });
});

describe("PUT /v1/account", () => {
  it("is 201 when it creates the account, taking the organization from the claims", async () => {
    const { app, statements } = appWith(() => [account]);
    const response = await app.request("/v1/account", {
      method: "PUT",
      ...bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: account.id, orgId: "org_A" });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("VALUES (app.current_org_id())");
  });

  it("is 200 with the existing account when it already exists", async () => {
    const { app, statements } = appWith((text) => (text.startsWith("INSERT") ? [] : [account]));
    const response = await app.request("/v1/account", {
      method: "PUT",
      ...bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: account.id });
    expect(statements).toHaveLength(2);
  });
});

// The guards run before any handler, so a refused request never opens a transaction.
describe("tenant authentication", () => {
  it.each([
    ["no Authorization header", {}, 401, "missing_token", "Bearer"],
    [
      "a malformed header",
      { headers: { authorization: "Bearer a b" } },
      401,
      "malformed_token",
      'Bearer error="invalid_token"',
    ],
  ])("refuses %s", async (_, init, status, error, challenge) => {
    const { app, scopedTo } = appWith(() => [account]);
    const response = await app.request("/v1/account", init);

    expect(response.status).toBe(status);
    expect(response.headers.get("www-authenticate")).toBe(challenge);
    expect(await response.json()).toStrictEqual({ error });
    expect(scopedTo).toHaveLength(0);
  });

  it("refuses a token signed by another key as invalid_token", async () => {
    const { app, scopedTo, records } = appWith(() => [account]);
    const forged = await (await createSigner()).sign({ sub: "user_A", org_id: "org_A" });

    const response = await app.request("/v1/account", bearer(forged));

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({ error: "invalid_token" });
    expect(scopedTo).toHaveLength(0);
    expect(records.find((record) => record.event === "auth_rejected")).toMatchObject({
      level: "info",
      code: "invalid_token",
      reason: "signature",
    });
  });

  it("forbids a verified token that carries no organization", async () => {
    const { app, scopedTo } = appWith(() => [account]);
    const response = await app.request("/v1/account", bearer(await signer.sign({ sub: "user_A" })));

    expect(response.status).toBe(403);
    expect(await response.json()).toStrictEqual({ error: "forbidden" });
    expect(scopedTo).toHaveLength(0);
  });

  it("authenticates every /v1 path, including one with no route", async () => {
    const { app } = appWith(() => []);
    expect((await app.request("/v1/elsewhere")).status).toBe(401);
    const token = await signer.sign({ sub: "user_A", org_id: "org_A" });
    const known = await app.request("/v1/elsewhere", bearer(token));
    expect(known.status).toBe(404);
    expect(await known.json()).toStrictEqual({ error: "not_found" });
  });

  it("answers 503 and logs an error when the provider is down", async () => {
    const { app, records } = appWith(() => [account], down);

    const response = await app.request("/v1/account?next=%2Fsecret", bearer("a.b.c"));

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ error: "auth_unavailable" });
    const rejected = records.find((record) => record.event === "auth_rejected");
    expect(rejected).toStrictEqual({
      level: "error",
      event: "auth_rejected",
      requestId: response.headers.get("x-request-id"),
      code: "auth_unavailable",
      reason: "unavailable",
      method: "GET",
      path: "/v1/account",
    });
  });
});

// The rejection event carries the raw request. What reaches the log must be chosen fields only.
describe("logging", () => {
  it("never writes the token, the query string or the verifier's message", async () => {
    const { app, records } = appWith(() => [account]);
    const token = await signer.sign({ sub: "user_A", org_id: "org_A" });
    const forged = await (await createSigner()).sign({ sub: "user_A", org_id: "org_A" });

    await app.request("/v1/account?access_token=leaked", bearer(token));
    await app.request("/v1/account?access_token=leaked", bearer(forged));

    const written = JSON.stringify(records);
    expect(records.map((record) => record.event)).toStrictEqual([
      "request",
      "auth_rejected",
      "request",
    ]);
    for (const secret of [token, forged, "leaked", "signature verification failed"]) {
      expect(written).not.toContain(secret);
    }
  });

  it("correlates the rejection with the request line and the response header", async () => {
    const { app, records } = appWith(() => []);
    const response = await app.request("/v1/account");
    const id = response.headers.get("x-request-id");

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(records.map((record) => [record.event, record["requestId"]])).toStrictEqual([
      ["auth_rejected", id],
      ["request", id],
    ]);
    expect(records.at(-1)).toMatchObject({ method: "GET", path: "/v1/account", status: 401 });
  });
});

describe("errors", () => {
  it("answers 500 internal without the error's message when a query fails", async () => {
    const { app, records } = appWith(() => {
      throw Object.assign(new Error("duplicate key value (workos_org_id)=(org_A)"), {
        code: "23505",
      });
    });
    const response = await app.request(
      "/v1/account",
      bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({ error: "internal" });
    expect(records.find((record) => record.event === "request_failed")).toStrictEqual({
      level: "error",
      event: "request_failed",
      requestId: response.headers.get("x-request-id"),
      code: "internal",
      cause: "23505",
    });
    expect(JSON.stringify(records)).not.toContain("org_A)");
  });

  it("answers 503 unavailable when the database cannot be reached", async () => {
    const { app } = appWith(() => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      });
    });
    const response = await app.request(
      "/v1/account",
      bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ error: "unavailable" });
  });

  // ON CONFLICT DO NOTHING then an empty SELECT means a row exists that the policy hides. Returning
  // anything but an error would hand the caller an account that is not theirs, or none at all.
  it("answers 500 when the insert conflicts with a row the caller cannot see", async () => {
    const { app } = appWith(() => []);
    const response = await app.request("/v1/account", {
      method: "PUT",
      ...bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    });
    expect(response.status).toBe(500);
  });

  it("answers 500 when a row comes back in a shape the query did not ask for", async () => {
    const { app } = appWith(() => [{ ...account, created_at: null }]);
    const response = await app.request(
      "/v1/account",
      bearer(await signer.sign({ sub: "user_A", org_id: "org_A" })),
    );
    expect(response.status).toBe(500);
  });
});
