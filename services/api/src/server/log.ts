/**
 * One field of a log record. Scalars and string lists only, so a `Request`, its `Headers` or an
 * error object cannot be handed to the logger whole: the type refuses it, and a caller has to pick
 * the fields that are safe to keep. The auth-http README asks for exactly that.
 */
export type LogValue = string | number | boolean | null | readonly string[];

export interface LogRecord {
  readonly level: "info" | "warn" | "error";
  /** A fixed name for what happened, such as `request` or `auth_rejected`. */
  readonly event: string;
  readonly [field: string]: LogValue | undefined;
}

export type Log = (record: LogRecord) => void;

/** One JSON object per line, errors on stderr and everything else on stdout. */
export const jsonLog: Log = (record) => {
  const line = `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`;
  (record.level === "error" ? process.stderr : process.stdout).write(line);
};
