import { expect, it } from "vitest";

import { readConfig } from "../../src/server/config.ts";
import { recordingLog } from "../support.ts";

it("returns the validated configuration", () => {
  const { log, records } = recordingLog();
  const config = readConfig(
    {
      PORT: "8787",
      DATABASE_URL: "postgres://api:pw@db:5432/app",
      WORKOS_CLIENT_ID: "client_ABC123",
    },
    log,
  );

  expect(config).toMatchObject({ port: 8787, workosClientId: "client_ABC123" });
  expect(records).toHaveLength(0);
});

it("logs every problem once, without any value, and returns null", () => {
  const { log, records } = recordingLog();
  const config = readConfig(
    { PORT: "http", DATABASE_URL: "https://db.example/app?password=hunter2", WORKOS_CLIENT_ID: "" },
    log,
  );

  expect(config).toBeNull();
  expect(records).toStrictEqual([
    {
      level: "error",
      event: "config_invalid",
      problems: [
        "PORT must be an integer from 1 to 65535",
        "DATABASE_URL must be a postgres:// or postgresql:// URL",
        "WORKOS_CLIENT_ID is missing",
      ],
    },
  ]);
  expect(JSON.stringify(records)).not.toContain("hunter2");
});

it("lets anything but a ConfigError propagate", () => {
  const unreadable = new Proxy(
    {},
    {
      get: () => {
        throw new RangeError("environment unavailable");
      },
    },
  );
  expect(() => readConfig(unreadable, recordingLog().log)).toThrow(RangeError);
});
