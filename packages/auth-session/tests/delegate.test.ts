import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { setTimeout as nextTurn } from "node:timers/promises";
import { inspect } from "node:util";

import { AuthError } from "@littleorgans/auth";
import type { Principal, Verifier } from "@littleorgans/auth";
import { WorkOSAuthError } from "@littleorgans/auth-workos";
import type { Authentication, WorkOSAuth } from "@littleorgans/auth-workos";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REFRESH_MARGIN_SECONDS, readAccess, refreshesInFlight } from "../src/access.js";
import { readUserAccess } from "../src/delegate.js";
import type { ServiceOrigin, UserAccess, UserAccessDeps } from "../src/delegate.js";
import type { TokenFailure } from "../src/failure.js";
import { SESSION_COOKIE, readSession, seal } from "../src/session.js";
import { jarWith } from "./support.js";
import { createSigner, freezeClock, verifierFor } from "./tokens.js";

const cookieKey = randomBytes(32);
const service = "https://api.example.com";
const provider = await createSigner();

const principal: Principal = {
  userId: "user_01HBEQ",
  orgId: "org_01M0",
  roles: ["member"],
  permissions: [],
  entitlements: [],
};

// Distinctive enough that finding either one anywhere in a value can only mean it leaked.
const ACCESS = "access-1-secret-xq7";
const RENEWED = "access-2-secret-zp4";

const renewal: Authentication = {
  user: {
    id: principal.userId,
    email: "owner@example.com",
    emailVerified: true,
    profilePictureUrl: null,
    name: null,
    firstName: null,
    lastName: null,
  },
  organizationId: "org_01M0",
  accessToken: RENEWED,
  refreshToken: "refresh-2",
};

const unavailable = (): never => {
  throw new Error("not part of these tests");
};

function authDouble(refresh: () => Promise<Authentication> = () => Promise.resolve(renewal)): {
  auth: WorkOSAuth;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    auth: {
      refreshTokens(options) {
        calls.push(options);
        return refresh();
      },
      getLogoutUrl: unavailable,
      getAuthorizationUrl: unavailable,
      authenticateWithCode: unavailable,
      signInWithPassword: unavailable,
      sendMagicAuthCode: unavailable,
      verifyMagicAuthCode: unavailable,
      challengeMfa: unavailable,
      verifyMfa: unavailable,
      provisionOrganization: unavailable,
    },
  };
}

interface Sent {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly authorization: string | null;
}

/** Records what would have gone over the wire and answers 200, so no service needs to listen. */
function sender(): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init) => {
      sent.push({
        url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
        init,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(new Response("ok"));
    },
  };
}

function depsWith(
  verify: Verifier,
  auth: WorkOSAuth = authDouble().auth,
  serviceOrigins: readonly ServiceOrigin[] = [service],
  send: "recorded" | "live" = "recorded",
) {
  const logged: TokenFailure[] = [];
  const wire = sender();
  const deps: UserAccessDeps = {
    cookieKey,
    secureCookies: false,
    verify,
    auth,
    log: (failure) => logged.push(failure),
    serviceOrigins,
    // Left out for "live", so the default, Node's own fetch, is what sends.
    ...(send === "recorded" ? { fetch: wire.fetch } : {}),
  };
  return { deps, logged, sent: wire.sent };
}

const valid: Verifier = () => Promise.resolve(principal);
const expiredThenValid: Verifier = (token) =>
  token === ACCESS
    ? Promise.reject(new AuthError("expired", "token expired"))
    : Promise.resolve(principal);
const rejects =
  (reason: "signature" | "claims" | "malformed"): Verifier =>
  () =>
    Promise.reject(new AuthError(reason, `token ${reason}`));

const session = () =>
  jarWith({
    [SESSION_COOKIE]: seal(cookieKey, { accessToken: ACCESS, refreshToken: "refresh-1" }),
  });

function signedIn(user: UserAccess) {
  if (user.status !== "signed-in") throw new Error(`Expected signed-in, got ${user.status}`);
  return user;
}

/**
 * Every string reachable from a value by reflection: own properties, enumerable or not, keyed by
 * name or symbol, through objects, arrays and functions. What a serialiser or an inspector could
 * possibly find. A closure's variables are not reachable this way, which is the point.
 */
function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const strings: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string") strings.push(key);
    strings.push(...reachableStrings(Reflect.getOwnPropertyDescriptor(value, key)?.value, seen));
  }
  return strings;
}

function expectNoToken(value: unknown): void {
  const views = [
    JSON.stringify(value) ?? "",
    inspect(value, { depth: Infinity, showHidden: true, getters: true }),
    ...reachableStrings(value),
  ];
  for (const view of views) {
    expect(view).not.toContain(ACCESS);
    expect(view).not.toContain(RENEWED);
  }
}

describe("fetch as the signed-in person", () => {
  it("sends the verified token as the bearer, and passes everything else through", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));
    const signal = new AbortController().signal;

    const response = await user.fetch(`${service}/v1/me`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "r1" },
      body: "{}",
      signal,
      redirect: "manual",
    });

    expect(await response.text()).toBe("ok");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${service}/v1/me`);
    expect(sent[0]?.authorization).toBe(`Bearer ${ACCESS}`);
    expect(sent[0]?.init?.method).toBe("POST");
    expect(sent[0]?.init?.body).toBe("{}");
    expect(sent[0]?.init?.signal).toBe(signal);
    expect(sent[0]?.init?.redirect).toBe("manual");
    const headers = new Headers(sent[0]?.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-request-id")).toBe("r1");
  });

  // Appending would send two credentials joined by a comma, and auth-http refuses that pair as
  // malformed. Replacing makes the person's token the only one that travels, however the caller
  // spelt theirs and however many times: header names compare case-insensitively, so two spellings
  // are one header, and the second joins the first rather than surviving beside the token.
  const spellings: [string, NonNullable<RequestInit["headers"]>][] = [
    ["in lower case", { authorization: "Bearer other" }],
    ["in title case", { Authorization: "Bearer other" }],
    ["under two spellings", { authorization: "Bearer one", AUTHORIZATION: "Bearer two" }],
    ["as a Headers instance", new Headers({ Authorization: "Basic b3BlcmF0b3I6cHc=" })],
    [
      "as a list of pairs",
      [
        ["authorization", "Bearer one"],
        ["Authorization", "Bearer two"],
      ],
    ],
  ];
  it.each(spellings)("replaces an Authorization header the caller set %s", async (_, headers) => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await user.fetch(new URL("/v1/me", service), { headers });

    expect(sent[0]?.authorization).toBe(`Bearer ${ACCESS}`);
  });

  // The caller's own Headers object is copied, not written to. Otherwise the token would sit in a
  // value the caller still holds, and may well reuse, log or return.
  it("leaves the caller's Headers object without the token", async () => {
    const { deps } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));
    const own = new Headers({ "x-request-id": "r1" });

    await user.fetch(`${service}/v1/me`, { headers: own });

    expect(own.get("authorization")).toBeNull();
    expect([...own.keys()]).toStrictEqual(["x-request-id"]);
  });

  it.each([
    ["another host", "https://evil.example/v1/me"],
    ["a suffix of the host", "https://api.example.com.evil.example/v1/me"],
    ["the same host over http", "http://api.example.com/v1/me"],
    ["the same host on another port", "https://api.example.com:8443/v1/me"],
  ])("refuses %s without sending anything", async (_, url) => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch(url)).rejects.toThrow("not in serviceOrigins");
    expect(sent).toHaveLength(0);
  });

  // A relative URL has no origin of its own to check. Resolving it against anything would be this
  // helper choosing a destination for the token.
  it("refuses a relative URL", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch("/v1/me")).rejects.toThrow(TypeError);
    expect(sent).toHaveLength(0);
  });

  // A blob URL carries the origin it was minted under, so `blob:https://api.example.com/...` has
  // the service's origin and none of its reachability. Only the two schemes a service listens on
  // may carry the token, whatever origin the URL reports.
  it("refuses a URL whose scheme is not http or https, even under the service origin", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));
    const blob = `blob:${service}/2f3a9c0e-6b1d-4c7e-9b1a-0d3f5e7a9c1b`;
    expect(new URL(blob).origin).toBe(service);

    await expect(user.fetch(blob)).rejects.toThrow("services are http or https");
    expect(sent).toHaveLength(0);
  });

  // What goes out is the URL object the origin check read, so the check and the send cannot see
  // two different addresses. The visible consequence: the wire gets the parsed form, with the case
  // of the host, a default port and surrounding whitespace all normalised away.
  it("sends the parsed URL it checked, not the string it was given", async () => {
    const { deps, sent } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await user.fetch(" HTTPS://API.example.com:443/v1/me\t");

    expect(sent.map((request) => request.url)).toStrictEqual([`${service}/v1/me`]);
  });

  it("refuses every call when no service origins are configured", async () => {
    const { deps, sent } = depsWith(valid, authDouble().auth, []);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch(`${service}/v1/me`)).rejects.toThrow("not in serviceOrigins");
    expect(sent).toHaveLength(0);
  });
});

describe("the token never leaves the closure", () => {
  it("is absent from the signed-in value, however it is read", async () => {
    const { deps } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    expectNoToken(user);
    expectNoToken(user.principal);
    expect(Object.keys(user).toSorted()).toStrictEqual(["fetch", "principal", "status"]);
  });

  it("is absent after a refresh too, and from what readAccess returns", async () => {
    const { deps } = depsWith(expiredThenValid);

    expectNoToken(await readUserAccess(session().jar, deps));
    expectNoToken(await readAccess(session().jar, deps));
  });

  // JSON is the lowest common denominator of what a loader's value becomes on the way to the
  // browser. Only the status and the Principal survive; the function does not.
  it("serialises to the status and the Principal alone", async () => {
    const { deps } = depsWith(valid);
    const user = signedIn(await readUserAccess(session().jar, deps));

    expect(JSON.parse(JSON.stringify(user))).toStrictEqual({ status: "signed-in", principal });
  });
});

describe("an expired token", () => {
  afterEach(() => {
    expect(refreshesInFlight()).toBe(0);
  });

  it("is refreshed before anything is sent, and the renewed token is the bearer", async () => {
    const { jar, written } = session();
    const { auth, calls } = authDouble();
    const { deps, sent } = depsWith(expiredThenValid, auth);

    const user = signedIn(await readUserAccess(jar, deps));
    await user.fetch(`${service}/v1/me`);

    expect(calls).toStrictEqual([{ refreshToken: "refresh-1" }]);
    expect(sent[0]?.authorization).toBe(`Bearer ${RENEWED}`);
    expect(readSession({ cookieKey }, written[0]?.value)).toStrictEqual({
      accessToken: RENEWED,
      refreshToken: "refresh-2",
    });
  });

  // The helper has no refresh of its own. It joins the in-flight call readAccess would, so a loader
  // reading Access and a server function calling a service in the same moment spend the token once.
  it("shares one provider call with concurrent readers of either kind", async () => {
    let settle: (value: Authentication) => void = unavailable;
    const pending = new Promise<Authentication>((resolve) => {
      settle = resolve;
    });
    const { auth, calls } = authDouble(() => pending);
    const { deps, sent } = depsWith(expiredThenValid, auth);

    const users = [session(), session(), session()].map(({ jar }) => readUserAccess(jar, deps));
    const access = readAccess(session().jar, deps);
    await nextTurn(0);
    expect(calls).toHaveLength(1);
    expect(refreshesInFlight()).toBe(1);

    settle(renewal);
    await Promise.all(
      (await Promise.all(users)).map((user) => signedIn(user).fetch(`${service}/v1/me`)),
    );

    expect(await access).toStrictEqual({ status: "signed-in", principal });
    expect(calls).toHaveLength(1);
    expect(sent.map((request) => request.authorization)).toStrictEqual(
      Array.from({ length: 3 }, () => `Bearer ${RENEWED}`),
    );
  });
});

// The same five states as Access, as values. Strict equality also proves no failure state carries a
// fetch: only a verified session can call anything.
describe("when there is no usable session", () => {
  it("is anonymous without a cookie", async () => {
    const { deps } = depsWith(valid);
    expect(await readUserAccess(jarWith().jar, deps)).toStrictEqual({ status: "anonymous" });
  });

  it("ends a session whose token will not verify, and clears the cookie", async () => {
    const { jar, cleared } = session();
    const { deps, logged } = depsWith(rejects("signature"));

    expect(await readUserAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(logged.map((failure) => failure.reason)).toStrictEqual(["signature"]);
  });

  it("ends a session whose refresh is refused", async () => {
    const { jar, cleared } = session();
    const { auth } = authDouble(() =>
      Promise.reject(
        new WorkOSAuthError({ reason: "unauthorized", message: "invalid_grant", cause: undefined }),
      ),
    );
    const { deps, sent } = depsWith(expiredThenValid, auth);

    expect(await readUserAccess(jar, deps)).toStrictEqual({ status: "ended" });
    expect(cleared).toStrictEqual([SESSION_COOKIE]);
    expect(sent).toHaveLength(0);
  });

  it.each(["rate-limited", "unavailable"] as const)(
    "is unavailable, keeping the cookie, when the refresh is %s",
    async (reason) => {
      const { jar, cleared } = session();
      const { auth } = authDouble(() =>
        Promise.reject(new WorkOSAuthError({ reason, message: "try later", cause: undefined })),
      );
      const { deps } = depsWith(expiredThenValid, auth);

      expect(await readUserAccess(jar, deps)).toStrictEqual({ status: "unavailable" });
      expect(cleared).toHaveLength(0);
    },
  );

  it("is broken when the token's claims are the wrong shape", async () => {
    const { deps } = depsWith(rejects("claims"));
    expect(await readUserAccess(session().jar, deps)).toStrictEqual({ status: "broken" });
  });
});

describe("service origins", () => {
  // The suggestion must itself be accepted: the bare origin, never the path the entry had.
  it("names the per-origin opt-in, as an entry it would accept, when it refuses plain http", async () => {
    const { deps } = depsWith(valid, authDouble().auth, ["http://api:3000/v1"]);
    await expect(readUserAccess(session().jar, deps)).rejects.toThrow(
      'List a service on a network you trust as { origin: "http://api:3000", insecure: true }.',
    );
  });

  it("suggests no insecure entry for a scheme an insecure entry would refuse", async () => {
    const { deps } = depsWith(valid, authDouble().auth, ["ws://api:3000"]);
    const refused = readUserAccess(session().jar, deps);
    await expect(refused).rejects.toThrow("must use HTTPS except on localhost.");
    await expect(refused).rejects.not.toThrow("insecure");
  });

  // The flag covers the one origin it is written beside. Nothing about it widens to the host, the
  // port, the scheme, or the other entries.
  it.each([
    ["another port on the same host", "http://api:3001/v1/me"],
    ["another host on the same port", "http://api-2:3000/v1/me"],
    ["the https origin of the same host", "https://api:3000/v1/me"],
    ["plain http to an origin listed only as https", "http://api.example.com/v1/me"],
  ])("still refuses %s", async (_, url) => {
    const { deps, sent } = depsWith(valid, authDouble().auth, [
      service,
      { origin: "http://api:3000", insecure: true },
    ]);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await expect(user.fetch(url)).rejects.toThrow("not in serviceOrigins");
    expect(sent).toHaveLength(0);
  });

  // Built from JSON rather than typed, because the type already refuses it: a JavaScript caller or
  // a value parsed from configuration is how an object without the flag would arrive.
  const unflagged: ServiceOrigin = JSON.parse('{"origin":"http://api:3000","insecure":false}');
  const quoted: ServiceOrigin = JSON.parse('{"origin":"http://api:3000","insecure":"false"}');

  it.each<[string, ServiceOrigin, string]>([
    ["plain http off localhost", "http://api.example.com", "must use HTTPS"],
    ["a path", "https://api.example.com/v1", "origin only"],
    ["a query", "https://api.example.com/?v=1", "origin only"],
    ["a user name", "https://operator@api.example.com", "origin only"],
    ["an insecure entry that is https", { origin: service, insecure: true }, "is not http"],
    [
      "an insecure entry with a path",
      { origin: "http://api:3000/v1", insecure: true },
      "origin only",
    ],
    ["an object without insecure: true", unflagged, "without insecure: true"],
    ["an insecure flag that is a string, even a truthy one", quoted, "without insecure: true"],
  ])("refuses %s before the session is read", async (_, origin, message) => {
    let reads = 0;
    const { deps } = depsWith(valid, authDouble().auth, [origin]);
    const jar = { ...jarWith().jar, read: () => ((reads += 1), undefined) };

    await expect(readUserAccess(jar, deps)).rejects.toThrow(message);
    expect(reads).toBe(0);
  });

  it.each<[string, ServiceOrigin, string]>([
    ["http on localhost", "http://localhost:8787", "http://localhost:8787/v1/me"],
    [
      "plain http on a trusted network when the origin is marked insecure",
      { origin: "http://api:3000", insecure: true },
      "http://api:3000/v1/me",
    ],
    ["a trailing slash and a default port", "https://API.example.com:443/", `${service}/v1/me`],
  ])("accepts %s", async (_, origin, url) => {
    const { deps, sent } = depsWith(valid, authDouble().auth, [origin]);
    const user = signedIn(await readUserAccess(session().jar, deps));

    await user.fetch(url);
    expect(sent.map((request) => request.url)).toStrictEqual([url]);
  });
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Ends kept-alive sockets as well as the listener, so nothing outlives the test that opened it. */
function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

/** A loopback HTTP server on a free port, so a redirect can be followed for real. */
function listen(handle: Handler): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(handle);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

// Node's own fetch against real sockets, not the recording double. What happens after the request
// leaves this helper is the platform's doing, and the documentation makes a promise about it: a
// redirect to another origin drops the header. This pins that promise on the pinned Node.
describe("redirects, through the real fetch", () => {
  it("keeps the token on a same-origin redirect and drops it across origins", async () => {
    const seen: { readonly at: string; readonly path: string; readonly bearer: string | null }[] =
      [];
    const record = (at: string): Handler => {
      return (request, response) => {
        seen.push({ at, path: request.url ?? "", bearer: request.headers.authorization ?? null });
        const location =
          request.url === "/same"
            ? "/landed"
            : request.url === "/cross"
              ? `${elsewhere}/landed`
              : null;
        if (location === null) {
          response.end("ok");
        } else {
          response.writeHead(302, { location }).end();
        }
      };
    };
    const other = await listen(record("other"));
    const elsewhere = other.origin;
    const own = await listen(record("service"));
    try {
      const { deps, sent } = depsWith(valid, authDouble().auth, [own.origin], "live");
      const user = signedIn(await readUserAccess(session().jar, deps));

      expect(await (await user.fetch(`${own.origin}/same`)).text()).toBe("ok");
      expect(await (await user.fetch(`${own.origin}/cross`)).text()).toBe("ok");

      expect(sent).toHaveLength(0);
      expect(seen).toStrictEqual([
        { at: "service", path: "/same", bearer: `Bearer ${ACCESS}` },
        { at: "service", path: "/landed", bearer: `Bearer ${ACCESS}` },
        { at: "service", path: "/cross", bearer: `Bearer ${ACCESS}` },
        { at: "other", path: "/landed", bearer: null },
      ]);
    } finally {
      await Promise.all([close(own.server), close(other.server)]);
    }
  });
});

// The token is forwarded, so one with seconds left would expire at the service. `readUserAccess`
// reads it through the same margin as `readAccess`, and falls back the same way.
describe("a token near its expiry", () => {
  beforeEach(freezeClock);
  afterEach(() => {
    vi.useRealTimers();
    expect(refreshesInFlight()).toBe(0);
  });

  async function nearing(secondsLeft: number) {
    const accessToken = await provider.sign(secondsLeft);
    const renewed: Authentication = { ...renewal, accessToken: await provider.sign(300) };
    const request = jarWith({
      [SESSION_COOKIE]: seal(cookieKey, { accessToken, refreshToken: "refresh-1" }),
    });
    return { accessToken, renewed, request };
  }

  it("is sent as it is when it is outside the margin", async () => {
    const { accessToken, request } = await nearing(REFRESH_MARGIN_SECONDS + 1);
    const { auth, calls } = authDouble();
    const { deps, sent } = depsWith(verifierFor(provider), auth);

    await signedIn(await readUserAccess(request.jar, deps)).fetch(`${service}/v1/me`);

    expect(calls).toHaveLength(0);
    expect(sent[0]?.authorization).toBe(`Bearer ${accessToken}`);
  });

  it("is refreshed inside the margin, and the new token is the bearer", async () => {
    const { request, renewed } = await nearing(REFRESH_MARGIN_SECONDS - 1);
    const { auth, calls } = authDouble(() => Promise.resolve(renewed));
    const { deps, sent } = depsWith(verifierFor(provider), auth);

    await signedIn(await readUserAccess(request.jar, deps)).fetch(`${service}/v1/me`);

    expect(calls).toHaveLength(1);
    expect(sent[0]?.authorization).toBe(`Bearer ${renewed.accessToken}`);
    expect(readSession({ cookieKey }, request.written[0]?.value)?.accessToken).toBe(
      renewed.accessToken,
    );
  });

  it.each([
    [
      "unavailable",
      new WorkOSAuthError({ reason: "unavailable", message: "503", cause: undefined }),
    ],
    [
      "refused",
      new WorkOSAuthError({ reason: "unauthorized", message: "invalid_grant", cause: undefined }),
    ],
  ])("sends the current token when the early refresh is %s", async (_, error) => {
    const { accessToken, request } = await nearing(10);
    const { auth, calls } = authDouble(() => Promise.reject(error));
    const { deps, sent, logged } = depsWith(verifierFor(provider), auth);

    await signedIn(await readUserAccess(request.jar, deps)).fetch(`${service}/v1/me`);

    expect(calls).toHaveLength(1);
    expect(sent[0]?.authorization).toBe(`Bearer ${accessToken}`);
    expect(request.written).toHaveLength(0);
    expect(request.cleared).toHaveLength(0);
    expect(logged.map((failure) => failure.status)).toStrictEqual(["signed-in"]);
  });
});
