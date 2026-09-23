# @littleorgans/tsconfig

The TypeScript compiler options the `@littleorgans/*` packages, the reference app and the reference
service build with: strict checking beyond `strict` (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and more), ES2024, `module: "preserve"` with bundler resolution, and
the `composite` and declaration settings project references need.

## Install

```sh
pnpm add --save-dev @littleorgans/tsconfig
```

## Use it

Extend it from the workspace root's `tsconfig.options.json`, which every project's `tsconfig.json`
extends in turn:

```json
{
  "extends": "@littleorgans/tsconfig"
}
```

Add options a whole workspace needs to that file, and options one project needs to its
`tsconfig.json`. A web app, for example, adds `"lib": ["ES2024", "DOM", "DOM.Iterable"]` and
`"jsx": "react-jsx"`.

The options are written for and tested with TypeScript 7, the compiler this repository pins.
`composite`, `declaration` and `declarationMap` are on because a Moon workspace routes each
project's typecheck output to its cache through project references.
