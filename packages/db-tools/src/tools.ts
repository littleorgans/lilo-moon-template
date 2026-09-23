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
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

/** Redact both a connection string and passwords a tool may print separately. */
export function redactUrls(text: string, values: readonly string[]): string {
  const secrets = values
    .flatMap((value) => {
      try {
        const url = new URL(value);
        if (!/^(postgres|postgresql):$/.test(url.protocol)) return [value];
        const encoded = [url.password, ...url.searchParams.getAll("password")];
        return [
          value,
          url.href,
          ...encoded,
          ...encoded.map((part) => {
            try {
              return decodeURIComponent(part);
            } catch {
              return part;
            }
          }),
        ];
      } catch {
        return [value];
      }
    })
    .filter(Boolean)
    .toSorted((a, b) => b.length - a.length);
  return secrets.reduce((output, secret) => output.replaceAll(secret, "***"), text);
}

/** Capture output so tools cannot echo connection credentials into the caller's logs. */
export function runTool(command: string, args: readonly string[], options: ToolOptions): void {
  const env = options.env ?? process.env;
  const urls = args.filter(
    (arg, index) => args[index - 1] === "--url" || args[index - 1] === "--dev-url",
  );
  if (env["DATABASE_URL"]) urls.push(env["DATABASE_URL"]);
  const result = spawnSync(command, args, {
    env: { ...env },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  (options.stdout ?? ((text) => process.stdout.write(text)))(redactUrls(result.stdout ?? "", urls));
  (options.stderr ?? ((text) => process.stderr.write(text)))(redactUrls(result.stderr ?? "", urls));
  if (result.error !== undefined && "code" in result.error && result.error.code === "ENOENT") {
    throw new MissingToolError(options.missing);
  }
  if (result.status !== 0) {
    const how = result.error?.message ?? `exited with ${result.status ?? result.signal}`;
    throw new ToolFailedError(redactUrls(`${command} ${args[0] ?? ""} ${how}`, urls));
  }
}
