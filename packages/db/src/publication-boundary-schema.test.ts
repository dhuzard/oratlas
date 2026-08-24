import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATABASE_GUARD_NAMES,
  POSTGRES_DATABASE_GUARD_TRIGGER_NAMES,
  SQLITE_DATABASE_GUARD_NAMES,
  SQLITE_PUBLICATION_IMMUTABLE_GUARD_NAMES,
  SQLITE_CERTIFICATION_IMMUTABLE_GUARD_NAMES,
} from "./database-guards.js";

const packageRoot = resolve(import.meta.dirname, "..");
const sqliteSchema = readFileSync(resolve(packageRoot, "prisma/schema.prisma"), "utf8");
const postgresSchema = readFileSync(resolve(packageRoot, "prisma/schema.postgres.prisma"), "utf8");
const postgresDdl = readFileSync(resolve(packageRoot, "prisma/schema.postgres.sql"), "utf8");
const guards = readFileSync(resolve(packageRoot, "src/database-guards.ts"), "utf8");
const migration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260823000000_external_publication_boundary/migration.sql",
  ),
  "utf8",
);
const observedAddressMigration = readFileSync(
  resolve(packageRoot, "prisma/migrations/20260824040000_observed_publication_base/migration.sql"),
  "utf8",
);
const productionTransferMigration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260824050000_publication_production_transfer/migration.sql",
  ),
  "utf8",
);
const certificationMigration = readFileSync(
  resolve(packageRoot, "prisma/migrations/20260824060000_generic_certification/migration.sql"),
  "utf8",
);
const contentCorpusMigration = readFileSync(
  resolve(packageRoot, "prisma/migrations/20260824070000_publication_content_corpus/migration.sql"),
  "utf8",
);

const PUBLICATION_MODELS = [
  "Publication",
  "PublicationVersion",
  "PublicationCapture",
  "PublicationClaimOccurrence",
] as const;
const PUBLICATION_PROVENANCE_MODELS = [
  "PublicationProductionAssertion",
  "PublicationRelation",
] as const;
const CERTIFICATION_MODELS = [
  "Certifier",
  "CertificationProtocol",
  "CertifierCredential",
  "CertificationRun",
  "CertificationResult",
  "CertificationLifecycleEvent",
] as const;

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`^model ${model} \\{$[\\s\\S]*?^\\}$`, "m"));
  if (!match) throw new Error(`Model ${model} is missing from the schema.`);
  return match[0];
}

describe("publication boundary schema parity", () => {
  it.each(PUBLICATION_MODELS)("declares %s identically on SQLite and PostgreSQL", (model) => {
    expect(modelBlock(postgresSchema, model)).toBe(modelBlock(sqliteSchema, model));
  });

  it.each(PUBLICATION_PROVENANCE_MODELS)(
    "declares append-only %s identically on SQLite and PostgreSQL",
    (model) => {
      expect(modelBlock(postgresSchema, model)).toBe(modelBlock(sqliteSchema, model));
    },
  );

  it.each(CERTIFICATION_MODELS)(
    "declares certification model %s identically on SQLite and PostgreSQL",
    (model) => {
      expect(modelBlock(postgresSchema, model)).toBe(modelBlock(sqliteSchema, model));
    },
  );

  it("keeps certification exact-version-bound and separate from TRUST and publication identity", () => {
    const result = modelBlock(sqliteSchema, "CertificationResult");
    expect(result).toMatch(/publicationVersionId\s+String\b/);
    expect(result).toMatch(/certifierId\s+String\b/);
    expect(result).toMatch(/protocolId\s+String\b/);
    expect(result).toMatch(/inputPacketSha256\s+String\b/);
    expect(modelBlock(sqliteSchema, "Publication")).not.toMatch(
      /certified|scientificScore|trustScore/i,
    );
    expect(modelBlock(sqliteSchema, "PublicationVersion")).not.toMatch(
      /certified|scientificScore|trustScore/i,
    );
  });

  it("binds production assertions to exact versions without contributor or publication fields", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      const assertion = modelBlock(schema, "PublicationProductionAssertion");
      expect(assertion).toMatch(/publicationVersionId\s+String\b/);
      expect(assertion).toMatch(/supersedesAssertionId\s+String\?\s+@unique/);
      expect(assertion).not.toMatch(/publicationId\s+String\b/);
      expect(assertion).not.toMatch(/personId\s+String\b/);
      expect(assertion).not.toMatch(/contributor/i);
    }
  });

  it("keeps publication identity separate from exact version identity in both schemas", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      expect(modelBlock(schema, "Publication")).toMatch(/stableKey\s+String\s+@unique/);
      const version = modelBlock(schema, "PublicationVersion");
      expect(version).toMatch(/stableKey\s+String\s+@unique/);
      expect(version).toMatch(/sourcesSha256\s+String\b/);
      // Scoped, not global: two publications may legitimately share a digest.
      expect(version).toContain("@@unique([publicationId, sourcesSha256])");
      expect(version).not.toMatch(/sourcesSha256\s+String\s+@unique/);
      // A canonical URL is addressing metadata, never identity.
      expect(version).toMatch(/canonicalUrl\s+String\?/);
      expect(version).not.toMatch(/canonicalUrl\s+String\??\s+@unique/);
      expect(version).toMatch(/observedPublicationBaseUrl\s+String\?/);
      expect(version).not.toMatch(/observedPublicationBaseUrl\s+String\??\s+@unique/);
      expect(version).toMatch(/contentCorpusJson\s+String/);
      expect(version).toMatch(/contentCorpusSha256\s+String/);
      expect(version).toMatch(/contentCompletenessJson\s+String/);
    }
  });

  it("scopes a source-local claim id to one exact publication version", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      const occurrence = modelBlock(schema, "PublicationClaimOccurrence");
      expect(occurrence).toContain("@@unique([publicationVersionId, sourceLocalClaimId])");
      expect(occurrence).not.toMatch(/sourceLocalClaimId\s+String\s+@unique/);
      // Equal declaration bytes are never one canonical claim.
      expect(occurrence).not.toMatch(/declarationSha256\s+String\s+@unique/);
      expect(occurrence).toContain("@@index([declarationSha256])");
      // The canonical binding exists but is nullable and explicit.
      expect(occurrence).toMatch(/knowledgeNodeId\s+String\?/);
    }
  });

  it("keys captures by artifact location rather than equal content", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      const capture = modelBlock(schema, "PublicationCapture");
      expect(capture).toMatch(/artifactIdentitySha256\s+String\b/);
      expect(capture).toContain("@@unique([publicationVersionId, artifactIdentitySha256])");
      expect(capture).not.toContain(
        "@@unique([publicationVersionId, artifactKind, contentSha256])",
      );
    }
  });

  it("keeps toolchain-specific fields inside typed JSON, not generic columns", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      for (const model of PUBLICATION_MODELS) {
        const block = modelBlock(schema, model);
        expect(block).not.toMatch(/^\s*myst[A-Za-z]*\s+String/m);
        expect(block).not.toMatch(/^\s*xref\s+String/m);
        expect(block).not.toMatch(/^\s*htmlId\s+String/m);
      }
      const version = modelBlock(schema, "PublicationVersion");
      expect(version).toMatch(/adapterType\s+String\b/);
      expect(version).toMatch(/adapterBindingJson\s+String\b/);
      const occurrence = modelBlock(schema, "PublicationClaimOccurrence");
      expect(occurrence).toMatch(/sourceLocalClaimId\s+String\b/);
      expect(occurrence).toMatch(/targetJson\s+String\b/);
    }
  });

  it("adds the external-publication occurrence source to both schemas", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      expect(modelBlock(schema, "KnowledgeNodeVersion")).toMatch(
        /sourcePublicationClaimOccurrenceId\s+String\?\s+@unique/,
      );
    }
    expect(postgresDdl).toContain('"sourcePublicationClaimOccurrenceId" TEXT');
    expect(postgresDdl).toContain(
      'ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_sourcePublicationClaimOccurrenceId_fkey" FOREIGN KEY ("sourcePublicationClaimOccurrenceId") REFERENCES "PublicationClaimOccurrence"("id") ON DELETE RESTRICT',
    );
  });
});

describe("the publication boundary migration", () => {
  it("is expand-only", () => {
    const statements = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/^\s*(?:DELETE|UPDATE|TRUNCATE)\b/im);
    expect(statements).not.toMatch(/\bDROP\s+(?:COLUMN|TABLE)\b/i);
    expect(statements).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(statements).not.toMatch(/\bDROP\s+NOT\s+NULL\b/i);
    expect(migration).toContain(
      'ALTER TABLE "KnowledgeNodeVersion" ADD COLUMN     "sourcePublicationClaimOccurrenceId" TEXT',
    );
    for (const model of PUBLICATION_MODELS) {
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
  });

  it("adds observed addressing without rewriting optional publisher canonical metadata", () => {
    expect(observedAddressMigration).toContain(
      'ALTER TABLE "PublicationVersion" ADD COLUMN "observedPublicationBaseUrl" TEXT',
    );
    expect(observedAddressMigration).not.toMatch(/\b(?:UPDATE|DELETE|DROP)\b/i);
    expect(observedAddressMigration).not.toContain('SET "canonicalUrl"');
  });

  it("adds append-only production and transfer records without rewriting publications", () => {
    expect(productionTransferMigration).toContain('CREATE TABLE "PublicationProductionAssertion"');
    expect(productionTransferMigration).toContain('CREATE TABLE "PublicationRelation"');
    expect(productionTransferMigration).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE)\b/im);
    expect(productionTransferMigration).not.toMatch(/\bDROP\s+(?:COLUMN|TABLE)\b/i);
    for (const constraint of [
      "PublicationProductionAssertion_shape_check",
      "PublicationRelation_shape_check",
    ]) {
      expect(productionTransferMigration).toContain(`CONSTRAINT "${constraint}"`);
      expect(DATABASE_GUARD_NAMES).toContain(constraint);
      expect(guards).toContain(`ADD CONSTRAINT "${constraint}"`);
      expect(postgresDdl).toContain(`ADD CONSTRAINT "${constraint}"`);
    }
    for (const trigger of [
      "PublicationProductionAssertion_immutable_guard",
      "PublicationRelation_immutable_guard",
    ]) {
      expect(productionTransferMigration).toContain(`CREATE TRIGGER "${trigger}"`);
      expect(POSTGRES_DATABASE_GUARD_TRIGGER_NAMES).toContain(trigger);
      expect(postgresDdl).toContain(`CREATE TRIGGER "${trigger}"`);
    }
  });

  it("adds persisted content only to the already immutable exact version", () => {
    for (const column of ["contentCorpusJson", "contentCorpusSha256", "contentCompletenessJson"]) {
      expect(contentCorpusMigration).toContain(`ADD COLUMN "${column}"`);
    }
    expect(contentCorpusMigration).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE)\b/im);
    expect(contentCorpusMigration).not.toMatch(/\bDROP\s+(?:COLUMN|TABLE)\b/i);
    expect(contentCorpusMigration).not.toContain("@neuronautix/myst");
    expect(contentCorpusMigration).toContain("\"contentCorpusSha256\" ~ '^[a-f0-9]{64}$'");
    expect(guards).toContain("\"contentCorpusSha256\" ~ '^[a-f0-9]{64}$'");
  });

  it("keeps the node-version source union exclusive rather than weakening it", () => {
    const union = migration.match(
      /ADD CONSTRAINT "KnowledgeNodeVersion_source_union_check" CHECK \(([\s\S]*?)\);/,
    );
    expect(union).not.toBeNull();
    const body = union![1]!;
    for (const column of [
      "snapshotId",
      "sourceReviewVersionId",
      "sourceClaimId",
      "sourceCitationId",
      "sourcePublicationClaimOccurrenceId",
    ]) {
      expect(body).toContain(`("${column}" IS NOT NULL)::int`);
    }
    expect(body).toContain(") = 1");
    // The pre-existing repository/review/claim/work node union is untouched.
    expect(migration).not.toContain('"KnowledgeNode_source_union_check"');
  });

  it("extends the dormant canonical contract to the new exact source", () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "oratlas_protect_canonical_graph_objects"()',
    );
    expect(migration).toContain('OR OLD."sourcePublicationClaimOccurrenceId" IS NOT NULL');
    expect(migration).toContain("Canonical graph contract: exact source versions are immutable");
  });

  it("installs the same database-native guards the guard module applies", () => {
    for (const constraint of [
      "Publication_record_source_check",
      "PublicationVersion_provenance_check",
      "PublicationCapture_shape_check",
      "PublicationClaimOccurrence_declaration_check",
    ]) {
      expect(migration).toContain(`ADD CONSTRAINT "${constraint}"`);
      expect(DATABASE_GUARD_NAMES).toContain(constraint);
      expect(guards).toContain(`ADD CONSTRAINT "${constraint}"`);
      expect(postgresDdl).toContain(`ADD CONSTRAINT "${constraint}"`);
    }
    for (const trigger of [
      "Publication_identity_immutable_guard",
      "PublicationVersion_immutable_guard",
      "PublicationCapture_immutable_guard",
      "PublicationClaimOccurrence_immutable_guard",
    ]) {
      expect(migration).toContain(`CREATE TRIGGER "${trigger}"`);
      expect(POSTGRES_DATABASE_GUARD_TRIGGER_NAMES).toContain(trigger);
      expect(postgresDdl).toContain(`CREATE TRIGGER "${trigger}"`);
    }
  });
});

describe("publication boundary guard coverage", () => {
  it("guards every new table on SQLite as well as PostgreSQL", () => {
    for (const model of PUBLICATION_MODELS) {
      expect(SQLITE_DATABASE_GUARD_NAMES).toContain(`${model}_guard_insert`);
      expect(SQLITE_DATABASE_GUARD_NAMES).toContain(`${model}_guard_update`);
    }
    for (const model of PUBLICATION_PROVENANCE_MODELS) {
      expect(SQLITE_DATABASE_GUARD_NAMES).toContain(`${model}_guard_insert`);
      expect(SQLITE_DATABASE_GUARD_NAMES).toContain(`${model}_guard_update`);
    }
    expect([...SQLITE_PUBLICATION_IMMUTABLE_GUARD_NAMES]).toEqual([
      "Publication_identity_immutable_guard",
      "PublicationVersion_immutable_guard_update",
      "PublicationVersion_immutable_guard_delete",
      "PublicationCapture_immutable_guard_update",
      "PublicationCapture_immutable_guard_delete",
      "PublicationClaimOccurrence_immutable_guard_update",
      "PublicationClaimOccurrence_immutable_guard_delete",
      "PublicationProductionAssertion_immutable_guard_update",
      "PublicationProductionAssertion_immutable_guard_delete",
      "PublicationRelation_immutable_guard_update",
      "PublicationRelation_immutable_guard_delete",
    ]);
    for (const model of CERTIFICATION_MODELS) {
      expect(SQLITE_DATABASE_GUARD_NAMES).toContain(`${model}_guard_insert`);
      expect(SQLITE_DATABASE_GUARD_NAMES).toContain(`${model}_guard_update`);
    }
    expect(SQLITE_CERTIFICATION_IMMUTABLE_GUARD_NAMES).toContain(
      "CertificationResult_immutable_guard_update",
    );
    expect(certificationMigration).toContain('CREATE TRIGGER "CertificationResult_binding_guard"');
    expect(postgresDdl).toContain('CREATE TRIGGER "CertificationResult_binding_guard"');
  });

  it("never labels structural provenance as a scientific state", () => {
    const provenanceGuards = guards.match(/structuralProvenance[^\n]*/g) ?? [];
    expect(provenanceGuards.length).toBeGreaterThan(0);
    for (const line of provenanceGuards) {
      expect(line).not.toMatch(/verified|trustworthy|confirmed|peer-reviewed/i);
    }
  });
});
