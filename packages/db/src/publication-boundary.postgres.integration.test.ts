import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "./index.js";

/**
 * PostgreSQL behaviour of the generic publication boundary.
 *
 * The SQLite suite proves the same invariants through triggers; this proves the
 * deployed PostgreSQL migration installs equivalent database-native guards, so
 * neither provider relies on TypeScript for them.
 */

const enabled = Boolean(process.env.PUBLICATION_BOUNDARY_TEST_DATABASE_URL);
const prisma = getPrisma();

const digest = (seed: string) => seed.repeat(64).slice(0, 64);
const suffix = `${Date.now()}-${process.pid}`;
let counter = 0;
const unique = (prefix: string) => `${prefix}-${suffix}-${(counter += 1)}`;

async function createPublication(overrides: Record<string, unknown> = {}) {
  return prisma.publication.create({
    data: {
      stableKey: unique("publication:external:v1"),
      publicationType: "research-article",
      recordSource: "external-publication",
      identityEvidenceJson: JSON.stringify({
        basis: "registration",
        registrationKey: unique("reg"),
      }),
      ...overrides,
    },
  });
}

async function createVersion(publicationId: string, overrides: Record<string, unknown> = {}) {
  return prisma.publicationVersion.create({
    data: {
      publicationId,
      stableKey: unique("publication-version:v1"),
      sourcesSha256: digest("1"),
      adapterType: "myst",
      adapterBindingJson: JSON.stringify({ type: "myst", protocolVersion: "0.2.0" }),
      structuralProvenance: "published-structure",
      observedAt: new Date("2026-08-23T00:00:00.000Z"),
      ...overrides,
    },
  });
}

describe.skipIf(!enabled)("publication boundary on PostgreSQL", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps the node-version source union exclusive with five real sources", async () => {
    const [check] = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'KnowledgeNodeVersion_source_union_check'
    `;
    expect(check?.definition).toBeDefined();
    for (const column of [
      "snapshotId",
      "sourceReviewVersionId",
      "sourceClaimId",
      "sourceCitationId",
      "sourcePublicationClaimOccurrenceId",
    ]) {
      expect(check!.definition).toContain(column);
    }
    expect(check!.definition).toContain("= 1");
  });

  it("refuses source-byte provenance without an obtainable source", async () => {
    const publication = await createPublication();
    await expect(
      createVersion(publication.id, { structuralProvenance: "source-byte" }),
    ).rejects.toThrow();
    await expect(
      createVersion(publication.id, { structuralProvenance: "peer-reviewed" }),
    ).rejects.toThrow();
    const accepted = await createVersion(publication.id, {
      structuralProvenance: "source-byte",
      sourceDescriptorJson: JSON.stringify({
        type: "git",
        repository: "https://github.com/lab/review",
      }),
    });
    expect(accepted.structuralProvenance).toBe("source-byte");
  });

  it("lets distinct publications share a sourcesSha256 but not one publication", async () => {
    const left = await createPublication();
    const right = await createPublication();
    const leftVersion = await createVersion(left.id);
    const rightVersion = await createVersion(right.id);
    expect(rightVersion.sourcesSha256).toBe(leftVersion.sourcesSha256);
    await expect(createVersion(left.id)).rejects.toThrow();
  });

  it("keeps a publication's identity key and keying evidence immutable", async () => {
    const publication = await createPublication();
    await expect(
      prisma.$executeRaw`UPDATE "Publication" SET "stableKey" = 'publication:external:v1:rewritten' WHERE "id" = ${publication.id}`,
    ).rejects.toThrow(/Publication identity is immutable/);
    await expect(
      prisma.$executeRaw`UPDATE "Publication" SET "identityEvidenceJson" = '{}' WHERE "id" = ${publication.id}`,
    ).rejects.toThrow(/Publication identity is immutable/);
    const corrected = await prisma.publication.update({
      where: { id: publication.id },
      data: { publicationType: "preprint" },
    });
    expect(corrected.stableKey).toBe(publication.stableKey);
  });

  it("rejects updating or deleting an observed capture", async () => {
    const publication = await createPublication();
    const version = await createVersion(publication.id);
    const capture = await prisma.publicationCapture.create({
      data: {
        publicationVersionId: version.id,
        artifactKind: "publication-manifest",
        mediaType: "application/json",
        contentSha256: digest("d"),
        byteLength: 512,
        contentBytes: '{"schemaVersion":"0.2.0"}',
        structuralProvenance: "published-structure",
        capturedAt: new Date("2026-08-23T00:00:00.000Z"),
      },
    });
    await expect(
      prisma.$executeRaw`UPDATE "PublicationCapture" SET "contentBytes" = '{}' WHERE "id" = ${capture.id}`,
    ).rejects.toThrow(/Publication capture bytes are immutable/);
    await expect(
      prisma.$executeRaw`DELETE FROM "PublicationCapture" WHERE "id" = ${capture.id}`,
    ).rejects.toThrow(/Publication capture bytes are immutable/);
    await expect(
      prisma.$executeRaw`UPDATE "PublicationVersion" SET "title" = 'Rewritten' WHERE "id" = ${version.id}`,
    ).rejects.toThrow(/An observed publication version is immutable/);
  });

  it("keeps a source occurrence immutable and its canonical binding write-once", async () => {
    const publication = await createPublication();
    const version = await createVersion(publication.id);
    const occurrence = await prisma.publicationClaimOccurrence.create({
      data: {
        publicationVersionId: version.id,
        sourceLocalClaimId: "hpa-axis-mediation",
        stableKey: unique("publication-claim-occurrence:v1"),
        targetJson: JSON.stringify({ type: "myst-xref", identifier: "hpa-axis-mediation" }),
        sourceBindingJson: "{}",
        selectorJson: "{}",
        declarationSha256: digest("c"),
        declarationAuthority: "publication-source",
        text: "Adolescent stress alters HPA reactivity.",
      },
    });
    await expect(
      prisma.$executeRaw`UPDATE "PublicationClaimOccurrence" SET "text" = 'Rewritten' WHERE "id" = ${occurrence.id}`,
    ).rejects.toThrow(/A publication claim occurrence is immutable/);
    await expect(
      prisma.$executeRaw`DELETE FROM "PublicationClaimOccurrence" WHERE "id" = ${occurrence.id}`,
    ).rejects.toThrow(/A publication claim occurrence is immutable/);
    await expect(
      prisma.publicationClaimOccurrence.create({
        data: {
          publicationVersionId: version.id,
          sourceLocalClaimId: "hpa-axis-mediation",
          stableKey: unique("publication-claim-occurrence:v1"),
          targetJson: "{}",
          sourceBindingJson: "{}",
          selectorJson: "{}",
          declarationSha256: digest("c"),
          declarationAuthority: "publication-source",
          text: "A second declaration under one local id.",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.publicationClaimOccurrence.create({
        data: {
          publicationVersionId: version.id,
          sourceLocalClaimId: "review-manifest-owned",
          stableKey: unique("publication-claim-occurrence:v1"),
          targetJson: "{}",
          sourceBindingJson: "{}",
          selectorJson: "{}",
          declarationSha256: digest("c"),
          declarationAuthority: "review-manifest",
          text: null,
        },
      }),
    ).rejects.toThrow();
    const delegated = await prisma.publicationClaimOccurrence.create({
      data: {
        publicationVersionId: version.id,
        sourceLocalClaimId: "review-manifest-owned-valid",
        stableKey: unique("publication-claim-occurrence:v1"),
        targetJson: "{}",
        sourceBindingJson: "{}",
        selectorJson: "{}",
        declarationSha256: digest("d"),
        declarationAuthority: "review-manifest",
        text: "Authoritative text from the delegated review manifest.",
      },
    });
    expect(delegated.text).toContain("Authoritative text");
  });
});
