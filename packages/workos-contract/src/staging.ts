import { randomUUID } from "node:crypto";

export interface StagingCredentials {
  readonly apiKey: string;
  readonly clientId: string;
}

export const SKIP_MESSAGE =
  "WorkOS contract tests skipped: WORKOS_API_KEY and WORKOS_CLIENT_ID are not set. They run " +
  "against a WorkOS staging environment; docs/maintaining.md, CI secrets, says where the values live.";

/**
 * The staging credentials, or null when they are absent so the suite skips.
 *
 * Absent is the normal state for a contributor, a fork and `moon ci`. The scheduled workflow sets
 * `WORKOS_CONTRACT_REQUIRED=true`, because there a skip would report green while testing nothing,
 * which is how a revoked secret would go unnoticed.
 *
 * Only a `sk_test_` key is accepted. The suite creates and deletes users and organizations, and a
 * production key pasted into the wrong variable must not get that far.
 */
export function stagingCredentials(
  env: NodeJS.ProcessEnv = process.env,
): StagingCredentials | null {
  const apiKey = env["WORKOS_API_KEY"] ?? "";
  const clientId = env["WORKOS_CLIENT_ID"] ?? "";
  const missing = Object.entries({ WORKOS_API_KEY: apiKey, WORKOS_CLIENT_ID: clientId })
    .filter(([, value]) => value.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    if (env["WORKOS_CONTRACT_REQUIRED"] === "true") {
      throw new Error(
        `WORKOS_CONTRACT_REQUIRED is true but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. Check that this repository can read the organization secrets (docs/maintaining.md, CI secrets).`,
      );
    }
    return null;
  }
  if (!apiKey.startsWith("sk_test_")) {
    throw new Error(
      "WORKOS_API_KEY is not a staging key (sk_test_). The contract tests create and delete users and organizations, so they refuse any other environment.",
    );
  }
  return { apiKey, clientId };
}

/** The credentials, for code that runs only when the suite has not skipped. */
export function requiredCredentials(env: NodeJS.ProcessEnv = process.env): StagingCredentials {
  const found = stagingCredentials(env);
  if (found === null) throw new Error(SKIP_MESSAGE);
  return found;
}

/**
 * The domain every address the suite signs up with belongs to.
 *
 * `.test` is reserved (RFC 2606), so the codes the provider emails can reach nobody. A real domain
 * is also exposed to the environment's own configuration: `example.com` is claimed by an SSO
 * connection in the staging environment this was written against, and signing in there answers
 * `sso_required` instead of a session.
 */
export const CONTRACT_EMAIL_DOMAIN = "lilo-contract.test";

export function contractEmail(label: string): string {
  return `lilo-contract-${label}-${randomUUID().slice(0, 8)}@${CONTRACT_EMAIL_DOMAIN}`;
}

/** The external id `ensureOrganization` in packages/auth-session gives a user's organization. */
export function personalExternalId(userId: string): string {
  return `signup:${userId}`;
}

/** The slice of the WorkOS SDK cleanup uses, so tests can supply a recording one. */
export interface StagingAdmin {
  readonly userManagement: {
    deleteUser(userId: string): Promise<void>;
    listUsers(options: { readonly limit: number }): Promise<{
      autoPagination(): Promise<
        readonly { readonly id: string; readonly email: string; readonly createdAt: string }[]
      >;
    }>;
  };
  readonly organizations: {
    deleteOrganization(id: string): Promise<void>;
    getOrganizationByExternalId(externalId: string): Promise<{ readonly id: string }>;
  };
}

function notFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

async function ignoringNotFound(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if (!notFound(error)) throw error;
  }
}

/**
 * Deletes a user and the personal organization the sign-in gave them.
 *
 * Every organization the suite creates carries `personalExternalId(userId)`, as the application's
 * own would, so the user id alone finds everything. Either may already be gone.
 */
export async function removeUser(admin: StagingAdmin, userId: string): Promise<void> {
  let organizationId: string | null = null;
  try {
    ({ id: organizationId } = await admin.organizations.getOrganizationByExternalId(
      personalExternalId(userId),
    ));
  } catch (error) {
    if (!notFound(error)) throw error;
  }
  if (organizationId !== null) {
    const id = organizationId;
    await ignoringNotFound(() => admin.organizations.deleteOrganization(id));
  }
  await ignoringNotFound(() => admin.userManagement.deleteUser(userId));
}

/** Removes every user given, and reports every failure together rather than stopping at one. */
export async function removeUsers(admin: StagingAdmin, userIds: Iterable<string>): Promise<void> {
  const settled = await Promise.allSettled([...userIds].map((userId) => removeUser(admin, userId)));
  const failures = settled.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, `Could not clean up ${failures.length} staging user(s).`);
  }
}

/** Old enough that no run still in progress, such as a pull request's beside the schedule's, owns it. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Removes what an earlier run left behind: a runner killed mid-test never reaches its cleanup.
 *
 * Only addresses on the contract domain are candidates, and only once they are an hour old.
 * Returns how many users it removed.
 */
export async function sweepStale(admin: StagingAdmin, now = Date.now()): Promise<number> {
  const users = await (await admin.userManagement.listUsers({ limit: 100 })).autoPagination();
  const stale = users
    .filter((user) => user.email.endsWith(`@${CONTRACT_EMAIL_DOMAIN}`))
    .filter((user) => now - Date.parse(user.createdAt) > STALE_AFTER_MS)
    .map((user) => user.id);
  await removeUsers(admin, stale);
  return stale.length;
}
