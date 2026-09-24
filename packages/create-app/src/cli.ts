// The command line. Every choice is a flag, so a skill or a script runs it without a terminal.
// A person at a terminal is asked only for what has no default: the directory, what to create,
// the organization policy, and whether a web app gets a database.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

import type { Request } from "./choices.ts";
import { ORGANIZATION_POLICIES, resolveChoices } from "./choices.ts";
import { report } from "./report.ts";
import { scaffold, TargetNotEmptyError } from "./scaffold.ts";
import type { Template } from "./template.ts";

export interface CliIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Asks a question at a terminal. Absent when no one is there to answer. */
  readonly ask: ((question: string) => Promise<string>) | undefined;
  readonly template: () => Template;
}

export const exitCodes = { created: 0, failed: 1, usage: 2 } as const;

function usage(template: Template): string {
  const { defaults } = template;
  return `Usage: create-app <directory> [options]

Starts a Moon workspace on the published @littleorgans packages at ${template.version}: a
TanStack Start web app, a TypeScript service, or both, with an optional Postgres database.
Run it as \`pnpm create @littleorgans/app\` or \`npm create @littleorgans/app\`.

Options:
  --web                           Add a web app under apps/<name>.
  --web-name <name>               Its directory and Moon project id. Default: ${defaults.web}.
  --web-port <port>               Its dev and preview port, which the OAuth callback names.
                                  Default: ${defaults.webPort}.
  --organization-policy <policy>  ${ORGANIZATION_POLICIES.join(" or ")}: whether each new user gets an organization
                                  at first sign-in. Required with --web.
  --service                       Add an HTTP service under services/<name>. Includes --db.
  --service-name <name>           Default: ${defaults.service}.
  --service-port <port>           Default: ${defaults.servicePort}.
  --db, --no-db                   Add Postgres: the identity migrations, the Atlas schema and the
                                  database gates. Default: none for a web app alone.
  --name <name>                   The project's name and the scope of its own packages.
                                  Default: the directory's name.
  -h, --help                      Show this help.

Names are lowercase letters, digits and dashes, starting with a letter and ending with a letter or
digit. The directory must be new or empty. Nothing is installed: the command prints the steps
that follow.

Exit codes: 0 created, 1 failed, 2 usage error.
`;
}

const options = {
  web: { type: "boolean" },
  "web-name": { type: "string" },
  "web-port": { type: "string" },
  "organization-policy": { type: "string" },
  service: { type: "boolean" },
  "service-name": { type: "string" },
  "service-port": { type: "string" },
  db: { type: "boolean" },
  name: { type: "string" },
  help: { type: "boolean", short: "h" },
} satisfies ParseArgsConfig["options"];

class AnswerError extends Error {}

/** Fills in, from a person at a terminal, the choices that have no default. */
async function complete(
  request: Request,
  ask: (question: string) => Promise<string>,
): Promise<Request> {
  const answer = async (question: string) => (await ask(question)).trim().toLowerCase();
  let completed = request;
  if (completed.directory === undefined) {
    completed = { ...completed, directory: (await ask("Project directory: ")).trim() };
  }
  if (!completed.web && !completed.service) {
    const kind = await answer("Create a web app, a service, or both? (web/service/both) ");
    if (!["web", "service", "both"].includes(kind)) {
      throw new AnswerError("Choose web, service or both.");
    }
    completed = { ...completed, web: kind !== "service", service: kind !== "web" };
  }
  if (completed.web && completed.organizationPolicy === undefined) {
    const policy = await answer(
      `Organization policy: ${ORGANIZATION_POLICIES.join(" or ")}? personal gives each new user an organization at first sign-in. `,
    );
    completed = { ...completed, organizationPolicy: policy };
  }
  if (!completed.service && completed.database === undefined) {
    const database = await answer("Add a Postgres database? (y/N) ");
    if (!["", "y", "yes", "n", "no"].includes(database)) {
      throw new AnswerError("Answer yes or no to adding a database.");
    }
    completed = { ...completed, database: database === "y" || database === "yes" };
  }
  return completed;
}

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    });
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\nRun create-app --help for the options.\n`,
    );
    return exitCodes.usage;
  }
  const { values, positionals } = parsed;
  const template = io.template();
  if (values.help === true) {
    io.stdout(usage(template));
    return exitCodes.created;
  }
  if (positionals.length > 1) {
    io.stderr(
      `Give one directory, not ${positionals.length}.\nRun create-app --help for the options.\n`,
    );
    return exitCodes.usage;
  }

  const request: Request = {
    directory: positionals[0],
    name: values.name,
    web: values.web === true,
    webName: values["web-name"],
    webPort: values["web-port"],
    organizationPolicy: values["organization-policy"],
    service: values.service === true,
    serviceName: values["service-name"],
    servicePort: values["service-port"],
    database: values.db,
  };
  let completed = request;
  try {
    if (io.ask !== undefined) completed = await complete(request, io.ask);
  } catch (error) {
    if (!(error instanceof AnswerError)) throw error;
    io.stderr(`${error.message}\nRun create-app --help for the options.\n`);
    return exitCodes.usage;
  }
  const resolution = resolveChoices(completed, template.defaults, io.cwd);
  if (resolution.kind === "invalid") {
    io.stderr(`${resolution.errors.join("\n")}\nRun create-app --help for the options.\n`);
    return exitCodes.usage;
  }

  const { choices } = resolution;
  const target = resolve(io.cwd, choices.directory);
  try {
    scaffold(template, choices, target);
  } catch (error) {
    if (!(error instanceof TargetNotEmptyError)) throw error;
    io.stderr(`${error.message}\n`);
    return exitCodes.failed;
  }
  io.stdout(report(choices, template, target));
  return exitCodes.created;
}

/** The template the build wrote beside this module. */
function packedTemplate(): Template {
  return JSON.parse(readFileSync(new URL("template.json", import.meta.url), "utf8"));
}

/** The process's own streams, with questions only when a person is at a terminal. */
export function processIo(): CliIo {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  return {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    ask: interactive
      ? async (question) => {
          const terminal = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await terminal.question(question);
          } finally {
            terminal.close();
          }
        }
      : undefined,
    template: packedTemplate,
  };
}
