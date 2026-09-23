import { AuthError, createVerifier } from "@littleorgans/auth";
import type { AuthFailure, Principal, Verifier } from "@littleorgans/auth";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createAuthenticator, rejectionResponse } from "../src/index.js";
import type { Authentication, Rejection, RejectionCode } from "../src/index.js";
import { createSigner, issuer, userId } from "./tokens.js";
import type { Signer } from "./tokens.js";

const principal: Principal = {
  userId,
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

// A verifier that must never be reached: the header alone decides these cases.
const unreachable: Verifier = async () => {
  throw new Error("The verifier must not run for this request.");
};

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://service.example/things", { headers });
}

function rejectionOf(result: Authentication): Rejection {
  if (result.ok) throw new Error("Expected a rejection, but the request authenticated.");
  return result.rejection;
}

async function codeFor(verify: Verifier, authorization?: string): Promise<RejectionCode> {
  return rejectionOf(await createAuthenticator({ verify })(request(authorization))).code;
}

describe("bearer extraction", () => {
  it("rejects a request without an Authorization header as missing_token", async () => {
    expect(await codeFor(unreachable)).toBe("missing_token");
  });

  // Another scheme is not a bearer credential, so the answer is the plain Bearer challenge.
  it("treats a different scheme as a missing bearer token", async () => {
    expect(await codeFor(unreachable, "Basic dXNlcjpwYXNz")).toBe("missing_token");
  });

  it.each([
    ["no token after the scheme", "Bearer"],
    ["a token with a space in it", "Bearer abc def"],
    ["a token outside the token68 alphabet", "Bearer abc!def"],
  ])("rejects %s as malformed_token", async (_case, authorization) => {
    expect(await codeFor(unreachable, authorization)).toBe("malformed_token");
  });

  // Choosing either token would let a proxy's header and the caller's disagree about identity.
  it("rejects two Authorization headers as malformed_token", async () => {
    const headers = new Headers();
    headers.append("authorization", "Bearer a.b.c");
    headers.append("authorization", "Bearer d.e.f");
    const incoming = new Request("https://service.example/things", { headers });
    const result = await createAuthenticator({ verify: unreachable })(incoming);
    expect(rejectionOf(result).code).toBe("malformed_token");
  });

  it("hands the verifier exactly the token, with a case-insensitive scheme", async () => {
    const verify = vi.fn<Verifier>(async () => principal);
    const result = await createAuthenticator({ verify })(request("bEaReR   a.b-c_d~e+f/g=="));
    expect(result).toStrictEqual({ ok: true, principal });
    expect(verify).toHaveBeenCalledExactlyOnceWith("a.b-c_d~e+f/g==");
  });
});

describe("verification failures", () => {
  // The contract table: every AuthFailure the verifier can report, and the code a client sees.
  it.each<[AuthFailure, RejectionCode]>([
    ["malformed", "malformed_token"],
    ["expired", "expired_token"],
    ["signature", "invalid_token"],
    ["issuer", "invalid_token"],
    ["audience", "invalid_token"],
    ["claims", "invalid_token"],
    ["unavailable", "auth_unavailable"],
  ])("maps %s to %s and keeps the cause for logs", async (reason, code) => {
    const cause = new AuthError(reason, "internal detail");
    const verify: Verifier = async () => {
      throw cause;
    };
    const rejection = rejectionOf(await createAuthenticator({ verify })(request("Bearer a.b.c")));
    expect(rejection).toStrictEqual({ code });
    expect(rejection.cause).toBe(cause);
  });

  // Not an AuthError means a bug in our code, which must surface as a 500, never as a 401.
  it("lets an unexpected error propagate instead of calling it a bad token", async () => {
    const bug = new TypeError("undefined is not a function");
    const verify: Verifier = async () => {
      throw bug;
    };
    await expect(createAuthenticator({ verify })(request("Bearer a.b.c"))).rejects.toBe(bug);
  });
});

describe("with a real verifier", () => {
  let signer: Signer;
  let other: Signer;
  let verify: Verifier;

  beforeAll(async () => {
    signer = await createSigner();
    other = await createSigner();
    verify = createVerifier({ jwks: { keys: [signer.jwk] }, issuer });
  });

  it("yields the Principal for a token the issuer signed", async () => {
    const token = await signer.sign({ claims: { org_id: "org_01M0", roles: ["admin"] } });
    const result = await createAuthenticator({ verify })(request(`Bearer ${token}`));
    expect(result).toStrictEqual({
      ok: true,
      principal: { userId, orgId: "org_01M0", roles: ["admin"], permissions: [], entitlements: [] },
    });
  });

  it("reports an expired token as expired_token, so the client can refresh", async () => {
    expect(await codeFor(verify, `Bearer ${await signer.sign({ expiresIn: "-1m" })}`)).toBe(
      "expired_token",
    );
  });

  it("reports a forged token as invalid_token", async () => {
    expect(await codeFor(verify, `Bearer ${await other.sign()}`)).toBe("invalid_token");
  });

  it("reports a bearer value that is not a JWT as malformed_token", async () => {
    expect(await codeFor(verify, "Bearer not-a-jwt")).toBe("malformed_token");
  });
});

describe("authorization", () => {
  const verify: Verifier = async () => principal;

  it("answers forbidden when the hook refuses an authenticated caller", async () => {
    const authorize = vi.fn(() => false);
    const incoming = request("Bearer a.b.c");
    const result = await createAuthenticator({ verify, authorize })(incoming);
    expect(rejectionOf(result)).toStrictEqual({ code: "forbidden" });
    expect(authorize).toHaveBeenCalledExactlyOnceWith(principal, incoming);
  });

  it("admits the caller when an async hook allows it", async () => {
    const result = await createAuthenticator({ verify, authorize: async () => true })(
      request("Bearer a.b.c"),
    );
    expect(result).toStrictEqual({ ok: true, principal });
  });

  it("does not consult the hook for an unauthenticated request", async () => {
    const authorize = vi.fn(() => true);
    await createAuthenticator({ verify, authorize })(request());
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("onRejection", () => {
  it("observes each rejection with its request, and never a success", async () => {
    const cause = new AuthError("unavailable", "JWKS fetch failed");
    const onRejection = vi.fn();
    let fail = true;
    const verify: Verifier = async () => {
      if (fail) throw cause;
      return principal;
    };
    const authenticate = createAuthenticator({ verify, onRejection });
    const incoming = request("Bearer a.b.c");
    await authenticate(incoming);
    fail = false;
    await authenticate(request("Bearer a.b.c"));
    expect(onRejection).toHaveBeenCalledExactlyOnceWith({ code: "auth_unavailable" }, incoming);
  });
});

describe("rejectionResponse", () => {
  it.each<[RejectionCode, number, string | null]>([
    // RFC 6750 section 3.1: a request with no credential gets a challenge without an error code.
    ["missing_token", 401, "Bearer"],
    ["malformed_token", 401, 'Bearer error="invalid_token"'],
    ["expired_token", 401, 'Bearer error="invalid_token"'],
    ["invalid_token", 401, 'Bearer error="invalid_token"'],
    ["forbidden", 403, null],
    // A provider outage says nothing about the token. A 401 here would sign people out.
    ["auth_unavailable", 503, null],
  ])("answers %s with %i and challenge %o", async (code, status, challenge) => {
    const response = rejectionResponse({ code });
    expect(response.status).toBe(status);
    expect(response.headers.get("www-authenticate")).toBe(challenge);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toStrictEqual({ error: code });
  });

  it("never puts the verifier's message or reason in the body", async () => {
    const cause = new AuthError("signature", "kid=test-key no matching key in JWKS at 10.0.0.7");
    const body = await rejectionResponse({ code: "invalid_token", cause }).text();
    expect(body).toBe('{"error":"invalid_token"}');
  });
});

// These inputs must never reach cryptographic verification, regardless of server limits.
it.each(["Bearer\ta.b.c", "Basic abc, Bearer a.b.c", "Bearer,a.b.c", `Bearer ${"a".repeat(8192)}`])(
  "rejects ambiguous or unbounded credentials (%#. case)",
  async (authorization) => {
    expect(await codeFor(unreachable, authorization)).toBe("malformed_token");
  },
);

it("awaits asynchronous rejection logging", async () => {
  const events: string[] = [];
  const authenticate = createAuthenticator({
    verify: unreachable,
    onRejection: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      events.push("logged");
    },
  });
  await authenticate(request());
  expect(events).toStrictEqual(["logged"]);
});

it("propagates asynchronous logging failures to the framework", async () => {
  const failed = Promise.reject(new Error("logging failed"));
  // Also observe it here so the old implementation cannot create an unhandled rejection.
  await expect(failed).rejects.toThrow("logging failed");
  await expect(
    createAuthenticator({ verify: unreachable, onRejection: () => failed })(request()),
  ).rejects.toThrow("logging failed");
});

it("prevents shared caches from retaining authentication rejections", () => {
  expect(rejectionResponse({ code: "auth_unavailable" }).headers.get("cache-control")).toBe(
    "no-store",
  );
});

it("keeps verifier details out of accidental rejection serialization", async () => {
  const cause = new AuthError("signature", "private verifier detail");
  const result = await createAuthenticator({
    verify: async () => {
      throw cause;
    },
  })(request("Bearer a.b.c"));
  expect(JSON.stringify(result)).toBe('{"ok":false,"rejection":{"code":"invalid_token"}}');
  expect(rejectionOf(result).cause).toBe(cause);
});
