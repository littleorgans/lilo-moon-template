import { spawnSync } from "node:child_process";

import type { Env } from "./postgres.js";

/** A tool the command needs is not installed. The message says how to install it. */
export class MissingToolError extends Error {}

/** A tool ran and reported failure; it has already printed why. */
export class ToolFailedError extends Error {}

export interface ToolOptions {
  readonly env?: Env | undefined;
  /** Message for a missing command, naming how to install it. */
  readonly missing: string;
}

/** Runs a command with inherited output, and throws rather than exiting on failure. */
export function runTool(command: string, args: readonly string[], options: ToolOptions): void {
  const result = spawnSync(command, args, {
    env: { ...(options.env ?? process.env) },
    stdio: "inherit",
  });
  if (result.error !== undefined && "code" in result.error && result.error.code === "ENOENT") {
    throw new MissingToolError(options.missing);
  }
  if (result.status !== 0) {
    const how = result.error?.message ?? `exited with ${result.status ?? result.signal}`;
    throw new ToolFailedError(`${command} ${args[0] ?? ""} ${how}`);
  }
}
