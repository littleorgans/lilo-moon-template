import { UnauthorizedException } from "@workos-inc/node";
import { describe, expect, it } from "vitest";

import type { WorkOSClient } from "../src/index.js";
import { createWorkOSAuth } from "../src/index.js";
import { notUnderTest } from "./support.js";

type UserManagement = WorkOSClient["userManagement"];

type Call =
  | {
      readonly method: "getAuthorizationUrl";
      readonly options: Parameters<UserManagement["getAuthorizationUrl"]>[0];
    }
  | {
      readonly method: "authenticateWithCode";
      readonly options: Parameters<UserManagement["authenticateWithCode"]>[0];
    };

const CLIENT_ID = "client_01M0JSGENAGWJCN0R7JME8JWGM";
const REDIRECT_URI = "http://localhost:5199/callback";

const authentication = {
  user: {
    id: "user_01HBEQ",
    email: "owner@example.com",
    emailVerified: true,
    profilePictureUrl: null,
    name: "Owner Example",
    firstName: "Owner",
    lastName: "Example",
  },
  accessToken: "access-token",
  refreshToken: "refresh-token",
} satisfies Awaited<ReturnType<UserManagement["authenticateWithCode"]>>;

// A serialiser renders an undefined value as the four characters "undefined" rather than dropping
// the key, which is the whole reason the conditional spreads exist. The double reproduces that.
function authorizeUrl(options: Readonly<Record<string, string | undefined>>): string {
  const url = new URL("https://api.workos.com/user_management/authorize");
  for (const [key, value] of Object.entries(options)) {
    url.searchParams.set(key, value ?? "undefined");
  }
  return url.toString();
}

// The double echoes its arguments back inside the URL. A real SDK builds a real query string; what
// matters to this package is which values reach it, so the double makes that inspectable.
function recorder(codeFailure?: unknown): { client: WorkOSClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      userManagement: {
        getAuthorizationUrl(options) {
          calls.push({ method: "getAuthorizationUrl", options });
          return authorizeUrl(options);
        },
        authenticateWithCode(options) {
          calls.push({ method: "authenticateWithCode", options });
          if (codeFailure !== undefined) return Promise.reject(codeFailure);
          return Promise.resolve(authentication);
        },
        authenticateWithPassword: notUnderTest,
        createMagicAuth: notUnderTest,
        authenticateWithMagicAuth: notUnderTest,
        authenticateWithRefreshToken: notUnderTest,
        createOrganizationMembership: notUnderTest,
      },
      multiFactorAuth: { challengeFactor: notUnderTest, verifyChallenge: notUnderTest },
      organizations: { createOrganization: notUnderTest },
    },
  };
}

const auth = (codeFailure?: unknown) => {
  const { client, calls } = recorder(codeFailure);
  return { calls, subject: createWorkOSAuth({ client, clientId: CLIENT_ID }) };
};

const authorizationCall = (calls: readonly Call[]) =>
  calls.find((call) => call.method === "getAuthorizationUrl")?.options;

describe("getAuthorizationUrl", () => {
  it("sends the configured client id rather than accepting one per call", () => {
    const { subject, calls } = auth();
    subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      provider: "GoogleOAuth",
    });
    expect(authorizationCall(calls)?.clientId).toBe(CLIENT_ID);
  });

  it("passes the redirect uri, state and provider through unchanged", () => {
    const { subject, calls } = auth();
    subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      provider: "GoogleOAuth",
    });
    expect(authorizationCall(calls)).toMatchObject({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      provider: "GoogleOAuth",
    });
  });

  it("returns the provider's url", () => {
    const { subject } = auth();
    const url = subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      provider: "GoogleOAuth",
    });
    expect(url).toContain("https://api.workos.com/user_management/authorize?");
    expect(new URL(url).searchParams.get("state")).toBe("csrf-token");
  });

  // Every optional key is spread conditionally. Sending `provider: undefined` is not the same as
  // omitting it once a request is serialised, so absence has to stay absence.
  it("omits optional selectors rather than sending them as undefined", () => {
    const { subject, calls } = auth();
    subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      provider: "GoogleOAuth",
    });
    const options = authorizationCall(calls) ?? {};
    expect(Object.keys(options).toSorted()).toStrictEqual([
      "clientId",
      "provider",
      "redirectUri",
      "state",
    ]);
  });

  it("forwards the optional hints when they are given", () => {
    const { subject, calls } = auth();
    subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      provider: "authkit",
      loginHint: "owner@example.com",
      screenHint: "sign-up",
    });
    expect(authorizationCall(calls)).toMatchObject({
      loginHint: "owner@example.com",
      screenHint: "sign-up",
    });
  });

  it.each([
    ["connectionId", { connectionId: "conn_01" }],
    ["organizationId", { organizationId: "org_01M0" }],
  ])("accepts %s as the identity path instead of a social provider", (_name, selector) => {
    const { subject, calls } = auth();
    subject.getAuthorizationUrl({ redirectUri: REDIRECT_URI, state: "csrf-token", ...selector });
    expect(authorizationCall(calls)).toMatchObject(selector);
  });

  // The absent case, which the presence tests above cannot reach. An unconditional
  // `provider: input.provider` keeps every one of them green while serialising the literal string
  // "undefined" into the query. Found by a mutation probe that the earlier tests survived.
  it("leaves an unused selector off the call entirely, not present and undefined", () => {
    const { subject, calls } = auth();
    subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      connectionId: "conn_01",
    });
    const options = authorizationCall(calls) ?? {};
    expect(Object.keys(options).toSorted()).toStrictEqual([
      "clientId",
      "connectionId",
      "redirectUri",
      "state",
    ]);
    expect("provider" in options).toBe(false);
  });

  it("never renders an omitted selector into the url", () => {
    const { subject } = auth();
    const url = subject.getAuthorizationUrl({
      redirectUri: REDIRECT_URI,
      state: "csrf-token",
      connectionId: "conn_01",
    });
    expect(url).not.toContain("undefined");
  });
});

describe("getAuthorizationUrl refusals", () => {
  // An empty state type-checks and disables the callback's only defence. The flow still completes,
  // which is exactly why this has to fail loudly here.
  it("refuses an empty state before building a url", () => {
    const { subject, calls } = auth();
    expect(() =>
      subject.getAuthorizationUrl({
        redirectUri: REDIRECT_URI,
        state: "",
        provider: "GoogleOAuth",
      }),
    ).toThrow("non-empty state");
    expect(calls).toStrictEqual([]);
  });

  it("refuses a request that names no identity path", () => {
    const { subject, calls } = auth();
    expect(() =>
      subject.getAuthorizationUrl({ redirectUri: REDIRECT_URI, state: "csrf-token" }),
    ).toThrow("provider, connectionId or organizationId");
    expect(calls).toStrictEqual([]);
  });

  it.each([[""], ["csrf-token"]])(
    "reports a refusal as a configuration failure, not a provider one",
    (state) => {
      const { subject } = auth();
      expect(() => subject.getAuthorizationUrl({ redirectUri: REDIRECT_URI, state })).toThrow(
        expect.objectContaining({ name: "WorkOSAuthError", reason: "configuration" }),
      );
    },
  );
});

// The synchronous path has its own catch, and an untested catch is a guess. A provider that
// rejects the options must still leave this package as a typed reason rather than a raw SDK error.
describe("getAuthorizationUrl provider failures", () => {
  it("translates a synchronous provider throw into a typed reason", () => {
    const { client } = recorder();
    const throwing: WorkOSClient = {
      ...client,
      userManagement: {
        ...client.userManagement,
        getAuthorizationUrl: () => {
          throw new UnauthorizedException("request_02");
        },
      },
    };
    const subject = createWorkOSAuth({ client: throwing, clientId: CLIENT_ID });
    expect(() =>
      subject.getAuthorizationUrl({
        redirectUri: REDIRECT_URI,
        state: "csrf-token",
        provider: "GoogleOAuth",
      }),
    ).toThrow(
      expect.objectContaining({
        name: "WorkOSAuthError",
        reason: "unauthorized",
        requestId: "request_02",
      }),
    );
  });
});

describe("authenticateWithCode", () => {
  it("exchanges the code with the configured client id", async () => {
    const { subject, calls } = auth();
    await subject.authenticateWithCode({ code: "01M0JSGE" });
    expect(calls).toStrictEqual([
      { method: "authenticateWithCode", options: { clientId: CLIENT_ID, code: "01M0JSGE" } },
    ]);
  });

  it("forwards the request context when it is given", async () => {
    const { subject, calls } = auth();
    await subject.authenticateWithCode({
      code: "01M0JSGE",
      ipAddress: "203.0.113.7",
      userAgent: "probe/1.0",
    });
    expect(calls[0]?.options).toMatchObject({ ipAddress: "203.0.113.7", userAgent: "probe/1.0" });
  });

  // A first social sign-in has no organization. The provider omits the key entirely, and reading
  // that as anything other than null would make a normal state look like a broken one.
  it("reports a missing organization as null rather than dropping the key", async () => {
    const { subject } = auth();
    const result = await subject.authenticateWithCode({ code: "01M0JSGE" });
    expect(result.organizationId).toBeNull();
  });

  it("returns the tokens and the user the provider issued", async () => {
    const { subject } = auth();
    const result = await subject.authenticateWithCode({ code: "01M0JSGE" });
    expect(result.accessToken).toBe("access-token");
    expect(result.refreshToken).toBe("refresh-token");
    expect(result.user).toStrictEqual(authentication.user);
  });

  it("translates a provider rejection into a typed reason", async () => {
    const { subject } = auth(new UnauthorizedException("request-id-01"));
    await expect(subject.authenticateWithCode({ code: "wrong" })).rejects.toMatchObject({
      name: "WorkOSAuthError",
      reason: "unauthorized",
    });
  });
});
