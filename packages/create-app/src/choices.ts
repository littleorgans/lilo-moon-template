import { basename, resolve } from "node:path";

import type { Defaults, Parts } from "./template.ts";

export const ORGANIZATION_POLICIES = ["personal", "existing"] as const;

export type OrganizationPolicy = (typeof ORGANIZATION_POLICIES)[number];

export interface WebApp {
  readonly name: string;
  readonly port: number;
  readonly organizationPolicy: OrganizationPolicy;
}

export interface Service {
  readonly name: string;
  readonly port: number;
}

export interface Choices {
  /** Where the project goes, as the person gave it. */
  readonly directory: string;
  /** The root package name, the scope of the project's own packages, and its role prefix. */
  readonly project: string;
  readonly web: WebApp | null;
  readonly service: Service | null;
  readonly database: boolean;
  /** Each choice taken from a default, with the flag that changes it. */
  readonly defaulted: readonly string[];
}

/** What the command line and any answers supplied, before validation. */
export interface Request {
  readonly directory: string | undefined;
  readonly name: string | undefined;
  readonly web: boolean;
  readonly webName: string | undefined;
  readonly webPort: string | undefined;
  readonly organizationPolicy: string | undefined;
  readonly service: boolean;
  readonly serviceName: string | undefined;
  readonly servicePort: string | undefined;
  readonly database: boolean | undefined;
}

export type Resolution =
  | { readonly kind: "valid"; readonly choices: Choices }
  | { readonly kind: "invalid"; readonly errors: readonly string[] };

// Lowercase, starting with a letter: a valid npm scope, Docker image name and Moon project id,
// and, with dashes as underscores, an unquoted Postgres role name.
const NAME = /^[a-z][a-z0-9-]*$/;

/** Moon ids the workspace already uses: the root project and the typed schema package. */
const TAKEN = new Set(["root", "drizzle-schema"]);

export function partsOf(choices: Choices): Parts {
  return {
    web: choices.web !== null,
    service: choices.service !== null,
    database: choices.database,
  };
}

function isPolicy(value: string): value is OrganizationPolicy {
  return ORGANIZATION_POLICIES.some((policy) => policy === value);
}

export function resolveChoices(request: Request, defaults: Defaults, cwd: string): Resolution {
  const errors: string[] = [];
  const defaulted: string[] = [];

  const checkName = (flag: string, value: string): string => {
    if (!NAME.test(value)) {
      errors.push(
        `${flag} must be lowercase letters, digits and dashes, starting with a letter: ${value}`,
      );
    } else if (TAKEN.has(value)) {
      errors.push(`${flag} ${value} is a Moon project id the workspace already uses`);
    }
    return value;
  };
  const name = (flag: string, given: string | undefined, fallback: string): string => {
    if (given === undefined) defaulted.push(`${flag} ${fallback}`);
    return checkName(flag, given ?? fallback);
  };
  const port = (flag: string, given: string | undefined, fallback: number): number => {
    if (given === undefined) {
      defaulted.push(`${flag} ${fallback}`);
      return fallback;
    }
    const value = Number(given);
    if (!/^\d+$/.test(given) || value < 1 || value > 65_535) {
      errors.push(`${flag} must be a port from 1 to 65535: ${given}`);
    }
    return value;
  };
  const without = (part: string, flags: Record<string, string | undefined>) => {
    for (const [flag, value] of Object.entries(flags)) {
      if (value !== undefined) errors.push(`${flag} needs ${part}`);
    }
  };

  const directory = request.directory ?? "";
  if (directory === "") errors.push("Name the project directory");
  const project = checkName("--name", request.name ?? basename(resolve(cwd, directory)));
  if (request.name === undefined) defaulted.push(`--name ${project}, the directory's name`);

  if (!request.web && !request.service) errors.push("Choose --web, --service or both");

  let web: WebApp | null = null;
  if (request.web) {
    const policy = request.organizationPolicy;
    if (policy === undefined) {
      errors.push(
        `--organization-policy is required with --web: ${ORGANIZATION_POLICIES.join(" or ")}`,
      );
    } else if (!isPolicy(policy)) {
      errors.push(`--organization-policy must be ${ORGANIZATION_POLICIES.join(" or ")}: ${policy}`);
    }
    web = {
      name: name("--web-name", request.webName, defaults.web),
      port: port("--web-port", request.webPort, defaults.webPort),
      organizationPolicy: policy !== undefined && isPolicy(policy) ? policy : "personal",
    };
  } else {
    without("--web", {
      "--web-name": request.webName,
      "--web-port": request.webPort,
      "--organization-policy": request.organizationPolicy,
    });
  }

  let service: Service | null = null;
  if (request.service) {
    service = {
      name: name("--service-name", request.serviceName, defaults.service),
      port: port("--service-port", request.servicePort, defaults.servicePort),
    };
    // loadServiceConfig requires DATABASE_URL, so a service always has the database.
    if (request.database === false) errors.push("--no-db cannot be used with --service");
  } else {
    without("--service", {
      "--service-name": request.serviceName,
      "--service-port": request.servicePort,
    });
  }

  if (web !== null && service !== null) {
    if (web.name === service.name)
      errors.push(`The web app and the service are both named ${web.name}`);
    if (web.port === service.port)
      errors.push(`The web app and the service both use port ${web.port}`);
  }

  const database = service !== null || request.database === true;
  if (service === null && request.database === undefined) defaulted.push("no database (--db)");

  if (errors.length > 0) return { kind: "invalid", errors };
  return {
    kind: "valid",
    choices: { directory, project, web, service, database, defaulted },
  };
}
