# Start a project from this template

Copy this repository, put your names on it, generate the members you will keep, and delete the
exemplars. The working contract after that is [AGENTS.md](../AGENTS.md). This page does not repeat
it.

This GitHub repository has no Use this template button. Clone it.

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

Pick a package scope, a GitHub `org/repo`, and a license. Then change every field in this list.
Leave a template string in place and the next `just new-package` will put `littleorgans` back.

| What                                                              | Where                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Workspace name                                                    | `name` in the root `package.json`                                                  |
| Library name, `license`, `repository.url`, `repository.directory` | `packages/collections/package.json`                                                |
| Library source condition                                          | the `@lilo-moon/source` key under `exports` in `packages/collections/package.json` |
| Application name and workspace dependency                         | `apps/web/package.json`                                                            |
| Application import                                                | `apps/web/src/app.tsx`                                                             |
| Vite source condition and `optimizeDeps.exclude`                  | `apps/web/vite.config.ts`                                                          |
| Generated library name, `license`, `repository`, source condition | `.moon/templates/library/package.json.tera`                                        |
| Generated application name                                        | `.moon/templates/application/package.json.tera`                                    |
| Generated Vite source condition                                   | `.moon/templates/application/vite.config.ts.raw`                                   |

The source condition is a matching pair. The key in `exports` and the string in
`resolve.conditions` must be the same. Node's standard conditions stay pointed at `dist`. Why is
in [Why this baseline is shaped this way](decisions.md).

There is no root `LICENSE` file. Add one. Set `license` in every publishable `package.json` and in
the library generator to the same SPDX id.

`publishConfig.access` on the library generator is `"public"`. Change it if the package is not
public.

Search for leftovers:

```bash
git grep -n 'lilo-moon\|littleorgans\|@lilo-moon'
```

After `pnpm install`, the remaining hits are the historical CI URLs in AGENTS.md and the comment
`Independent of littleorgans` in `.moon/workspace.yml`. Update the URLs if you do not want them, or
leave them as the worked red and green example they are. The comment is not an identity string.
A leftover `@lilo-moon` in a generator template will reappear on the next `just new-package`.

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

Replace the generated `formatLabel` body, or the generated `App` heading, with something that is
wrong. `moon run billing:test` or `moon run console:test` must fail. Restore the body. Then run
`just ci`.

You now have your own members plus the exemplars. Keep it that way until the next section is green.

## Delete the exemplars

Delete `packages/collections` and `apps/web` only after your replacements exist. The application
exemplar depends on the library exemplar. Deleting one and not generating a replacement leaves a
broken workspace.

Keep both exemplars if you are not yet replacing that layer. A repo that will not ship a library
can drop `packages/collections` once no remaining `package.json` lists it. A repo that will not
ship a Vite React app can drop `apps/web`.

```bash
rm -rf packages/collections apps/web
pnpm install
moon sync
```

`moon project collections` and `moon project web` must fail to resolve.

`moon sync` adds new `references` in the root `tsconfig.json`. It does not drop a path whose
project is gone. `just ci` can still pass, because each member typechecks from its own directory.
A root `tsc --build` and the editor both read the stale paths and fail with TS6053.

Remove every `references` entry whose path no longer exists. Leave `compilerOptions.outDir` and
every remaining path alone. Then:

```bash
pnpm exec tsc --build --pretty
just ci
```

The root `tsc --build` must exit 0 with no TS6053. The `references` array must list only the
members you kept.

## What you must not delete

These are the baseline. Removing any of them is a fork, not an instantiation.

- `.moon/workspace.yml`, `.moon/toolchains.yml`, `.moon/tasks/`, `.moon/templates/`
- `moon.yml` at the repository root, including `tasks.lint`, `tasks.format-check`, and
  `inheritedTasks.include`
- `justfile`
- `scripts/assert-tsgolint-lockstep.mjs` and `.moon/tasks/tsgolint-lockstep.yml`
- `pnpm-workspace.yaml` catalogs
- `tsconfig.options.json`
- `.oxlintrc.json` and `.oxfmtrc.json`
- `.github/workflows/ci.yml`
- `renovate.json`
- `.vscode/extensions.json` and `.vscode/settings.json`
- `.prototools`
- `.npmrc`
- `.editorconfig`
- `AGENTS.md`

`services/` is an empty glob in both `.moon/workspace.yml` `projects.globs` and
`pnpm-workspace.yaml` `packages`. Leave the glob. Add a member there when you have one.

Rust and Python toolchains are commented out in `.moon/toolchains.yml`. Enable the toolchain when
the first member of that language lands, not before. The proof that a repo with no TypeScript still
works is #14 and is unbuilt.

## Prove the result is healthy

1. `just ci` exits 0 on the renamed tree with your members and without the exemplars. A root
   `pnpm exec tsc --build --pretty` also exits 0.
2. A real type error fails `moon run <project>:typecheck`. Revert it.
3. An unhandled promise fails `moon run root:lint` with `typescript(no-floating-promises)`. Revert
   it.
4. Broken formatting fails `moon run root:format-check`. Revert it.
5. A wrong implementation fails `moon run <project>:test`. Revert it.
6. From a generated library directory, `npm pack --dry-run` lists `dist` and `src`. No packed
   `.map` entry may point at a path outside the package.

`just check` is allowed to rewrite files. `just ci` is not. Use `just ci` as the delivery proof.

Coverage thresholds (#5), changesets (#6), git hooks (#7), and supply chain gates (#11) are not
there to help you. Do not skip the list above because a future gate might be stricter.

## After this page

Work inside the repo is AGENTS.md. Settled tool choices are
[Why this baseline is shaped this way](decisions.md).
