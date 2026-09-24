import type { Principal } from "@littleorgans/auth";
import { accounts, profiles } from "@littleorgans/drizzle-schema";

import type { Transaction } from "./database.js";

/**
 * Creates the caller's `accounts` and `profiles` rows if they do not exist yet.
 *
 * Identity lives with the auth vendor, so these rows are created just in time, from the verified
 * Principal, inside the scoped transaction: the insert policies admit only the caller's own
 * organization and user. Idempotent, so it is safe on every request, but it is a write: call it
 * where a signed-in person first arrives (the `/app` loader here), never from a read.
 *
 * A Principal without an organization gets a profile and no account. See docs/user-entity.md.
 */
export async function ensureIdentityRows(tx: Transaction, principal: Principal): Promise<void> {
  if (principal.orgId !== null) {
    await tx
      .insert(accounts)
      .values({ workosOrgId: principal.orgId })
      .onConflictDoNothing({ target: accounts.workosOrgId });
  }
  await tx
    .insert(profiles)
    .values({ workosUserId: principal.userId })
    .onConflictDoNothing({ target: profiles.workosUserId });
}
