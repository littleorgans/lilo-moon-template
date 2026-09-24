import { describe, expect, it } from "vitest";

import type { StagingAdmin } from "../src/staging.js";
import {
  CONTRACT_EMAIL_DOMAIN,
  SKIP_MESSAGE,
  STALE_AFTER_MS,
  contractEmail,
  personalExternalId,
  removeUsers,
  requiredCredentials,
  stagingCredentials,
  sweepStale,
} from "../src/staging.js";

const liveKey = () =>
  stagingCredentials({ WORKOS_API_KEY: "sk_live_x", WORKOS_CLIENT_ID: "client_x" });

describe("stagingCredentials", () => {
  it("returns null without credentials, so the suite skips", () => {
    expect(stagingCredentials({})).toBeNull();
    expect(stagingCredentials({ WORKOS_API_KEY: "sk_test_x", WORKOS_CLIENT_ID: "" })).toBeNull();
    expect(stagingCredentials({ WORKOS_CLIENT_ID: "client_x" })).toBeNull();
  });

  it("fails instead of skipping when the workflow requires them, naming what is missing", () => {
    expect(() =>
      stagingCredentials({ WORKOS_CONTRACT_REQUIRED: "true", WORKOS_CLIENT_ID: "client_x" }),
    ).toThrow(/WORKOS_API_KEY is not set/);
    expect(() => stagingCredentials({ WORKOS_CONTRACT_REQUIRED: "true" })).toThrow(
      /WORKOS_API_KEY and WORKOS_CLIENT_ID are not set/,
    );
  });

  it("refuses a key that is not a staging key, without echoing it", () => {
    expect(liveKey).toThrow(/not a staging key/);
    expect(liveKey).not.toThrow(/sk_live_x/);
  });

  it("are required where the suite has not skipped", () => {
    expect(() => requiredCredentials({})).toThrow(SKIP_MESSAGE);
    expect(
      requiredCredentials({ WORKOS_API_KEY: "sk_test_x", WORKOS_CLIENT_ID: "client_x" }),
    ).toEqual({ apiKey: "sk_test_x", clientId: "client_x" });
  });

  it("returns a staging key and client id", () => {
    expect(
      stagingCredentials({ WORKOS_API_KEY: "sk_test_x", WORKOS_CLIENT_ID: "client_x" }),
    ).toEqual({ apiKey: "sk_test_x", clientId: "client_x" });
  });
});

describe("contract addresses", () => {
  it("are unique and on the reserved contract domain", () => {
    const [first, second] = [contractEmail("api"), contractEmail("api")];
    expect(first).not.toBe(second);
    expect(first).toMatch(new RegExp(`^lilo-contract-api-[0-9a-f]{8}@${CONTRACT_EMAIL_DOMAIN}$`));
  });
});

interface User {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

function notFound(): Error {
  return Object.assign(new Error("not found"), { status: 404 });
}

/** An admin over in-memory users and organizations, recording every deletion. */
function recordingAdmin(users: User[], organizations: Record<string, string>) {
  const deleted: string[] = [];
  const admin: StagingAdmin = {
    userManagement: {
      deleteUser: async (id) => {
        if (id === "user_broken") throw new Error("provider down");
        if (!users.some((user) => user.id === id)) throw notFound();
        deleted.push(id);
      },
      listUsers: async () => ({ autoPagination: async () => users }),
    },
    organizations: {
      deleteOrganization: async (id) => {
        deleted.push(id);
      },
      getOrganizationByExternalId: async (externalId) => {
        const id = organizations[externalId];
        if (id === undefined) throw notFound();
        return { id };
      },
    },
  };
  return { admin, deleted };
}

describe("cleanup", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const old = new Date(now - STALE_AFTER_MS - 1).toISOString();
  const recent = new Date(now - 1000).toISOString();

  it("deletes the personal organization, then the user, and tolerates either being gone", async () => {
    const { admin, deleted } = recordingAdmin([{ id: "user_a", email: "a@x", createdAt: recent }], {
      [personalExternalId("user_a")]: "org_a",
    });
    await removeUsers(admin, ["user_a", "user_gone"]);
    expect(deleted).toEqual(["org_a", "user_a"]);
  });

  it("keeps going past a failure and reports every one", async () => {
    const { admin, deleted } = recordingAdmin(
      [{ id: "user_a", email: "a@x", createdAt: recent }],
      {},
    );
    await expect(removeUsers(admin, ["user_broken", "user_a"])).rejects.toThrow(
      "Could not clean up 1 staging user(s).",
    );
    expect(deleted).toEqual(["user_a"]);
  });

  it("stops at a lookup failure other than not found", async () => {
    const { admin } = recordingAdmin([], {});
    const failing: StagingAdmin = {
      ...admin,
      organizations: {
        ...admin.organizations,
        getOrganizationByExternalId: async () => {
          throw new Error("provider down");
        },
      },
    };
    await expect(removeUsers(failing, ["user_a"])).rejects.toThrow(AggregateError);
  });

  it("sweeps only contract addresses older than an hour", async () => {
    const { admin, deleted } = recordingAdmin(
      [
        { id: "user_old", email: `x@${CONTRACT_EMAIL_DOMAIN}`, createdAt: old },
        { id: "user_new", email: `y@${CONTRACT_EMAIL_DOMAIN}`, createdAt: recent },
        { id: "user_person", email: "someone@example.org", createdAt: old },
      ],
      {},
    );
    expect(await sweepStale(admin, now)).toBe(1);
    expect(deleted).toEqual(["user_old"]);
  });
});
