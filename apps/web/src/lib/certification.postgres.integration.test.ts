import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@oratlas/contracts";

vi.mock("server-only", () => ({}));
import { prisma } from "./db";
import {
  createCertificationProtocol,
  createCertifier,
  getCertificationInput,
  submitCertificationResult,
} from "./certification";

const enabled = Boolean(process.env.CERTIFICATION_TEST_DATABASE_URL);
const suffix = `${Date.now()}-${process.pid}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("certification result races on PostgreSQL", () => {
  afterAll(async () => prisma.$disconnect());

  it("converges exact concurrent submissions on one immutable result and issued event", async () => {
    const admin = await prisma.user.create({
      data: { githubLogin: `certification-admin-${suffix}`, role: "ADMIN" },
    });
    const publication = await prisma.publication.create({
      data: {
        stableKey: `certification-publication-${suffix}`,
        publicationType: "research-article",
        recordSource: "external-publication",
        identityEvidenceJson: canonicalJson({ basis: "registration", registrationKey: suffix }),
      },
    });
    const version = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: `certification-version-${suffix}`,
        sourcesSha256: sha(`source-${suffix}`),
        observedPublicationBaseUrl: "https://certification.example/article/",
        adapterType: "myst",
        adapterBindingJson: canonicalJson({ type: "myst", protocolVersion: "0.2.0" }),
        structuralProvenance: "published-structure",
        verificationWarningsJson: "[]",
        observedAt: new Date("2026-08-24T12:00:00.000Z"),
      },
    });
    await prisma.publicationCapture.create({
      data: {
        publicationVersionId: version.id,
        artifactKind: "publication-manifest",
        artifactIdentitySha256: sha(`slot-${suffix}`),
        requestedUrl: "https://certification.example/article/oratlas.manifest.json",
        observedUrl: "https://certification.example/article/oratlas.manifest.json",
        mediaType: "application/json",
        contentSha256: sha(`manifest-${suffix}`),
        byteLength: 2,
        contentBytes: "{}",
        structuralProvenance: "published-structure",
        capturedAt: new Date("2026-08-24T12:00:00.000Z"),
      },
    });
    const occurrence = await prisma.publicationClaimOccurrence.create({
      data: {
        publicationVersionId: version.id,
        sourceLocalClaimId: "claim",
        stableKey: `certification-occurrence-${suffix}`,
        targetJson: canonicalJson({ type: "myst-xref", identifier: "claim", htmlId: "claim" }),
        publishedUrl: "https://certification.example/article/#claim",
        sourceBindingJson: canonicalJson({
          documentPath: "article.md",
          documentSha256: sha("document"),
          startLine: 1,
          endLine: 1,
          blockSha256: sha("block"),
        }),
        selectorJson: canonicalJson({
          representation: "oratlas-myst-source-utf8-v1",
          unit: "body",
          textQuote: { type: "TextQuoteSelector", exact: "Claim" },
          textPosition: { type: "TextPositionSelector", start: 0, end: 5 },
        }),
        declarationSha256: sha(`claim-${suffix}`),
        declarationAuthority: "publication-source",
        text: "Claim",
      },
    });
    const certifier = await createCertifier(
      {
        slug: `race-${suffix}`,
        name: "Race fixture certifier",
        description: "PostgreSQL concurrency fixture.",
      },
      admin.id,
    );
    const protocol = await createCertificationProtocol(
      {
        certifierId: certifier.id,
        seriesKey: "generic",
        version: "1.0.0",
        title: "Generic",
        description: "Generic concurrency protocol.",
        definition: {
          criteria: [
            {
              id: "criterion",
              title: "Criterion",
              description: "Generic required criterion.",
              required: true,
              allowedStatuses: ["pass"],
              evidenceRequired: true,
            },
          ],
          assessmentModes: ["human"],
          outcomes: ["certified"],
          requireCompleteSections: ["occurrences"],
        },
      },
      admin.id,
    );
    const packet = await (
      await import("./publication-version-packet")
    ).getPublicationVersionPacket(version.id);
    const packetJson = canonicalJson(packet);
    const run = await prisma.certificationRun.create({
      data: {
        publicationVersionId: version.id,
        certifierId: certifier.id,
        protocolId: protocol.id,
        assessmentMode: "human",
        status: "running",
        idempotencyKey: `race-${suffix}`,
        inputPacketJson: packetJson,
        inputPacketSha256: sha(packetJson),
        packetSchemaVersion: packet.schemaVersion,
        completenessJson: canonicalJson(packet.completeness),
        capturedAt: new Date(),
        startedAt: new Date(),
      },
    });
    const input = await getCertificationInput(run.id, certifier.id);
    const submission = {
      schemaVersion: "1.0.0" as const,
      packetSha256: input.packetSha256,
      criteria: [
        {
          criterionId: "criterion",
          status: "pass" as const,
          rationale: "Exact captured occurrence reviewed.",
          evidenceRefs: [{ type: "publication-occurrence" as const, id: occurrence.id }],
        },
      ],
      outcome: "certified" as const,
      limitations: [],
      conflictOfInterest: { status: "none-declared" as const },
      independence: { declared: true, statement: "Independent fixture assessment." },
      provenance: {},
    };
    const results = await Promise.all([
      submitCertificationResult(run.id, submission, { certifierId: certifier.id }),
      submitCertificationResult(run.id, submission, { certifierId: certifier.id }),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await prisma.certificationResult.count({ where: { certificationRunId: run.id } })).toBe(
      1,
    );
    expect(
      await prisma.certificationLifecycleEvent.count({
        where: { resultId: results[0]!.id, kind: "issued" },
      }),
    ).toBe(1);
    expect(
      (await prisma.certificationRun.findUniqueOrThrow({ where: { id: run.id } })).status,
    ).toBe("completed");
  });
});
