// `@littleorgans/source` resolves workspace libraries to their TypeScript source. It is for this
// workspace only: a consumer's resolver that enables it, as the published vite-config does under
// `vite dev`, would load `src/*.ts` from node_modules, which Node refuses to run. `pnpm pack` and
// `pnpm publish` apply this hook after publishConfig, so no packed manifest carries the condition.
// root:published-shape asserts that against every tarball.
const SOURCE_CONDITION = "@littleorgans/source";

function withoutSourceCondition(target) {
  if (typeof target !== "object" || target === null || Array.isArray(target)) return target;
  return Object.fromEntries(
    Object.entries(target)
      .filter(([key]) => key !== SOURCE_CONDITION)
      .map(([key, value]) => [key, withoutSourceCondition(value)]),
  );
}

module.exports = {
  hooks: {
    beforePacking(manifest) {
      if (manifest.exports !== undefined)
        manifest.exports = withoutSourceCondition(manifest.exports);
      return manifest;
    },
  },
};
