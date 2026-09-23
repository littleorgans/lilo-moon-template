// The db-tools command line: the database gates a project runs from its task runner, each against
// the checkout's own Postgres container. Paths are relative to the working directory, and the
// defaults are the layout the adoption guides set up: db/migrations, db/schema.sql and
// db/drizzle/_generated.

import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

import { applyMigrations, atlasDiff, atlasLint, requireAtlas } from "./atlas.js";
import { exitCodes, main as rlsVerify } from "./cli.js";
import type { CliIo } from "./cli.js";
import { drizzleKitBin, drizzleSchemaIsCurrent, generateDrizzleSchema } from "./drizzle.js";
import { dockerStatus, removePostgres, startPostgres, withPostgres } from "./postgres.js";
import type { PostgresOptions } from "./postgres.js";
import { MissingToolError, ToolFailedError } from "./tools.js";

const usage = `Usage: db-tools <command> [options]

Commands:
  atlas-diff        Write a versioned migration that brings the migrations to the desired schema.
  atlas-lint        Lint new migrations with Atlas. A check.
  atlas-apply       Apply pending migrations to DATABASE_URL (or --url).
  drizzle-generate  Write the typed Drizzle schema the migrations produce.
  drizzle-check     Fail if the typed Drizzle schema is stale or hand-edited. A check.
  rls-verify        Run rls-verify --disposable against the checkout's container. A check.
  clean             Remove the checkout's Postgres container.

Options:
  --migrations <dir>  Versioned migrations. Default: db/migrations.
  --to <file>         atlas-diff: the desired-state schema. Default: db/schema.sql.
  --git-base <ref>    atlas-lint: lint migrations added since this ref. Default: MOON_BASE, else
                      only the latest migration.
  --url <url>         atlas-apply: the target database. Default: DATABASE_URL.
  --out <dir>         drizzle-*: the generated artifact. Default: db/drizzle/_generated.
  --seed <file>       rls-verify: SQL run after the migrations.
  --schema, --role    rls-verify: passed through; see rls-verify --help.
  --root <dir>        The checkout that owns the container. Default: the nearest ancestor holding
                      pnpm-workspace.yaml, .moon or .git.
  --port <port>       The container's host port. Default: LILO_PG_PORT, else derived from --root.
  --image <image>     The container's image. Default: postgres:17-alpine.
  -h, --help          Show this help.

Every command but atlas-apply and clean runs against a database in a Docker container, one per
checkout on a pinned port. Checks skip with a message when Docker is unavailable, unless CI is set;
in CI they fail. atlas must be on PATH; drizzle-kit must be installed beside this package.

Exit codes: 0 done, 1 a check or tool failed, 2 usage error, 3 a tool, Docker or setup is missing.
`;

const options = {
  migrations: { type: "string" },
  to: { type: "string" },
  "git-base": { type: "string" },
  url: { type: "string" },
  out: { type: "string" },
  seed: { type: "string" },
  schema: { type: "string", multiple: true },
  role: { type: "string" },
  root: { type: "string" },
  port: { type: "string" },
  image: { type: "string" },
  help: { type: "boolean", short: "h" },
} satisfies ParseArgsConfig["options"];

type Values = ReturnType<typeof parseArgs<{ options: typeof options }>>["values"];

type Option = Exclude<keyof typeof options, "help">;

interface Command {
  /** The options it reads. Any other is a usage error, so a misplaced option is not ignored. */
  readonly accepts: readonly Option[];
  readonly run: (values: Values, context: Context) => Promise<number>;
}

const container: readonly Option[] = ["root", "port", "image"];

interface Context {
  readonly io: CliIo;
  readonly postgres: PostgresOptions;
  readonly migrations: string;
  readonly out: string;
}

/** Checks skip locally without Docker, so a laptop without it can run the rest; CI must not. */
function skipWithoutDocker(name: string, { io, postgres }: Context): number | null {
  const status = dockerStatus(postgres.env);
  if (status.available) return null;
  if (io.env["CI"]) throw new MissingToolError(`Docker is required in CI: ${status.reason}.`);
  io.stdout(`db-tools ${name}: skipped locally, ${status.reason}. CI runs it.\n`);
  return exitCodes.passed;
}

const commands: Readonly<Record<string, Command>> = {
  "atlas-diff": {
    accepts: ["migrations", "to", ...container],
    async run(values, { postgres, migrations }) {
      requireAtlas(postgres.env);
      await withPostgres(
        "atlas-diff",
        (devDatabaseUrl) =>
          atlasDiff({
            migrations,
            to: values.to ?? "db/schema.sql",
            devDatabaseUrl,
            env: postgres.env,
          }),
        postgres,
      );
      return exitCodes.passed;
    },
  },

  "atlas-lint": {
    accepts: ["migrations", "git-base", ...container],
    async run(values, context) {
      const { postgres, migrations, io } = context;
      const skipped = skipWithoutDocker("atlas-lint", context);
      if (skipped !== null) return skipped;
      requireAtlas(postgres.env);
      const gitBase = values["git-base"] ?? io.env["MOON_BASE"];
      await withPostgres(
        "atlas-lint",
        (devDatabaseUrl) => atlasLint({ migrations, devDatabaseUrl, gitBase, env: postgres.env }),
        postgres,
      );
      return exitCodes.passed;
    },
  },

  "atlas-apply": {
    accepts: ["migrations", "url"],
    async run(values, { io, postgres, migrations }) {
      const url = values.url ?? io.env["DATABASE_URL"];
      if (url === undefined || url === "") {
        io.stderr("db-tools atlas-apply: set DATABASE_URL or pass --url.\n");
        return exitCodes.usage;
      }
      requireAtlas(postgres.env);
      applyMigrations(url, migrations, postgres.env);
      return exitCodes.passed;
    },
  },

  "drizzle-generate": {
    accepts: ["migrations", "out", ...container],
    async run(_values, { io, postgres, migrations, out }) {
      requireAtlas(postgres.env);
      drizzleKitBin();
      await generateDrizzleSchema({ migrations, out, postgres });
      io.stdout(`db-tools drizzle-generate: wrote ${out}.\n`);
      return exitCodes.passed;
    },
  },

  "drizzle-check": {
    accepts: ["migrations", "out", ...container],
    async run(_values, context) {
      const { io, postgres, migrations, out } = context;
      const skipped = skipWithoutDocker("drizzle-check", context);
      if (skipped !== null) return skipped;
      requireAtlas(postgres.env);
      drizzleKitBin();
      if (!(await drizzleSchemaIsCurrent({ migrations, out, postgres }))) {
        io.stderr(
          `db-tools drizzle-check: ${out} is stale or was edited by hand. Its files are generated and hand edits are lost. Regenerate with db-tools drizzle-generate.\n`,
        );
        return exitCodes.failed;
      }
      io.stdout(`db-tools drizzle-check: ${out} matches the migrations in ${migrations}.\n`);
      return exitCodes.passed;
    },
  },

  "rls-verify": {
    accepts: ["migrations", "seed", "schema", "role", ...container],
    async run(values, context) {
      const { io, postgres, migrations } = context;
      const skipped = skipWithoutDocker("rls-verify", context);
      if (skipped !== null) return skipped;
      const serverUrl = startPostgres(postgres);
      const passed = [
        ...(values.seed === undefined ? [] : ["--seed", values.seed]),
        ...(values.schema ?? []).flatMap((schema) => ["--schema", schema]),
        ...(values.role === undefined ? [] : ["--role", values.role]),
      ];
      return rlsVerify(["--disposable", "--migrations", migrations, ...passed], {
        ...io,
        env: { ...io.env, DATABASE_URL: serverUrl },
      });
    },
  },

  clean: {
    accepts: [...container],
    async run(_values, { io, postgres }) {
      io.stdout(
        removePostgres(postgres)
          ? "db-tools clean: removed the checkout's Postgres container.\n"
          : "db-tools clean: no Postgres container to remove.\n",
      );
      return exitCodes.passed;
    },
  },
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "-h" || name === "--help") {
    (name === undefined ? io.stderr : io.stdout)(usage);
    return name === undefined ? exitCodes.usage : exitCodes.passed;
  }
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (command === undefined) {
    io.stderr(`db-tools: unknown command ${JSON.stringify(name)}.\n\n${usage}`);
    return exitCodes.usage;
  }
  let values: Values;
  try {
    ({ values } = parseArgs({ args: rest, options }));
  } catch (error) {
    io.stderr(`db-tools ${name}: ${messageOf(error)}\n\n${usage}`);
    return exitCodes.usage;
  }
  if (values.help === true) {
    io.stdout(usage);
    return exitCodes.passed;
  }
  const refused = Object.keys(values).filter(
    (option) => option !== "help" && !command.accepts.some((accepted) => accepted === option),
  );
  if (refused.length > 0) {
    io.stderr(`db-tools ${name}: does not take --${refused.join(", --")}.\n`);
    return exitCodes.usage;
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !Number.isInteger(port)) {
    io.stderr(`db-tools ${name}: --port must be a whole number.\n`);
    return exitCodes.usage;
  }
  const context: Context = {
    io,
    postgres: {
      env: io.env,
      ...(values.root === undefined ? {} : { root: values.root }),
      ...(port === undefined ? {} : { port }),
      ...(values.image === undefined ? {} : { image: values.image }),
    },
    migrations: values.migrations ?? "db/migrations",
    out: values.out ?? "db/drizzle/_generated",
  };
  try {
    return await command.run(values, context);
  } catch (error) {
    io.stderr(`db-tools ${name}: ${messageOf(error)}\n`);
    return error instanceof ToolFailedError ? exitCodes.failed : exitCodes.setup;
  }
}
