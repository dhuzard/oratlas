import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "./db";
import { materializeExternalPublicationClaim } from "./external-publication-materialization";

const enabled = Boolean(process.env.PUBLICATION_MATERIALIZATION_TEST_DATABASE_URL);
const suffix = `${Date.now()}-${process.pid}`;
const digest = (seed: string) => seed.repeat(64).slice(0, 64);

describe.skipIf(!enabled)("external occurrence materialization on PostgreSQL", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("converges concurrent exact requests with one audit event and no half-binding", async () => {
    const editor = await prisma.user.create({
      data: { githubLogin: `materializer-${suffix}`, role: "EDITOR" },
    });
    const publication = await prisma.publication.create({
      data: {
        stableKey: `publication:concurrent:${suffix}`,
        publicationType: "research-article",
        recordSource: "external-publication",
        identityEvidenceJson: JSON.stringify({
          basis: "registration",
          registrationKey: `registration-${suffix}`,
        }),
      },
    });
    const version = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: `publication-version:concurrent:${suffix}`,
        sourcesSha256: digest("a"),
        canonicalUrl: null,
        observedPublicationBaseUrl: "https://concurrent.example/article/",
        adapterType: "myst",
        adapterBindingJson: JSON.stringify({ type: "myst", protocolVersion: "0.2.0" }),
        structuralProvenance: "published-structure",
        observedAt: new Date("2026-08-24T00:00:00.000Z"),
      },
    });
    await prisma.publicationCapture.create({
      data: {
        publicationVersionId: version.id,
        artifactKind: "publication-manifest",
        artifactIdentitySha256: digest("b"),
        requestedUrl: "https://concurrent.example/article/oratlas.manifest.json",
        observedUrl: "https://concurrent.example/article/oratlas.manifest.json",
        mediaType: "application/json",
        contentSha256: digest("c"),
        byteLength: 2,
        contentBytes: "{}",
        structuralProvenance: "published-structure",
        capturedAt: new Date("2026-08-24T00:00:00.000Z"),
      },
    });
    const text = "Concurrent materialization preserves one exact canonical claim.";
    const occurrence = await prisma.publicationClaimOccurrence.create({
      data: {
        publicationVersionId: version.id,
        sourceLocalClaimId: "concurrent-claim",
        stableKey: `publication-claim-occurrence:concurrent:${suffix}`,
        targetJson: JSON.stringify({
          type: "myst-xref",
          identifier: "concurrent-claim",
          htmlId: "concurrent-claim",
        }),
        publishedUrl: "https://concurrent.example/article/results/#concurrent-claim",
        sourceBindingJson: JSON.stringify({
          documentPath: "results.md",
          documentSha256: digest("d"),
          startLine: 1,
          endLine: 1,
          blockSha256: digest("e"),
        }),
        selectorJson: JSON.stringify({
          representation: "oratlas-myst-source-utf8-v1",
          unit: "block",
          textQuote: { type: "TextQuoteSelector", exact: text },
          textPosition: { type: "TextPositionSelector", start: 0, end: text.length },
        }),
        declarationSha256: digest("f"),
        declarationAuthority: "publication-source",
        text,
      },
    });

    const results = await Promise.all([
      materializeExternalPublicationClaim(occurrence.id, editor.id),
      materializeExternalPublicationClaim(occurrence.id, editor.id),
    ]);

    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.knowledgeNodeId)).size).toBe(1);
    expect(new Set(results.map((result) => result.knowledgeNodeVersionId)).size).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "external-publication-claim.materialize",
          subjectId: occurrence.id,
        },
      }),
    ).toBe(1);
    const stored = await prisma.publicationClaimOccurrence.findUniqueOrThrow({
      where: { id: occurrence.id },
      include: { graphVersion: true },
    });
    expect(stored.knowledgeNodeId).toBe(results[0]!.knowledgeNodeId);
    expect(stored.graphVersion?.knowledgeNodeId).toBe(stored.knowledgeNodeId);
    expect(stored.graphVersion?.sourcePublicationClaimOccurrenceId).toBe(occurrence.id);
    expect(
      await prisma.knowledgeNodeVersion.count({
        where: { sourcePublicationClaimOccurrenceId: occurrence.id },
      }),
    ).toBe(1);
  });
});
