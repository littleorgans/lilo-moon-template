import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { getRequestListener } from "@hono/node-server";
import type { Verifier } from "@littleorgans/auth";

import type { ScopedRunner } from "../features/accounts/account.ts";
import { createApp } from "./app.ts";
import type { Log } from "./log.ts";

/** The slice of `Database` from `@littleorgans/db` the service uses. */
export interface ServiceDatabase {
  readonly withPrincipal: ScopedRunner;
  close(): Promise<void>;
}

export interface ServiceDeps {
  /** 0 picks a free port, which tests use. `PORT` is validated to 1–65535 before it gets here. */
  readonly port: number;
  readonly verify: Verifier;
  readonly database: ServiceDatabase;
  readonly log: Log;
  /**
   * How long in-flight requests get to finish once shutdown starts, before their connections are
   * cut. Keep it under the orchestrator's own grace period (30 seconds in Kubernetes), so the
   * database pool still closes cleanly before a SIGKILL.
   */
  readonly graceMs?: number;
}

export interface RunningService {
  readonly port: number;
  /** Stops accepting, lets in-flight requests finish, then closes the pool. Safe to call twice. */
  stop(): Promise<void>;
}

// close() stops accepting and, since Node 19, drops idle keep-alive connections. It calls back when
// the last active one ends, which a slow client could postpone indefinitely, so the grace period
// ends in closeAllConnections(). Its only error is "not running", which `stop` running once rules
// out, so the callback's argument is not read.
async function drain(server: Server, graceMs: number): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
  try {
    await closed;
  } finally {
    clearTimeout(deadline);
  }
}

/** Composes the app over a real database and starts listening. */
export async function startService({
  port,
  verify,
  database,
  log,
  graceMs = 10_000,
}: ServiceDeps): Promise<RunningService> {
  const app = createApp({
    verify,
    run: async (principal, body) => await database.withPrincipal(principal, body),
    log,
  });
  // The listener settles its own promise: it answers every error itself, as a 500 at worst.
  const listener = getRequestListener(app.fetch);
  const server = createServer((incoming, outgoing) => {
    void listener(incoming, outgoing);
  });
  server.listen(port);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");

  let stopping: Promise<void> | undefined;
  const stop = async () => {
    log({ level: "info", event: "shutdown_started" });
    // The pool closes after the server, never before: a request still running needs its client.
    await drain(server, graceMs);
    await database.close();
    log({ level: "info", event: "shutdown_complete" });
  };
  return {
    port: address.port,
    stop: () => (stopping ??= stop()),
  };
}
