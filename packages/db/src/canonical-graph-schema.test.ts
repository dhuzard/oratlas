import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const sqliteSchema = readFileSync(resolve(packageRoot, "prisma/schema.prisma"), "utf8");
const postgresSchema = readFileSync(resolve(packageRoot, "prisma/schema.postgres.prisma"), "utf8");
const postgresDdl = readFileSync(resolve(packageRoot, "prisma/schema.postgres.sql"), "utf8");
const migration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260805010000_expand_canonical_graph_identity/migration.sql",
  ),
  "utf8",
);
const sourceUnionMigration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260805020000_graph_source_union_compatibility/migration.sql",
  ),
  "utf8",
);
const guards = readFileSync(resolve(packageRoot, "src/database-guards.ts"), "utf8");
const sourceRecordMigration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260805030000_canonical_source_record_content/migration.sql",
  ),
  "utf8",
);
const edgeMigration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260805040000_node_edge_source_assertions/migration.sql",
  ),
  "utf8",
);
const contractMigration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260805060000_canonical_graph_contract_gate/migration.sql",
  ),
  "utf8",
);

describe("canonical graph identity schema expansion", () => {
  it.each([
    ["SQLite", sqliteSchema],
    ["PostgreSQL", postgresSchema],
  ])("adds the same nullable compatibility bindings to %s", (_provider, schema) => {
    expect(schema).toMatch(/model Review \{[\s\S]*?knowledgeNodeId\s+String\?\s+@unique/);
    expect(schema).toMatch(/model KnowledgeNode \{[\s\S]*?stableKey\s+String\?\s+@unique/);
    expect(schema).toMatch(
      /model KnowledgeNodeVersion \{[\s\S]*?sourceReviewVersionId\s+String\?\s+@unique[\s\S]*?sourceClaimId\s+String\?\s+@unique[\s\S]*?sourceCitationId\s+String\?\s+@unique/,
    );
    expect(schema).toMatch(
      /model Citation \{[\s\S]*?workId\s+String\?[\s\S]*?knowledgeNodeId\s+String\?/,
    );
    expect(schema).toMatch(/model ClaimEvidenceRelation \{[\s\S]*?nodeEdgeId\s+String\?\s+@unique/);
  });

  it("keeps the first production migration expand-only", () => {
    expect(migration).toContain('ADD COLUMN "knowledgeNodeId" TEXT');
    expect(migration).toContain('ADD COLUMN "stableKey" TEXT');
    expect(migration).toContain('ADD COLUMN "sourceReviewVersionId" TEXT');
    expect(migration).toContain('ADD COLUMN "nodeEdgeId" TEXT');
    expect(migration).toContain("DEFAULT 'repository-object'");
    const statements = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(
      /^\s*(?:DELETE|UPDATE)\b|\bDROP\s+(?:COLUMN|TABLE)\b|\bSET\s+NOT\s+NULL\b/im,
    );
  });

  it("does not mutate the frozen pre-migration baseline", () => {
    const baseline = readFileSync(
      resolve(packageRoot, "prisma/baseline/20260805000000_existing_schema_baseline.sql"),
      "utf8",
    );
    expect(baseline).not.toContain('"stableKey"');
    expect(baseline).not.toContain('"sourceReviewVersionId"');
    expect(baseline).not.toContain('"nodeEdgeId"');
  });

  it.each([
    ["SQLite", sqliteSchema],
    ["PostgreSQL", postgresSchema],
  ])("permits real non-repository source identities in %s", (_provider, schema) => {
    expect(schema).toMatch(/model KnowledgeNode \{[\s\S]*?repositoryId\s+String\?/);
    expect(schema).toMatch(/model KnowledgeNodeVersion \{[\s\S]*?snapshotId\s+String\?/);
  });

  it("relaxes ownership without rewriting data and installs exclusive source guards", () => {
    expect(sourceUnionMigration).toContain(
      'ALTER TABLE "KnowledgeNode" ALTER COLUMN "repositoryId" DROP NOT NULL',
    );
    expect(sourceUnionMigration).toContain(
      'ALTER TABLE "KnowledgeNodeVersion" ALTER COLUMN "snapshotId" DROP NOT NULL',
    );
    expect(sourceUnionMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "KnowledgeNode_source_union_check"',
    );
    expect(sourceUnionMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "KnowledgeNodeVersion_source_union_check"',
    );
    expect(sourceUnionMigration).toContain('"KnowledgeNode_source_union_check"');
    expect(sourceUnionMigration).toContain('"KnowledgeNodeVersion_source_union_check"');
    expect(sourceUnionMigration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
    expect(guards).toContain("\"originType\" = 'canonical-work'");
    expect(guards).toContain('(NEW."sourceCitationId" IS NOT NULL)');
  });

  it("allows source records to omit presentation fields and keeps occurrence edges distinct", () => {
    expect(sourceRecordMigration).toContain('ALTER COLUMN "title" DROP NOT NULL');
    expect(sourceRecordMigration).toContain('ALTER COLUMN "license" DROP NOT NULL');
    expect(edgeMigration).toContain('ADD COLUMN "edgeDiscriminator"');
    expect(edgeMigration).toContain(
      '"sourceNodeVersionId", "targetNodeId", "relationType", "edgeDiscriminator"',
    );
    expect(sourceRecordMigration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
    expect(edgeMigration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
  });

  it("installs an activation-gated, deferred and deletion-safe canonical contract", () => {
    expect(contractMigration).toContain('CREATE TABLE "CanonicalGraphContractState"');
    expect(contractMigration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(contractMigration).toContain('"oratlas_finalize_canonical_graph_contract"');
    expect(contractMigration).toContain("LOCK TABLE");
    expect(contractMigration).toContain('BEFORE UPDATE OR DELETE ON "KnowledgeNodeVersion"');
    expect(contractMigration).toContain('BEFORE UPDATE OR DELETE ON "NodeEdge"');
    expect(contractMigration).toContain("state singleton cannot be deleted");
    expect(contractMigration).toContain("RETURN false");
    expect(contractMigration).toContain("RETURN true");
    expect(contractMigration).toContain('"backupId" IS NOT NULL');
    expect(contractMigration).toContain('char_length("backupId") BETWEEN 1 AND 300');
    expect(contractMigration).toContain("supplied_backup_id IS NULL");
    expect(contractMigration).not.toContain("[A-Za-z0-9._/-]{1,300}");
    expect(contractMigration).toContain("ON DELETE RESTRICT");
    expect(contractMigration).toContain("Publication lifecycle is mutable access-control state");
    expect(contractMigration).toContain('v."payloadJson"::jsonb = jsonb_build_object');
    expect(contractMigration).toContain(
      '\'{"recordSourceType":%s,"reviewId":%s,"reviewVersionId":%s}\'',
    );
    expect(postgresSchema).toMatch(
      /model CanonicalGraphContractState \{[\s\S]*?enforced\s+Boolean/,
    );
    expect(postgresSchema).toContain(
      '@relation("citationWorkNode", fields: [knowledgeNodeId], references: [id], onDelete: Restrict)',
    );
    expect(postgresSchema).toMatch(
      /model KnowledgeNode \{[\s\S]*?repository\s+Repository\?\s+@relation\(fields: \[repositoryId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(postgresSchema).toMatch(
      /model KnowledgeNodeVersion \{[\s\S]*?snapshot\s+RepositorySnapshot\?\s+@relation\(fields: \[snapshotId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(postgresDdl).toContain(
      'CONSTRAINT "KnowledgeNode_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT',
    );
    expect(postgresDdl).toContain(
      'CONSTRAINT "KnowledgeNodeVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE RESTRICT',
    );
  });
});
