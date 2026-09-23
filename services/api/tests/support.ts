import type { Principal } from "@littleorgans/auth";
import { PgDialect } from "drizzle-orm/pg-core";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { JWK } from "jose";

import type { AccountTransaction, ScopedRunner } from "../src/features/accounts/account.ts";
import type { Log, LogRecord } from "../src/server/log.ts";

export const issuer = "https://issuer.example/user_management/client_TEST";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

export interface Signer {
  /** The public half, as a JWKS entry. */
  readonly jwk: JWK;
  sign(claims: { readonly sub: string; readonly org_id?: string }): Promise<string>;
}

/** A fresh ES256 key pair that signs access tokens for `issuer`, as the provider would. */
export async function createSigner(): Promise<Signer> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const key: PrivateKey = pair.privateKey;
  return {
    jwk: { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "ES256" },
    async sign(claims) {
      return await new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: "test-key" })
        .setIssuedAt()
        .setIssuer(issuer)
        .setExpirationTime("5m")
        .sign(key);
    },
  };
}

/** A log that keeps its records, so a test can read what the service would have written. */
export function recordingLog(): { log: Log; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { records, log: (record) => records.push(record) };
}

/**
 * Stands in for `database.withPrincipal`: records which Principal each transaction was scoped to
 * and answers every statement from `respond`, in order.
 */
export function recordingRunner(respond: (text: string) => readonly Record<string, unknown>[]): {
  run: ScopedRunner;
  scopedTo: Principal[];
  statements: string[];
} {
  const dialect = new PgDialect();
  const scopedTo: Principal[] = [];
  const statements: string[] = [];
  const tx: AccountTransaction = {
    execute: (query) => {
      const text = dialect.sqlToQuery(query).sql;
      statements.push(text);
      return Promise.resolve({ rows: respond(text) });
    },
  };
  return {
    scopedTo,
    statements,
    run: async (principal, body) => {
      scopedTo.push(principal);
      return await body(tx);
    },
  };
}
