import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createVerifier } from "@littleorgans/auth";
import { Hono } from "hono";
import { afterAll, beforeAll, expect, it } from "vitest";

import { requireAuth } from "../../src/hono.js";
import type { AuthEnv } from "../../src/hono.js";
import type { Rejection } from "../../src/index.js";
import { createSigner, issuer, userId } from "../tokens.js";
import type { Signer } from "../tokens.js";

// The provider's JWKS endpoint, which the test can take down.
let providerUp = false;
let signer: Signer;
const provider = createServer((_request, response) => {
  if (!providerUp) {
    response.writeHead(503).end("maintenance");
    return;
  }
  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ keys: [signer.jwk] }));
});

const rejections: Rejection[] = [];
let service: ServerType;
let origin: string;

async function listening(server: { once(event: "listening", listener: () => void): unknown }) {
  await new Promise<void>((resolve) => server.once("listening", resolve));
}

function portOf(address: string | AddressInfo | null): number {
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  return address.port;
}

async function close(server: { close(callback: (error?: Error) => void): unknown }) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

beforeAll(async () => {
  signer = await createSigner();
  provider.listen(0, "127.0.0.1");
  await listening(provider);

  const verify = createVerifier({
    issuer,
    jwks: { uri: `http://127.0.0.1:${portOf(provider.address())}/jwks` },
  });
  const app = new Hono<AuthEnv>()
    .use(
      requireAuth({
        verify,
        onRejection: (rejection) => {
          rejections.push(rejection);
        },
      }),
    )
    .get("/me", (c) => c.json(c.var.principal));
  service = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await listening(service);
  origin = `http://127.0.0.1:${portOf(service.address())}`;
});

afterAll(async () => {
  await Promise.all([close(service), close(provider)]);
});

async function me(token?: string): Promise<Response> {
  return await fetch(`${origin}/me`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
}

// One sequence because the verifier caches keys: an outage only shows before the first fetch.
it("answers 401, then 503 during a provider outage, then 200 with the Principal", async () => {
  const anonymous = await me();
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("www-authenticate")).toBe("Bearer");
  expect(await anonymous.json()).toStrictEqual({ error: "missing_token" });

  const token = await signer.sign({ claims: { org_id: "org_01M0" } });

  const outage = await me(token);
  expect(outage.status).toBe(503);
  expect(outage.headers.get("www-authenticate")).toBeNull();
  const outageBody = await outage.text();
  expect(outageBody).toBe('{"error":"auth_unavailable"}');
  // The server keeps the reason; the client does not get it.
  expect(rejections.at(-1)?.cause?.reason).toBe("unavailable");

  providerUp = true;
  const signedIn = await me(token);
  expect(signedIn.status).toBe(200);
  expect(await signedIn.json()).toStrictEqual({
    userId,
    orgId: "org_01M0",
    roles: [],
    permissions: [],
    entitlements: [],
  });

  const forged = await me(await (await createSigner()).sign());
  expect(forged.status).toBe(401);
  expect(forged.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
  expect(await forged.json()).toStrictEqual({ error: "invalid_token" });
});

it("rejects mixed duplicate credentials over a real HTTP connection", async () => {
  const received = await new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      const incoming = request(
        `${origin}/me`,
        {
          headers: [
            "Host",
            new URL(origin).host,
            "Authorization",
            "Basic abc",
            "Authorization",
            "Bearer a.b.c",
          ],
          agent: false,
          timeout: 1000,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode, body }));
          response.on("error", reject);
        },
      );
      incoming.on("error", reject);
      incoming.on("timeout", () => incoming.destroy(new Error("request timed out")));
      incoming.end();
    },
  );
  expect(received).toStrictEqual({ status: 401, body: '{"error":"malformed_token"}' });
});
