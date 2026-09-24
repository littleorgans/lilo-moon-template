import * as schema from "@littleorgans/drizzle-schema";
import { drizzle } from "drizzle-orm/pg-proxy";

import type { Transaction } from "../src/server/database.js";

export interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * A real Drizzle database over the generated schema, with `answer` as its driver.
 *
 * Every statement is recorded and answered by `answer`, which returns rows as the driver would:
 * objects for a statement with no select list (an insert without RETURNING, a `$count`), arrays of
 * column values in select order for anything else. The queries under test are the ones production
 * runs; only the database behind them is replaced.
 */
export function recordingTransaction(
  answer: (statement: Statement) => readonly unknown[] = () => [],
): { readonly tx: Transaction; readonly statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = drizzle(
    (sql, params) => {
      const statement = { sql, params };
      statements.push(statement);
      return Promise.resolve({ rows: [...answer(statement)] });
    },
    { schema },
  );
  return { tx, statements };
}
