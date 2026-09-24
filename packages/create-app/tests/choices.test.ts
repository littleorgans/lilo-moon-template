import { describe, expect, it } from "vitest";

import type { Request } from "../src/choices.ts";
import { resolveChoices } from "../src/choices.ts";

const defaults = { web: "web", webPort: 5199, service: "api", servicePort: 8787 };

const request = (overrides: Partial<Request>): Request => ({
  directory: "acme",
  name: undefined,
  web: false,
  webName: undefined,
  webPort: undefined,
  organizationPolicy: undefined,
  service: false,
  serviceName: undefined,
  servicePort: undefined,
  database: undefined,
  ...overrides,
});

const resolve = (overrides: Partial<Request>) =>
  resolveChoices(request(overrides), defaults, "/work");

const errors = (overrides: Partial<Request>) => {
  const resolution = resolve(overrides);
  return resolution.kind === "invalid" ? resolution.errors : [];
};

describe("resolveChoices", () => {
  it("bounds role identifiers and rejects directory control characters", () => {
    expect(errors({ service: true, name: "a".repeat(32), serviceName: "b".repeat(31) })).toEqual([
      expect.stringContaining("longer than Postgres's 63 characters"),
    ]);
    expect(errors({ web: true, organizationPolicy: "personal", name: "a".repeat(80) })).toEqual([]);
    for (const name of ["pg", "pg-tools"]) {
      expect(errors({ service: true, name }).join()).toContain("which Postgres reserves");
    }
    expect(resolve({ service: true, name: "pgtools" }).kind).toBe("valid");
    expect(errors({ service: true, directory: "bad\npath", name: "valid" }).join()).toContain(
      "control characters",
    );
    expect(resolve({ service: true, name: "a".repeat(31), serviceName: "b".repeat(31) }).kind).toBe(
      "valid",
    );
    expect(errors({ service: true, serviceName: "api-" }).join()).toContain(
      "end with a letter or digit",
    );
    expect(errors({ service: true, name: "littleorgans" }).join()).toContain("reserved scope");
    for (const serviceName of ["dist", "build", "out", "coverage"]) {
      expect(errors({ service: true, serviceName }).join()).toContain(
        "ignored as generated output",
      );
    }
    for (const serviceName of ["../escape", "x;touch", "x'", "x\\escape", "$(id)"]) {
      expect(resolve({ service: true, serviceName }).kind).toBe("invalid");
    }
  });

  it("takes the reference's names and ports, and says which it took", () => {
    const resolution = resolve({ web: true, organizationPolicy: "existing" });
    expect(resolution).toStrictEqual({
      kind: "valid",
      choices: {
        directory: "acme",
        project: "acme",
        web: { name: "web", port: 5199, organizationPolicy: "existing" },
        service: null,
        database: false,
        defaulted: [
          "--name acme, the directory's name",
          "--web-name web",
          "--web-port 5199",
          "no database (--db)",
        ],
      },
    });
  });

  it("keeps what the person chose and reports no default for it", () => {
    const resolution = resolve({
      directory: "./projects/acme",
      name: "acme-co",
      web: true,
      webName: "portal",
      webPort: "5300",
      organizationPolicy: "personal",
      service: true,
      serviceName: "billing",
      servicePort: "8800",
    });
    expect(resolution).toMatchObject({
      kind: "valid",
      choices: {
        project: "acme-co",
        web: { name: "portal", port: 5300, organizationPolicy: "personal" },
        service: { name: "billing", port: 8800 },
        database: true,
        defaulted: [],
      },
    });
  });

  it("gives a service the database it cannot run without", () => {
    expect(resolve({ service: true })).toMatchObject({ choices: { database: true } });
    expect(errors({ service: true, database: false })).toStrictEqual([
      "--no-db cannot be used with --service",
    ]);
  });

  it("requires a directory, a part and an organization policy for a web app", () => {
    expect(errors({ directory: undefined, web: false })).toStrictEqual([
      "Name the project directory",
      "Choose --web, --service or both",
    ]);
    expect(errors({ web: true })).toStrictEqual([
      "--organization-policy is required with --web: personal or existing",
    ]);
    expect(errors({ web: true, organizationPolicy: "shared" })).toStrictEqual([
      "--organization-policy must be personal or existing: shared",
    ]);
  });

  it("refuses names that cannot be a scope, image or Moon id, and ids already taken", () => {
    expect(errors({ directory: "Acme", web: true, organizationPolicy: "personal" })).toStrictEqual([
      "--name must be lowercase letters, digits and dashes, starting with a letter: Acme",
    ]);
    expect(errors({ service: true, serviceName: "root" })).toStrictEqual([
      "--service-name root is a Moon project id the workspace already uses",
    ]);
  });

  it("refuses ports outside 1 to 65535, and a part's flags without the part", () => {
    expect(errors({ service: true, servicePort: "65536" })).toStrictEqual([
      "--service-port must be a port from 1 to 65535: 65536",
    ]);
    expect(errors({ service: true, servicePort: "80a" })).toHaveLength(1);
    expect(
      errors({ service: true, webPort: "5199", organizationPolicy: "personal" }),
    ).toStrictEqual(["--web-port needs --web", "--organization-policy needs --web"]);
    expect(errors({ web: true, organizationPolicy: "personal", serviceName: "api" })).toStrictEqual(
      ["--service-name needs --service"],
    );
  });

  it("keeps the web app and the service apart", () => {
    expect(
      errors({
        web: true,
        organizationPolicy: "personal",
        service: true,
        webName: "app",
        serviceName: "app",
        webPort: "8000",
        servicePort: "8000",
      }),
    ).toStrictEqual([
      "The web app and the service are both named app",
      "The web app and the service both use port 8000",
    ]);
  });
});
