// What the command prints once the files are written: what it made, which defaults it took, and
// the steps no command can take for the person. The steps follow the adoption guides.

import { resolve } from "node:path";

import type { Choices } from "./choices.ts";
import type { Template } from "./template.ts";

/** A Postgres role name for one process: the project and the app, with dashes as underscores. */
export function loginRole(project: string, app: string): string {
  return `${project}_${app}`.replaceAll("-", "_");
}

/** POSIX shell literal, including whitespace, quotes and command substitutions. */
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

const indent = (lines: readonly string[], depth: number) =>
  lines.map((line) => (line === "" ? line : `${" ".repeat(depth)}${line}`));

function created(choices: Choices): string[] {
  const lines: string[] = [];
  if (choices.web !== null) {
    const { name, port, organizationPolicy } = choices.web;
    lines.push(`web app    apps/${name}, port ${port}, organization policy ${organizationPolicy}`);
  }
  if (choices.service !== null) {
    lines.push(`service    services/${choices.service.name}, port ${choices.service.port}`);
  }
  lines.push(
    choices.database
      ? "database   db/: the identity migrations, their Atlas schema and the database gates"
      : "database   none; the typed schema in db/drizzle stays for when you add one",
  );
  return lines;
}

function databaseSteps(choices: Choices): string[] {
  const apps = [
    ...(choices.web === null ? [] : [`apps/${choices.web.name}`]),
    ...(choices.service === null ? [] : [`services/${choices.service.name}`]),
  ];
  const roles = apps.map((app) => ({
    app,
    role: loginRole(choices.project, app.split("/")[1] ?? app),
  }));
  return [
    "Set up each real database (Postgres 16 or later). As the migration owner, apply the migrations,",
    "then give every process its own login role holding the shipped grant:",
    "",
    '  (export LC_ALL=C; for file in db/migrations/*.sql; do psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$file" || exit; done)',
    ...roles.flatMap(({ app, role }) => [
      `  psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;"`,
      `  psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "\\\\password ${role}"`,
      `  psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v login_role=${role} -f ${app}/node_modules/@littleorgans/db/grants/login-role.sql`,
    ]),
    "",
    `DATABASE_URL names ${roles.map(({ role }) => role).join(" or ")}, never the migration owner or a superuser:`,
    "without the grant every scoped query fails with SQLSTATE 42501.",
  ];
}

export function report(choices: Choices, template: Template, target: string): string {
  const guides = `https://github.com/${template.repository}/blob/v${template.version}/docs/guides`;
  const steps: string[][] = [
    [
      "Commit, then install. The install turns on the Git hooks, and Moon needs a commit:",
      "",
      `  cd ${shellQuote(resolve(target))}`,
      '  git init -b main && git add -A && git commit -m "chore: start from @littleorgans/create-app"',
      "  pnpm install",
      '  git add pnpm-lock.yaml && git commit -m "chore: lock dependencies"',
    ],
  ];
  if (choices.web !== null) {
    const callback = `http://localhost:${choices.web.port}/callback`;
    steps.push(
      [
        `Register ${callback} under Redirects on your WorkOS application, and your public`,
        "https:// callback before you deploy. Sign-in fails at the provider until you do.",
      ],
      [
        "cp .env.example .env.local, then fill in WORKOS_CLIENT_ID, WORKOS_API_KEY,",
        `WORKOS_REDIRECT_URI=${callback} and a WORKOS_COOKIE_PASSWORD of 32 or more`,
        `characters (openssl rand -base64 32)${choices.database ? ", and DATABASE_URL" : ""}.`,
      ],
    );
  } else {
    steps.push([
      "cp .env.example .env.local, then fill in WORKOS_CLIENT_ID, the client of the web app that",
      "calls this service, and DATABASE_URL.",
    ]);
  }
  if (choices.database) steps.push(databaseSteps(choices));
  const run = [
    ...(choices.web === null ? [] : [`moon run ${choices.web.name}:dev`]),
    ...(choices.service === null ? [] : [`moon run ${choices.service.name}:dev`]),
  ];
  steps.push([
    "Run every gate once: moon ci --force. (Plain moon ci checks only what the last commit touched.)",
    `It must pass before you change anything.${choices.database ? " Without Docker the database checks skip locally; CI runs them." : ""}`,
    `Then start it: ${run.join(", ")}.`,
  ]);
  if (choices.web !== null) {
    steps.push([
      `Replace the product name and sign-in copy in apps/${choices.web.name}/src/server/product.ts.`,
    ]);
  }

  const guide = choices.web === null ? "adopt-service.md" : "adopt-web-app.md";
  return [
    `Created ${choices.project} in ${target} from @littleorgans/create-app ${template.version}.`,
    "",
    ...indent(created(choices), 2),
    "",
    ...(choices.defaulted.length === 0
      ? []
      : ["Defaults taken (the flag changes each):", "", ...indent(choices.defaulted, 2), ""]),
    "Next:",
    "",
    ...steps.flatMap((lines, index) =>
      indent([`${index + 1}. ${lines[0] ?? ""}`], 2).concat(indent(lines.slice(1), 5), [""]),
    ),
    `Each step is explained in ${guides}/${guide}.`,
    "",
  ].join("\n");
}
