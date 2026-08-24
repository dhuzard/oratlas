import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client/index.js";
import { applyDatabaseGuards } from "./database-guards.js";
import {
  materializePublicationClaimOccurrence,
  PublicationClaimMaterializationError,
} from "./publication-claim-materialization.js";

/**
 * Database-native behaviour of the generic publication boundary, plus a
 * characterization of the pre-existing canonical source union so the additive
 * external-publication source is proven not to have relaxed it.
 */

const databasePath = join(tmpdir(), `oratlas-publication-${process.pid}-${Date.now()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}?connection_limit=1`;
let prisma: PrismaClient;

const digest = (seed: string) => seed.repeat(64).slice(0, 64);
const SOURCES_V1 = digest("1");
const SOURCES_V2 = digest("2");

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

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
      sourcesSha256: SOURCES_V1,
      adapterType: "myst",
      adapterBindingJson: JSON.stringify({
        type: "myst",
        protocolVersion: "0.2.0",
        crossReferenceInventoryPath: "myst.xref.json",
        generatorName: "@oratlas/myst",
        generatorVersion: "0.2.0",
      }),
      structuralProvenance: "published-structure",
      canonicalUrl: "https://publication.example/article/",
      observedPublicationBaseUrl: "https://observed.example/article/",
      observedAt: new Date("2026-08-23T00:00:00.000Z"),
      ...overrides,
    },
  });
}

async function createOccurrence(
  publicationVersionId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.publicationClaimOccurrence.create({
    data: {
      publicationVersionId,
      sourceLocalClaimId: "hpa-axis-mediation",
      stableKey: unique("publication-claim-occurrence:v1"),
      targetJson: JSON.stringify({
        type: "myst-xref",
        identifier: "hpa-axis-mediation",
        htmlId: "hpa-axis-mediation",
      }),
      publishedUrl: "https://publication.example/article/results/#hpa-axis-mediation",
      sourceBindingJson: JSON.stringify({
        documentPath: "results.md",
        documentSha256: digest("a"),
        startLine: 12,
        endLine: 23,
        blockSha256: digest("b"),
      }),
      selectorJson: JSON.stringify({
        representation: "oratlas-myst-source-utf8-v1",
        unit: "block",
        textQuote: {
          type: "TextQuoteSelector",
          exact: "Adolescent stress alters HPA reactivity.",
        },
        textPosition: { type: "TextPositionSelector", start: 0, end: 40 },
      }),
      declarationSha256: digest("c"),
      declarationAuthority: "publication-source",
      text: "Adolescent stress alters HPA reactivity.",
      ...overrides,
    },
  });
}

describe("publication boundary on SQLite", () => {
  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--schema",
        resolve(process.cwd(), "packages/db/prisma/schema.prisma"),
        "--skip-generate",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
    );
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await applyDatabaseGuards(prisma, "sqlite");
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    for (const path of [
      databasePath,
      `${databasePath}-journal`,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]) {
      if (existsSync(path)) rmSync(path);
    }
  });

  describe("characterization: the pre-existing canonical source union", () => {
    it("still accepts a repository-backed node version", async () => {
      const repository = await prisma.repository.create({
        data: {
          owner: "lab",
          name: unique("repo"),
          canonicalUrl: unique("https://github.com/lab"),
        },
      });
      const snapshot = await prisma.repositorySnapshot.create({
        data: {
          repositoryId: repository.id,
          commitSha: "0".repeat(39) + "1",
          inspectionStatus: "succeeded",
          inspectionReportJson: "{}",
          contentHash: digest("e"),
        },
      });
      const node = await prisma.knowledgeNode.create({
        data: {
          repositoryId: repository.id,
          originType: "repository-object",
          localNodeId: unique("node"),
          kind: "claim",
        },
      });
      const version = await prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: node.id,
          snapshotId: snapshot.id,
          title: "Repository claim",
          contributorsJson: "[]",
          license: "CC0-1.0",
          provenanceJson: "{}",
          payloadJson: "{}",
        },
      });
      expect(version.snapshotId).toBe(snapshot.id);
      expect(version.sourcePublicationClaimOccurrenceId).toBeNull();
    });

    it("still rejects a node version with no exact source", async () => {
      const node = await prisma.knowledgeNode.create({
        data: {
          stableKey: unique("work:doi:10.1000"),
          originType: "canonical-work",
          localNodeId: unique("work"),
          kind: "work",
        },
      });
      await expect(
        prisma.knowledgeNodeVersion.create({
          data: {
            knowledgeNodeId: node.id,
            contributorsJson: "[]",
            provenanceJson: "{}",
            payloadJson: "{}",
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects a node version that combines the new source with an existing one", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      const occurrence = await createOccurrence(version.id);
      const repository = await prisma.repository.create({
        data: {
          owner: "lab",
          name: unique("repo"),
          canonicalUrl: unique("https://github.com/lab"),
        },
      });
      const snapshot = await prisma.repositorySnapshot.create({
        data: {
          repositoryId: repository.id,
          commitSha: "0".repeat(39) + "2",
          inspectionStatus: "succeeded",
          inspectionReportJson: "{}",
          contentHash: digest("e"),
        },
      });
      const node = await prisma.knowledgeNode.create({
        data: {
          repositoryId: repository.id,
          originType: "repository-object",
          localNodeId: unique("node"),
          kind: "claim",
        },
      });
      await expect(
        prisma.knowledgeNodeVersion.create({
          data: {
            knowledgeNodeId: node.id,
            snapshotId: snapshot.id,
            sourcePublicationClaimOccurrenceId: occurrence.id,
            contributorsJson: "[]",
            provenanceJson: "{}",
            payloadJson: "{}",
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("publication identity", () => {
    it("accepts every generic publication type", async () => {
      for (const publicationType of [
        "review-article",
        "research-article",
        "methods-article",
        "preprint",
        "living-review",
        "other",
      ]) {
        const publication = await createPublication({ publicationType });
        expect(publication.publicationType).toBe(publicationType);
      }
    });

    it("keeps two versions of one publication under one stable identity", async () => {
      const publication = await createPublication();
      const first = await createVersion(publication.id);
      const second = await createVersion(publication.id, { sourcesSha256: SOURCES_V2 });
      expect(second.publicationId).toBe(first.publicationId);
      expect(second.id).not.toBe(first.id);
      const versions = await prisma.publicationVersion.findMany({
        where: { publicationId: publication.id },
      });
      expect(versions).toHaveLength(2);
    });

    it("rejects a repeated exact version inside one publication", async () => {
      const publication = await createPublication();
      await createVersion(publication.id);
      await expect(createVersion(publication.id)).rejects.toThrow();
    });

    it("lets two distinct publications carry an identical sourcesSha256", async () => {
      const left = await createPublication();
      const right = await createPublication();
      const leftVersion = await createVersion(left.id);
      const rightVersion = await createVersion(right.id);
      expect(rightVersion.sourcesSha256).toBe(leftVersion.sourcesSha256);
      expect(rightVersion.publicationId).not.toBe(leftVersion.publicationId);
    });

    it("keeps a publication's identity key and keying evidence immutable", async () => {
      const publication = await createPublication();
      await expect(
        prisma.$executeRaw`UPDATE "Publication" SET "stableKey" = 'publication:external:v1:rewritten' WHERE "id" = ${publication.id}`,
      ).rejects.toThrow("Publication identity is immutable");
      await expect(
        prisma.$executeRaw`UPDATE "Publication" SET "identityEvidenceJson" = '{}' WHERE "id" = ${publication.id}`,
      ).rejects.toThrow("Publication identity is immutable");
      // A presentation-level correction is still permitted.
      const corrected = await prisma.publication.update({
        where: { id: publication.id },
        data: { publicationType: "preprint" },
      });
      expect(corrected.publicationType).toBe("preprint");
      expect(corrected.stableKey).toBe(publication.stableKey);
    });

    it("binds a review projection to its review and an external publication to none", async () => {
      const review = await prisma.review.create({
        data: { slug: unique("review"), title: "Legacy review" },
      });
      const projection = await prisma.publication.create({
        data: {
          stableKey: `publication:review:v1:${review.id}`,
          publicationType: "review-article",
          recordSource: "atlas-review-projection",
          identityEvidenceJson: JSON.stringify({ basis: "atlas-review", reviewId: review.id }),
          reviewId: review.id,
        },
      });
      expect(projection.reviewId).toBe(review.id);
      await expect(
        createPublication({ recordSource: "atlas-review-projection" }),
      ).rejects.toThrow();
      await expect(
        prisma.publication.create({
          data: {
            stableKey: unique("publication:external:v1"),
            publicationType: "review-article",
            recordSource: "external-publication",
            identityEvidenceJson: "{}",
            reviewId: review.id,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("structural provenance", () => {
    it("refuses source-byte provenance without an obtainable source", async () => {
      const publication = await createPublication();
      await expect(
        createVersion(publication.id, { structuralProvenance: "source-byte" }),
      ).rejects.toThrow();
      const withSource = await createVersion(publication.id, {
        structuralProvenance: "source-byte",
        sourceDescriptorJson: JSON.stringify({
          type: "git",
          repository: "https://github.com/lab/review",
        }),
      });
      expect(withSource.structuralProvenance).toBe("source-byte");
    });

    it("refuses a provenance value outside the structural vocabulary", async () => {
      const publication = await createPublication();
      await expect(
        createVersion(publication.id, { structuralProvenance: "peer-reviewed" }),
      ).rejects.toThrow();
      await expect(
        createVersion(publication.id, { structuralProvenance: "verified" }),
      ).rejects.toThrow();
    });
  });

  describe("immutable captures", () => {
    it("rejects updating or deleting an observed capture", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      const capture = await prisma.publicationCapture.create({
        data: {
          publicationVersionId: version.id,
          artifactKind: "publication-manifest",
          artifactIdentitySha256: digest("e"),
          declaredPath: "oratlas.manifest.json",
          mediaType: "application/json",
          contentSha256: digest("d"),
          byteLength: 512,
          contentBytes: '{"schemaVersion":"0.2.0"}',
          declaredSha256: digest("d"),
          structuralProvenance: "published-structure",
          capturedAt: new Date("2026-08-23T00:00:00.000Z"),
        },
      });
      // Raw SQL so the guard's own message surfaces: the Prisma client maps
      // every SQLite constraint failure onto one generic error.
      await expect(
        prisma.$executeRaw`UPDATE "PublicationCapture" SET "contentBytes" = '{}' WHERE "id" = ${capture.id}`,
      ).rejects.toThrow("Publication capture bytes are immutable");
      await expect(
        prisma.$executeRaw`DELETE FROM "PublicationCapture" WHERE "id" = ${capture.id}`,
      ).rejects.toThrow("Publication capture bytes are immutable");
      const stored = await prisma.publicationCapture.findUniqueOrThrow({
        where: { id: capture.id },
      });
      expect(stored.contentBytes).toBe('{"schemaVersion":"0.2.0"}');
    });

    it("rejects a capture whose digests are not exact", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      await expect(
        prisma.publicationCapture.create({
          data: {
            publicationVersionId: version.id,
            artifactKind: "publication-manifest",
            artifactIdentitySha256: digest("e"),
            mediaType: "application/json",
            contentSha256: "NOT-A-DIGEST",
            byteLength: 10,
            structuralProvenance: "published-structure",
            capturedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.publicationCapture.create({
          data: {
            publicationVersionId: version.id,
            artifactKind: "screenshot",
            artifactIdentitySha256: digest("e"),
            mediaType: "application/json",
            contentSha256: digest("d"),
            byteLength: 10,
            structuralProvenance: "published-structure",
            capturedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects rewriting an observed publication version", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      await expect(
        prisma.$executeRaw`UPDATE "PublicationVersion" SET "sourcesSha256" = ${SOURCES_V2} WHERE "id" = ${version.id}`,
      ).rejects.toThrow("An observed publication version is immutable");
      await expect(
        prisma.$executeRaw`UPDATE "PublicationVersion" SET "contentCorpusJson" = '[]' WHERE "id" = ${version.id}`,
      ).rejects.toThrow("An observed publication version is immutable");
      await expect(
        prisma.$executeRaw`DELETE FROM "PublicationVersion" WHERE "id" = ${version.id}`,
      ).rejects.toThrow("An observed publication version is immutable");
    });
  });

  describe("source claim occurrences", () => {
    it("rejects a duplicated source-local claim id inside one version", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      await createOccurrence(version.id);
      await expect(createOccurrence(version.id)).rejects.toThrow();
    });

    it("allows the same source-local claim id in two versions of one publication", async () => {
      const publication = await createPublication();
      const first = await createVersion(publication.id);
      const second = await createVersion(publication.id, { sourcesSha256: SOURCES_V2 });
      const left = await createOccurrence(first.id);
      const right = await createOccurrence(second.id);
      expect(right.sourceLocalClaimId).toBe(left.sourceLocalClaimId);
      expect(right.id).not.toBe(left.id);
    });

    it("does not merge occurrences that share a declaration digest", async () => {
      const publication = await createPublication();
      const first = await createVersion(publication.id);
      const second = await createVersion(publication.id, { sourcesSha256: SOURCES_V2 });
      const left = await createOccurrence(first.id);
      const right = await createOccurrence(second.id);
      expect(right.declarationSha256).toBe(left.declarationSha256);
      expect(left.knowledgeNodeId).toBeNull();
      expect(right.knowledgeNodeId).toBeNull();
      const shared = await prisma.publicationClaimOccurrence.findMany({
        where: { declarationSha256: left.declarationSha256 },
      });
      expect(shared.length).toBeGreaterThanOrEqual(2);
    });

    it("keeps the canonical binding write-once", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      const occurrence = await createOccurrence(version.id);
      const node = await prisma.knowledgeNode.create({
        data: {
          stableKey: unique("claim-occurrence"),
          originType: "claim-occurrence",
          localNodeId: unique("claim"),
          kind: "claim",
        },
      });
      const other = await prisma.knowledgeNode.create({
        data: {
          stableKey: unique("claim-occurrence"),
          originType: "claim-occurrence",
          localNodeId: unique("claim"),
          kind: "claim",
        },
      });
      const bound = await prisma.publicationClaimOccurrence.update({
        where: { id: occurrence.id },
        data: { knowledgeNodeId: node.id },
      });
      expect(bound.knowledgeNodeId).toBe(node.id);
      await expect(
        prisma.$executeRaw`UPDATE "PublicationClaimOccurrence" SET "knowledgeNodeId" = ${other.id} WHERE "id" = ${occurrence.id}`,
      ).rejects.toThrow("A publication claim occurrence is immutable");
      await expect(
        prisma.$executeRaw`UPDATE "PublicationClaimOccurrence" SET "text" = 'Rewritten declaration.' WHERE "id" = ${occurrence.id}`,
      ).rejects.toThrow("A publication claim occurrence is immutable");
      await expect(
        prisma.$executeRaw`DELETE FROM "PublicationClaimOccurrence" WHERE "id" = ${occurrence.id}`,
      ).rejects.toThrow("A publication claim occurrence is immutable");
      const preserved = await prisma.publicationClaimOccurrence.findUniqueOrThrow({
        where: { id: occurrence.id },
      });
      expect(preserved.knowledgeNodeId).toBe(node.id);
      expect(preserved.text).toBe("Adolescent stress alters HPA reactivity.");
    });

    it("holds each occurrence to exactly one declaration authority", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      await expect(
        createOccurrence(version.id, { declarationAuthority: "publication-source", text: null }),
      ).rejects.toThrow();
      await expect(
        createOccurrence(version.id, {
          declarationAuthority: "review-manifest",
          text: null,
          claimType: null,
          qualification: null,
        }),
      ).rejects.toThrow();
      const bound = await createOccurrence(version.id, {
        declarationAuthority: "review-manifest",
        text: "Authoritative text from the delegated review manifest.",
      });
      expect(bound.text).toContain("Authoritative text");
    });
  });

  describe("generic canonical occurrence materialization", () => {
    it("atomically creates and idempotently reuses one exact canonical claim", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      const occurrence = await createOccurrence(version.id);

      const first = await prisma.$transaction((tx) =>
        materializePublicationClaimOccurrence(tx, occurrence.id),
      );
      const replay = await prisma.$transaction((tx) =>
        materializePublicationClaimOccurrence(tx, occurrence.id),
      );

      expect(first.idempotent).toBe(false);
      expect(replay).toEqual({ ...first, idempotent: true });
      const stored = await prisma.publicationClaimOccurrence.findUniqueOrThrow({
        where: { id: occurrence.id },
        include: { graphVersion: true },
      });
      expect(stored.knowledgeNodeId).toBe(first.knowledgeNodeId);
      expect(stored.graphVersion?.id).toBe(first.knowledgeNodeVersionId);
      expect(stored.graphVersion?.sourcePublicationClaimOccurrenceId).toBe(occurrence.id);
      expect(stored.graphVersion?.snapshotId).toBeNull();
    });

    it("materializes from observed addressing when the publisher declares no canonical URL", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id, { canonicalUrl: null });
      const occurrence = await createOccurrence(version.id, {
        publishedUrl: "https://observed.example/article/results/#hpa-axis-mediation",
      });

      const result = await prisma.$transaction((tx) =>
        materializePublicationClaimOccurrence(tx, occurrence.id),
      );
      const graphVersion = await prisma.knowledgeNodeVersion.findUniqueOrThrow({
        where: { id: result.knowledgeNodeVersionId },
      });
      expect(JSON.parse(graphVersion.provenanceJson)).toMatchObject({
        repositoryUrl: "https://observed.example/article/",
      });
    });

    it("never merges equal text, local ids, or digests across exact versions", async () => {
      const publication = await createPublication();
      const firstVersion = await createVersion(publication.id);
      const secondVersion = await createVersion(publication.id, { sourcesSha256: SOURCES_V2 });
      const left = await createOccurrence(firstVersion.id);
      const right = await createOccurrence(secondVersion.id);

      const leftGraph = await prisma.$transaction((tx) =>
        materializePublicationClaimOccurrence(tx, left.id),
      );
      const rightGraph = await prisma.$transaction((tx) =>
        materializePublicationClaimOccurrence(tx, right.id),
      );

      expect(left.sourceLocalClaimId).toBe(right.sourceLocalClaimId);
      expect(left.declarationSha256).toBe(right.declarationSha256);
      expect(leftGraph.knowledgeNodeId).not.toBe(rightGraph.knowledgeNodeId);
      expect(leftGraph.knowledgeNodeVersionId).not.toBe(rightGraph.knowledgeNodeVersionId);
    });

    it("fails closed on a conflicting half-binding", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id);
      const leftNode = await prisma.knowledgeNode.create({
        data: {
          stableKey: unique("publication-claim-left"),
          originType: "claim-occurrence",
          localNodeId: unique("left"),
          kind: "claim",
        },
      });
      const rightNode = await prisma.knowledgeNode.create({
        data: {
          stableKey: unique("publication-claim-right"),
          originType: "claim-occurrence",
          localNodeId: unique("right"),
          kind: "claim",
        },
      });
      const occurrence = await createOccurrence(version.id, { knowledgeNodeId: leftNode.id });
      await prisma.knowledgeNodeVersion.create({
        data: {
          knowledgeNodeId: rightNode.id,
          sourcePublicationClaimOccurrenceId: occurrence.id,
          text: occurrence.text,
          contributorsJson: "[]",
          provenanceJson: JSON.stringify({ sourcePath: "results.md" }),
          payloadJson: JSON.stringify({ statement: occurrence.text, qualifiers: [] }),
        },
      });

      await expect(
        prisma.$transaction((tx) => materializePublicationClaimOccurrence(tx, occurrence.id)),
      ).rejects.toBeInstanceOf(PublicationClaimMaterializationError);
      expect(
        (
          await prisma.publicationClaimOccurrence.findUniqueOrThrow({
            where: { id: occurrence.id },
          })
        ).knowledgeNodeId,
      ).toBe(leftNode.id);
    });

    it("does not inspect adapter bindings after occurrence normalization", async () => {
      const publication = await createPublication();
      const version = await createVersion(publication.id, {
        adapterBindingJson: JSON.stringify({ type: "synthetic-normalized-fixture" }),
      });
      const occurrence = await createOccurrence(version.id);
      const result = await prisma.$transaction((tx) =>
        materializePublicationClaimOccurrence(tx, occurrence.id),
      );
      expect(result.knowledgeNodeId).toBeTruthy();
    });
  });
});
