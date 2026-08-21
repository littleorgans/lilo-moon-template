-- Atlas desired state, and the applicability boundary for every Atlas and Drizzle task in
-- moon.yml. While this file is absent those tasks skip before Atlas or Docker starts.
--
-- Never move this file into db/migrations/. Atlas checksums that directory in atlas.sum and
-- treats every .sql file in it as a versioned migration.
--
-- example_items is a replaceable stub. It exists so root:atlas-lint and root:drizzle-check are
-- exercised in CI on a fresh clone. Replace it with your own schema.
CREATE TABLE example_items (
  id integer PRIMARY KEY
);
