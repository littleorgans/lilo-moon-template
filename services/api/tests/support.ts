import type { Principal } from "@littleorgans/auth";
import * as schema from "@littleorgans/drizzle-schema";
import { drizzle } from "drizzle-orm/pg-proxy";
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
 * A real Drizzle database over the generated schema, with `respond` as its driver, so the queries
 * under test are the ones production runs. Records every statement and answers it from `respond`,
 * which returns rows as the driver would: arrays of column values in select order for a select
 * list or RETURNING.
 */
export function recordingTransaction(respond: (text: string) => readonly unknown[]): {
  tx: AccountTransaction;
  statements: string[];
} {
  const statements: string[] = [];
  const tx = drizzle(
    (text) => {
      statements.push(text);
      return Promise.resolve({ rows: [...respond(text)] });
    },
    { schema },
  );
  return { tx, statements };
}

/**
 * Stands in for `database.withPrincipal`: records which Principal each transaction was scoped to
 * and answers every statement from `respond`, in order.
 */
export function recordingRunner(respond: (text: string) => readonly unknown[]): {
  run: ScopedRunner;
  scopedTo: Principal[];
  statements: string[];
} {
  const scopedTo: Principal[] = [];
  const { tx, statements } = recordingTransaction(respond);
  return {
    scopedTo,
    statements,
    run: async (principal, body) => {
      scopedTo.push(principal);
      return await body(tx);
    },
  };
}
