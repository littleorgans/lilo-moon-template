# Start a project from this template

Copy this repository, put your names on it, generate the members you will keep, and delete the
exemplars. The working contract after that is [AGENTS.md](../AGENTS.md). This page does not repeat
it.

This GitHub repository has no Use this template button. Clone it.

## Install the tools first

`just setup` needs `just` and moon `2.5.1` on `PATH`. The workspace `versionConstraint` in
`.moon/workspace.yml` is `=2.5.1`. Any other moon release is rejected. proto is the version manager
that reads `.prototools`. CI installs moon from that file. `just setup` does not install just, moon,
or proto.

Install proto:

```bash
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

Finish the installer prompt so `~/.proto/bin` is on `PATH`. Then pin moon to the workspace version:

```bash
proto install moon 2.5.1
```

Install just from the [just installation guide](https://github.com/casey/just#installation). On
macOS:

```bash
brew install just
```

Confirm before you clone:

```bash
proto --version
moon --version
just --version
```

`moon --version` must print `2.5.1`.

## Copy the tree

```bash
git clone https://github.com/littleorgans/lilo-moon-template.git your-repo
cd your-repo
git remote set-url origin git@github.com:your-org/your-repo.git
just setup
pnpm install
just ci
```

Stop if `just ci` is not green. Fix that against the template before you rename anything.

After you rename the directory itself, run `moon clean`, delete `node_modules`, and run
`pnpm install` again. The moon cache and the installed workspace links store absolute paths.

## Rename what identifies the template

Run the rename command with a GitHub organization, a JavaScript package scope without `@`, and a
repository slug:

```bash
just rename your-org your-scope your-repo
```

Run `just rename-verify` at any time to confirm that no template identity remains in tracked files.

The source condition is a matching pair. The key in `exports` and the string in
`resolve.conditions` must be the same. Node's standard conditions stay pointed at `dist`. Why is
in [Why this baseline is shaped this way](decisions.md).

There is no root `LICENSE` file. Add one. Set `license` in every publishable `package.json` and in
the library generator to the same SPDX id.

`publishConfig.access` on the library generator is `"public"`. Change it if the package is not
public.

Do not change `packageManager`, `engines`, catalog pins, or the moon version. Those are the
baseline.

## Generate your members before you delete anything

The generators write a TypeScript library under `packages/` and a Vite React application under
`apps/`. Other stacks follow [Add a workspace member](../AGENTS.md#add-a-workspace-member) in
AGENTS.md.

```bash
just new-package billing
just new-app console
pnpm install
moon sync
moon project billing
moon project console
```

`moon project` must print the project id, its layer, and the inherited tasks. If it does not, moon
did not discover the member. Do not delete the exemplars.

## Attach the application to the library

The generators do not add a workspace dependency. `moon sync` does not infer one from an import.
Typecheck then fails with TS2307 `Cannot find module`.

Copy the dependency shape from `apps/web/package.json` before you delete that exemplar. In
`apps/console/package.json` `dependencies`, add the generated library with `workspace:*`:

```json
"@your-scope/billing": "workspace:*"
```

Use the scope and names you just chose. Then:

```bash
pnpm install
moon sync
moon project console
```

`moon project console` must list `Depends on: billing`. Import the library from the application.
Replace the generated `formatLabel` body, or the generated `App` heading, with something that is
wrong. `moon run billing:test` or `moon run console:test` must fail. Restore the body. Then run
`just ci`.

Do this before you delete `apps/web`. After the delete, the only worked `workspace:*` example is
gone.

You now have your own members plus the exemplars. Keep it that way until the next section is green.

## Delete the exemplars

Delete `packages/collections` and `apps/web` only after your replacements exist and the new
application already depends on the new library. The application exemplar depends on the library
exemplar. Deleting one and not generating a replacement leaves a broken workspace.

Keep both exemplars if you are not yet replacing that layer. A repo that will not ship a library
can drop `packages/collections` once no remaining `package.json` lists it. A repo that will not
ship a Vite React app can drop `apps/web`. Keep `services/ping` if you want a Rust member. Drop it
if you do not.

```bash
rm -rf packages/collections apps/web
pnpm install
moon sync
```

`moon project collections` and `moon project web` must fail to resolve.

`moon sync` adds new `references` in the root `tsconfig.json`. It does not drop a path whose
project is gone. `moon.yml` `tasks.project-refs` runs `tsc --build --pretty --dry` and fails
`just ci` with TS6053 until you prune. Per-project typecheck does not catch this.

Remove every `references` entry whose path no longer exists. Leave `compilerOptions.outDir` and
every remaining path alone. Then:

```bash
just ci
```

`moon.yml` `tasks.project-refs` must exit 0 with no TS6053. The `references` array must list only
the members you kept.

## What you must not delete

These are the baseline. Removing any of them is a fork, not an instantiation.

- `.moon/workspace.yml`, `.moon/toolchains.yml`, `.moon/tasks/`, `.moon/templates/`
- `moon.yml` at the repository root, including `tasks.lint`, `tasks.format-check`,
  `tasks.project-refs`, `tasks.secrets`, `tasks.audit`, and `inheritedTasks.include`
- `justfile`
- `scripts/assert-tsgolint-lockstep.mjs`, `scripts/check-security.mjs`, and
  `.moon/tasks/tsgolint-lockstep.yml`
- `pnpm-workspace.yaml` catalogs
- `tsconfig.options.json`
- `.oxlintrc.json` and `.oxfmtrc.json`
- `lefthook.yml`, lefthook `scripts.prepare` in the root `package.json`, and `commitlint.config.js`
- `.changeset/`
- `.github/workflows/ci.yml`
- `renovate.json`
- `.vscode/extensions.json` and `.vscode/settings.json`
- `.prototools`
- `.npmrc`
- `.editorconfig`
- `AGENTS.md`

`services/` is a glob in both `.moon/workspace.yml` `projects.globs` and `pnpm-workspace.yaml`
`packages`. Leave the glob. `services/ping` is the Rust exemplar. The Rust toolchain is on in
`.moon/toolchains.yml`. Python stays commented until a Python member lands.

A clone that keeps only ping still runs `pnpm install` for the root oxlint, oxfmt, secretlint, and
audit gates. Those tools live in `devDependencies` in the root `package.json`. A Rust-only
`moon ci` still installs that JavaScript toolchain.

## Prove the result is healthy

The renamed tree must pass `just ci`. From a generated library directory, `npm pack --dry-run`
lists `dist` and `src`. No packed `.map` entry may point at a path outside the package.

Then prove the gates can fail. Follow [Prove every gate](../AGENTS.md#prove-every-gate). Do not
skip that procedure because `lefthook.yml`, a changeset, or a coverage threshold might be stricter.

`lefthook.yml` runs `root:format-check`, `root:lint`, and `root:secrets` before a commit. Its
`commit-msg` hook runs commitlint. `just ci` also runs `root:secrets` and `root:audit`. Add a
changeset with `pnpm exec changeset` when a change belongs in the changelog for any versioned
package, including a library or private application.

## After this page

Work inside the repo is AGENTS.md. Settled tool choices are
[Why this baseline is shaped this way](decisions.md).
