import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATABASE_GUARD_NAMES,
  POSTGRES_DATABASE_GUARD_TRIGGER_NAMES,
  SQLITE_DATABASE_GUARD_NAMES,
  SQLITE_PUBLICATION_IMMUTABLE_GUARD_NAMES,
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

const PUBLICATION_MODELS = [
  "Publication",
  "PublicationVersion",
  "PublicationCapture",
  "PublicationClaimOccurrence",
] as const;

/** Registration and capture models, added when registration became operational. */
const REGISTRATION_MODELS = ["PublicationRegistration", "PublicationRegistrationCapture"] as const;

const registrationMigration = readFileSync(
  resolve(
    packageRoot,
    "prisma/migrations/20260828000000_publication_registration_capture/migration.sql",
  ),
  "utf8",
);

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`^model ${model} \\{$[\\s\\S]*?^\\}$`, "m"));
  if (!match) throw new Error(`Model ${model} is missing from the schema.`);
  return match[0];
}

describe("publication boundary schema parity", () => {
  it.each(PUBLICATION_MODELS)("declares %s identically on SQLite and PostgreSQL", (model) => {
    expect(modelBlock(postgresSchema, model)).toBe(modelBlock(sqliteSchema, model));
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
    expect([...SQLITE_PUBLICATION_IMMUTABLE_GUARD_NAMES]).toEqual([
      "Publication_identity_immutable_guard",
      "PublicationVersion_immutable_guard_update",
      "PublicationVersion_immutable_guard_delete",
      "PublicationCapture_immutable_guard_update",
      "PublicationCapture_immutable_guard_delete",
      "PublicationRegistration_url_immutable_guard",
      "PublicationRegistrationCapture_immutable_guard_update",
      "PublicationRegistrationCapture_immutable_guard_delete",
      "PublicationClaimOccurrence_immutable_guard_update",
      "PublicationClaimOccurrence_immutable_guard_delete",
    ]);
  });

  it("never labels structural provenance as a scientific state", () => {
    const provenanceGuards = guards.match(/structuralProvenance[^\n]*/g) ?? [];
    expect(provenanceGuards.length).toBeGreaterThan(0);
    for (const line of provenanceGuards) {
      expect(line).not.toMatch(/verified|trustworthy|confirmed|peer-reviewed/i);
    }
  });
});

describe("registration and capture schema", () => {
  it.each(REGISTRATION_MODELS)("declares %s identically on SQLite and PostgreSQL", (model) => {
    expect(modelBlock(postgresSchema, model)).toBe(modelBlock(sqliteSchema, model));
  });

  it("registers one URL once and keeps every observation of it", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      expect(modelBlock(schema, "PublicationRegistration")).toMatch(
        /manifestUrl\s+String\s+@unique/,
      );
      const capture = modelBlock(schema, "PublicationRegistrationCapture");
      // Captures are keyed by what was observed, not by the URL, so a
      // republished site adds a capture rather than replacing one.
      expect(capture).toMatch(/captureKey\s+String\s+@unique/);
      expect(capture).not.toMatch(/requestedManifestUrl\s+String\s+@unique/);
      expect(capture).toMatch(/publicationVersionId\s+String\?/);
    }
  });

  it("retains HTTP provenance and the observation that first saw each artifact", () => {
    for (const schema of [sqliteSchema, postgresSchema]) {
      const artifact = modelBlock(schema, "PublicationCapture");
      expect(artifact).toMatch(/httpProvenanceJson\s+String\?/);
      expect(artifact).toMatch(/registrationCaptureId\s+String\?/);
    }
  });

  it("guards the capture on both providers, and only widens the schema", () => {
    expect(DATABASE_GUARD_NAMES).toContain("PublicationRegistrationCapture_shape_check");
    expect(SQLITE_DATABASE_GUARD_NAMES).toContain("PublicationRegistrationCapture_guard_insert");
    expect(SQLITE_DATABASE_GUARD_NAMES).toContain("PublicationRegistrationCapture_guard_update");
    for (const trigger of [
      "PublicationRegistration_url_immutable_guard",
      "PublicationRegistrationCapture_immutable_guard",
    ]) {
      expect(POSTGRES_DATABASE_GUARD_TRIGGER_NAMES).toContain(trigger);
      expect(postgresDdl).toContain(`CREATE TRIGGER "${trigger}"`);
    }
    // Expand only: the migration adds tables and nullable columns, and drops
    // nothing.
    expect(registrationMigration).not.toMatch(/DROP TABLE|DROP COLUMN|DROP CONSTRAINT/);
    expect(registrationMigration).toContain('CREATE TABLE "PublicationRegistration"');
    expect(registrationMigration).toContain('CREATE TABLE "PublicationRegistrationCapture"');
  });
});
