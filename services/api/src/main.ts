import type { EventEmitter } from "node:events";

import { createVerifier } from "@littleorgans/auth";
import type { Environment } from "@littleorgans/auth-http";

import { readConfig } from "./server/config.ts";
import { openDatabase } from "./server/database.ts";
import { jsonLog } from "./server/log.ts";
import type { Log } from "./server/log.ts";
import { startService } from "./server/service.ts";
import type { RunningService } from "./server/service.ts";

/** The parts of `process` the entry point touches, so a test can hand it an `EventEmitter`. */
export interface Host extends Pick<EventEmitter, "once"> {
  readonly env: Environment;
  exitCode?: number | string | null | undefined;
}

/**
 * SIGTERM, from an orchestrator, and SIGINT, from Ctrl-C, both stop the service gracefully. The
 * process then exits on its own once nothing is left open, which is the proof nothing leaked.
 *
 * `once` on purpose: a second signal reaches Node's default handler and ends the process at once,
 * which is what someone pressing Ctrl-C twice means.
 */
export function stopOnSignals(service: RunningService, host: Host, log: Log): void {
  const stop = async (signal: string) => {
    log({ level: "info", event: "signal", signal });
    try {
      await service.stop();
    } catch (error) {
      log({ level: "error", event: "shutdown_failed", name: errorName(error) });
      host.exitCode = 1;
    }
  };
  for (const signal of ["SIGTERM", "SIGINT"]) {
    host.once(signal, () => {
      void stop(signal);
    });
  }
}

// The name, never the message: a driver's message can quote a connection string or a row.
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Reads the environment, starts serving and stops on a signal. An invalid environment is one
 * `config_invalid` line and exit code 1, before anything listens.
 */
export async function run(host: Host, log: Log): Promise<RunningService | null> {
  const config = readConfig(host.env, log);
  if (config === null) {
    host.exitCode = 1;
    return null;
  }
  const service = await startService({
    port: config.port,
    // Once per process: the verifier caches the provider's keys.
    verify: createVerifier(config.verifier),
    database: openDatabase(config.databaseUrl),
    log,
  });
  stopOnSignals(service, host, log);
  log({ level: "info", event: "listening", port: service.port });
  return service;
}

if (import.meta.main) await run(process, jsonLog);
