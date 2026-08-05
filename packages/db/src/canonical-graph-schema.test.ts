import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const sqliteSchema = readFileSync(resolve(packageRoot, "prisma/schema.prisma"), "utf8");
const postgresSchema = readFileSync(resolve(packageRoot, "prisma/schema.postgres.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260805010000_expand_canonical_graph_identity/migration.sql",
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
});
