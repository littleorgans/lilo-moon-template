import { describe, expect, it } from "vitest";

import { ConfigError, loadServiceConfig } from "../src/index.js";
import type { Environment } from "../src/index.js";

const valid = {
  PORT: "8080",
  DATABASE_URL: "postgres://svc@db.internal:5432/app?sslmode=require",
  WORKOS_CLIENT_ID: "client_01M0JSGENAGWJCN0R7JME8JWGM",
} as const;

function problemsFor(env: Environment): readonly string[] {
  try {
    loadServiceConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("Expected the environment to be rejected.");
}

describe("loadServiceConfig", () => {
  it("returns typed values and verifier options derived from the client id", () => {
    expect(loadServiceConfig(valid)).toStrictEqual({
      port: 8080,
      databaseUrl: valid.DATABASE_URL,
      workosClientId: valid.WORKOS_CLIENT_ID,
      verifier: {
        issuer: "https://api.workos.com/user_management/client_01M0JSGENAGWJCN0R7JME8JWGM",
        jwks: { uri: "https://api.workos.com/sso/jwks/client_01M0JSGENAGWJCN0R7JME8JWGM" },
      },
    });
  });

  it("accepts the postgresql:// spelling", () => {
    const databaseUrl = "postgresql://svc@localhost/app";
    expect(loadServiceConfig({ ...valid, DATABASE_URL: databaseUrl }).databaseUrl).toBe(
      databaseUrl,
    );
  });

  // Fail fast, but completely: a deploy that fixes one variable per attempt is a slow deploy.
  it("names every missing variable in one error", () => {
    expect(() => loadServiceConfig({})).toThrow(
      new ConfigError([
        "PORT is missing",
        "DATABASE_URL is missing",
        "WORKOS_CLIENT_ID is missing",
      ]),
    );
  });

  it("treats an empty value as missing", () => {
    expect(problemsFor({ ...valid, PORT: "" })).toStrictEqual(["PORT is missing"]);
  });

  it("names missing and invalid variables together", () => {
    expect(problemsFor({ PORT: "http", DATABASE_URL: valid.DATABASE_URL })).toStrictEqual([
      "PORT must be an integer from 1 to 65535",
      "WORKOS_CLIENT_ID is missing",
    ]);
  });

  it.each(["0", "65536", "80.5", "-1", " 80", "1e3", "999999"])("rejects PORT=%o", (port) => {
    expect(problemsFor({ ...valid, PORT: port })).toStrictEqual([
      "PORT must be an integer from 1 to 65535",
    ]);
  });

  it.each(["client_abc/../evil", "client_", "sk_live_abc", "client_abc?x=1"])(
    "rejects WORKOS_CLIENT_ID=%o before it reaches a URL",
    (clientId) => {
      expect(problemsFor({ ...valid, WORKOS_CLIENT_ID: clientId })).toStrictEqual([
        "WORKOS_CLIENT_ID must look like client_ followed by letters and digits",
      ]);
    },
  );

  // A rejected value is still a secret: both of these carry a password.
  const password = "hunter2-secret";
  it.each([`mysql://svc:${password}@db.internal/app`, `svc:${password}@db.internal/app`])(
    "rejects DATABASE_URL=<non-postgres> without echoing it",
    (databaseUrl) => {
      let message = "";
      try {
        loadServiceConfig({ ...valid, DATABASE_URL: databaseUrl });
      } catch (error) {
        message = error instanceof Error ? `${error.message} ${String(error.stack)}` : "";
      }
      expect(message).toContain("DATABASE_URL must be a postgres:// or postgresql:// URL");
      expect(message).not.toContain(password);
      expect(message).not.toContain("db.internal");
    },
  );
});
