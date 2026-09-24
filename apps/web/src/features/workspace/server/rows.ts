import { accounts, profiles } from "@littleorgans/drizzle-schema";

import type { Transaction } from "../../../server/database.js";
import type { VisibleRows } from "../model.js";

/**
 * Counts the rows this Principal can see, from inside the scoped transaction.
 *
 * Counted under row level security rather than from outside it, so the numbers are what the
 * policies admit and not what happens to exist. Seeing one of each after `ensureIdentityRows` is
 * the proof that the policies let their owner read them back.
 */
export async function countVisibleRows(tx: Transaction): Promise<VisibleRows> {
  return {
    accounts: await tx.$count(accounts),
    profiles: await tx.$count(profiles),
  };
}
