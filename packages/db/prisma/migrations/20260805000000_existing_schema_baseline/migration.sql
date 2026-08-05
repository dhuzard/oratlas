-- Transitional baseline marker for databases created from schema.postgres.sql.
-- packages/db/scripts/deploy-postgres.ts installs the reviewed bootstrap DDL on
-- an empty database or proves an existing schema has zero Prisma drift before
-- recording this migration as applied. All later migrations contain upgrades.
SELECT 1;
