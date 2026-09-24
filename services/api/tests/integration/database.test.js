// The whole path a deployment takes: the migrations and grant shipped in @littleorgans/db, applied
// with psql as the README says; a fresh login role holding only that grant; the service composed
// by startService and listening on a socket; tokens signed by a test key and verified through a
// JWKS endpoint, as auth-http's own integration test does.

import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { createVerifier } from "@littleorgans/auth";
import { dockerIsAvailable, psqlInput, withPostgres } from "@littleorgans/db-tools";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/server/database.ts";
import { startService } from "../../src/server/service.ts";
import { createSigner, issuer, recordingLog } from "../support.ts";

const require = createRequire(import.meta.url);
const migrations = dirname(require.resolve("@littleorgans/db/migrations/atlas.sum"));
const grant = require.resolve("@littleorgans/db/grants/login-role.sql");

// Everything a consumer runs once, as the migration owner, before the service first starts.
function provision(databaseUrl, role, password) {
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    psqlInput(databaseUrl, readFileSync(join(migrations, file)));
  }
  psqlInput(databaseUrl, `CREATE ROLE :"role" LOGIN PASSWORD :'password';`, { role, password });
  psqlInput(databaseUrl, readFileSync(grant), { login_role: role });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

// Skipped without Docker, like root:rls-verify and packages/db. CI is authoritative.
describe.skipIf(!dockerIsAvailable())("the service against Postgres", () => {
  it("authenticates, and each organization reads and creates only its own account", async () => {
    const signer = await createSigner();
    const jwks = createServer((_request, response) => {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ keys: [signer.jwk] }));
    });
    const jwksOrigin = await listen(jwks);

    await withPostgres("api-test", async (databaseUrl) => {
      // Roles are cluster-wide, so the pid keeps concurrent runs apart.
      const role = `api_login_${process.pid}`;
      const password = randomBytes(16).toString("hex");
      const loginUrl = new URL(databaseUrl);
      loginUrl.username = role;
      loginUrl.password = password;

      const { log, records } = recordingLog();
      let service;
      try {
        provision(databaseUrl, role, password);
        service = await startService({
          port: 0,
          verify: createVerifier({ issuer, jwks: { uri: `${jwksOrigin}/jwks` } }),
          database: openDatabase(loginUrl.href),
          log,
        });
        const origin = `http://127.0.0.1:${service.port}`;
        const call = async (method, token) => {
          const response = await fetch(`${origin}/v1/account`, {
            method,
            headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          });
          return { status: response.status, body: await response.json() };
        };
        const alice = await signer.sign({ sub: "user_alice", org_id: "org_alpha" });
        const bob = await signer.sign({ sub: "user_bob", org_id: "org_beta" });

        expect((await fetch(`${origin}/health`)).status).toBe(200);
        expect(await call("GET")).toStrictEqual({ status: 401, body: { error: "missing_token" } });
        const forged = await (await createSigner()).sign({ sub: "user_eve", org_id: "org_alpha" });
        expect(await call("GET", forged)).toStrictEqual({
          status: 401,
          body: { error: "invalid_token" },
        });

        // Alpha creates its account; creating it again returns the same row.
        expect(await call("GET", alice)).toStrictEqual({
          status: 404,
          body: { error: "account_not_found" },
        });
        const created = await call("PUT", alice);
        expect(created).toMatchObject({ status: 201, body: { orgId: "org_alpha" } });
        expect(created.body.createdAt).toBe(new Date(created.body.createdAt).toISOString());
        expect(await call("PUT", alice)).toStrictEqual({ status: 200, body: created.body });
        expect(await call("GET", alice)).toStrictEqual({ status: 200, body: created.body });

        // Alpha's row exists, and the query has no WHERE clause: only the policy hides it from
        // Beta. Beta's own account is a different row, and Alpha still sees only its own.
        expect(await call("GET", bob)).toStrictEqual({
          status: 404,
          body: { error: "account_not_found" },
        });
        const beta = await call("PUT", bob);
        expect(beta).toMatchObject({ status: 201, body: { orgId: "org_beta" } });
        expect(beta.body.id).not.toBe(created.body.id);
        expect(await call("GET", bob)).toStrictEqual({ status: 200, body: beta.body });
        expect(await call("GET", alice)).toStrictEqual({ status: 200, body: created.body });

        // A verified token without an organization never reaches the database.
        const orgless = await signer.sign({ sub: "user_carol" });
        expect(await call("PUT", orgless)).toStrictEqual({
          status: 403,
          body: { error: "forbidden" },
        });

        const written = JSON.stringify(records);
        for (const secret of [alice, bob, forged, orgless, password]) {
          expect(written).not.toContain(secret);
        }
      } finally {
        await service?.stop();
        psqlInput(databaseUrl, `DROP ROLE IF EXISTS :"role";`, { role });
      }
    });
    jwks.close();
  }, 60_000);
});
