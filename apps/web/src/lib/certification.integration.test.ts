import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
  publicCertificationSummarySchema,
  type CertificationProtocolDefinition,
} from "@oratlas/contracts";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";
import type {
  addCertificationLifecycle,
  authenticateCertifier,
  createCertificationProtocol,
  createCertificationRun,
  createCertifier,
  getCertificationInput,
  getCertificationRun,
  issueCertifierCredential,
  listPublicationVersionCertifications,
  retireCertificationProtocol,
  revokeCertifierCredential,
  setCertifierStatus,
  submitCertificationResult,
  transitionCertificationRun,
} from "./certification";

vi.mock("server-only", () => ({}));
const databaseName = `oratlas-certification-${process.pid}-${Date.now()}.db`;
const databasePath = join(process.cwd(), "packages", "db", "prisma", databaseName);
const databaseUrl = `file:./${databaseName}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
let prisma: PrismaClient;
type CertificationService = {
  addCertificationLifecycle: typeof addCertificationLifecycle;
  authenticateCertifier: typeof authenticateCertifier;
  createCertificationProtocol: typeof createCertificationProtocol;
  createCertificationRun: typeof createCertificationRun;
  createCertifier: typeof createCertifier;
  getCertificationInput: typeof getCertificationInput;
  getCertificationRun: typeof getCertificationRun;
  issueCertifierCredential: typeof issueCertifierCredential;
  listPublicationVersionCertifications: typeof listPublicationVersionCertifications;
  retireCertificationProtocol: typeof retireCertificationProtocol;
  revokeCertifierCredential: typeof revokeCertifierCredential;
  setCertifierStatus: typeof setCertifierStatus;
  submitCertificationResult: typeof submitCertificationResult;
  transitionCertificationRun: typeof transitionCertificationRun;
};
let service: CertificationService;
let adminId: string;
let versionId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  // Windows CI may deny the schema engine's create-file syscall while allowing
  // it to initialize an already-created workspace test file.
  writeFileSync(databasePath, "");
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
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
  );
  ({ prisma } = await import("./db"));
  await applyDatabaseGuards(prisma, "sqlite");
  service = await import("./certification");
  const admin = await prisma.user.create({ data: { githubLogin: "cert-admin", role: "ADMIN" } });
  adminId = admin.id;
  const publication = await prisma.publication.create({
    data: {
      stableKey: "certification-publication",
      publicationType: "research-article",
      recordSource: "external-publication",
      identityEvidenceJson: canonicalJson({
        basis: "registration",
        registrationKey: "certification-fixture",
      }),
      sourceLocalPublicationId: "cert-fixture",
    },
  });
  const contentText = "Methods\n\nWe used a prespecified scientific evaluation protocol.";
  const contentCorpusJson = canonicalJson([
    {
      id: "publication-content:certification-methods",
      title: "Methods",
      role: "methods",
      sourcePath: "content/methods.json",
      publishedUrl: "https://publisher.example/article/methods/",
      representation: "published-structured-text",
      text: contentText,
      sha256: sha(contentText),
      sourceArtifactIdentitySha256: sha("manifest-slot"),
      sourceArtifactSha256: sha("manifest"),
    },
  ]);
  const version = await prisma.publicationVersion.create({
    data: {
      publicationId: publication.id,
      stableKey: "certification-version-v1",
      sourceLocalPublicationId: "cert-fixture",
      sourcesSha256: sha("source-v1"),
      versionLabel: "v1",
      title: "Certification fixture",
      canonicalUrl: null,
      observedPublicationBaseUrl: "https://publisher.example/article/",
      adapterType: "myst",
      adapterBindingJson: canonicalJson({
        type: "myst",
        protocolVersion: "0.2.0",
        crossReferenceInventoryPath: "myst.xref.json",
        generatorName: "fixture",
        generatorVersion: "1.0.0",
      }),
      structuralProvenance: "published-structure",
      verificationWarningsJson: "[]",
      contentCorpusJson,
      contentCorpusSha256: sha(contentCorpusJson),
      contentCompletenessJson: canonicalJson({
        returnedDocuments: 1,
        totalDocumentsKnown: 1,
        truncated: false,
        coverage: "complete",
      }),
      observedAt: new Date("2026-08-24T10:00:00.000Z"),
    },
  });
  versionId = version.id;
  await prisma.publicationCapture.create({
    data: {
      publicationVersionId: version.id,
      artifactKind: "publication-manifest",
      artifactIdentitySha256: sha("manifest-slot"),
      declaredPath: null,
      observedUrl: "https://publisher.example/article/oratlas.manifest.json",
      requestedUrl: "https://publisher.example/article/oratlas.manifest.json",
      mediaType: "application/json",
      contentSha256: sha("manifest"),
      byteLength: 10,
      contentBytes: "{}",
      httpProvenanceJson: "{}",
      structuralProvenance: "published-structure",
      capturedAt: new Date("2026-08-24T10:00:00.000Z"),
    },
  });
  await prisma.publicationClaimOccurrence.create({
    data: {
      publicationVersionId: version.id,
      sourceLocalClaimId: "claim-1",
      stableKey: "certification-occurrence-1",
      targetJson: canonicalJson({ type: "myst-xref", identifier: "claim-1", htmlId: "claim-1" }),
      publishedUrl: "https://publisher.example/article/#claim-1",
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
      declarationSha256: sha("claim"),
      declarationAuthority: "publication-source",
      text: "Claim",
    },
  });
});
afterAll(async () => {
  await prisma?.$disconnect();
  if (existsSync(databasePath)) rmSync(databasePath);
});

const definition: CertificationProtocolDefinition = {
  criteria: [
    {
      id: "evidence",
      title: "Evidence",
      description: "Generic packet evidence criterion.",
      required: true,
      allowedStatuses: ["pass", "concern", "fail", "insufficient-evidence"],
      evidenceRequired: true,
    },
  ],
  assessmentModes: ["human"],
  outcomes: ["certified", "not-certified", "inconclusive"],
  requireCompleteSections: ["occurrences", "content"],
};
function request(token: string) {
  return new Request("https://atlas.example/api/certification-runs", {
    headers: { authorization: `Bearer ${token}` },
  });
}
function result(
  packetSha256: string,
  occurrenceId: string,
  outcome: "certified" | "not-certified" = "certified",
) {
  return {
    schemaVersion: "1.0.0" as const,
    packetSha256,
    criteria: [
      {
        criterionId: "evidence",
        status: outcome === "certified" ? ("pass" as const) : ("fail" as const),
        rationale: "Assessed against the captured occurrence.",
        evidenceRefs: [{ type: "publication-occurrence" as const, id: occurrenceId }],
      },
    ],
    outcome,
    limitations: [],
    conflictOfInterest: { status: "none-declared" as const },
    independence: { declared: true, statement: "The certifier declares independent assessment." },
    provenance: {},
  };
}

describe("generic certification platform", () => {
  it("supports API-scoped, immutable, contradictory attributed results without mutating epistemic layers", async () => {
    const certifierA = await service.createCertifier(
      { slug: "institute-a", name: "Institute A", description: "Independent certifier A." },
      adminId,
    );
    const certifierB = await service.createCertifier(
      { slug: "collective-b", name: "Collective B", description: "Independent certifier B." },
      adminId,
    );
    const protocolA = await service.createCertificationProtocol(
      {
        certifierId: certifierA.id,
        seriesKey: "generic-review",
        version: "1.0.0",
        title: "Generic review",
        description: "A fixture protocol.",
        definition,
      },
      adminId,
    );
    const protocolB = await service.createCertificationProtocol(
      {
        certifierId: certifierB.id,
        seriesKey: "generic-review",
        version: "1.0.0",
        title: "Generic review",
        description: "A fixture protocol.",
        definition,
      },
      adminId,
    );
    const credentialA = await service.issueCertifierCredential(
      certifierA.id,
      { label: "automation", scopes: ["certification:read", "certification:submit"] },
      adminId,
    );
    const credentialB = await service.issueCertifierCredential(
      certifierB.id,
      { label: "automation", scopes: ["certification:read", "certification:submit"] },
      adminId,
    );
    expect(
      await prisma.certifierCredential.findUnique({ where: { id: credentialA.id } }),
    ).not.toHaveProperty("token", credentialA.token);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "certification.credential-issued",
          subjectType: "certifier-credential",
          subjectId: credentialA.id,
        },
      }),
    ).toBe(1);
    const authA = await service.authenticateCertifier(
      request(credentialA.token),
      "certification:submit",
    );
    const authB = await service.authenticateCertifier(
      request(credentialB.token),
      "certification:submit",
    );
    const runA = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolA.id,
        assessmentMode: "human",
        idempotencyKey: "institute-a-run-001",
      },
      authA,
    );
    const replay = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolA.id,
        assessmentMode: "human",
        idempotencyKey: "institute-a-run-001",
      },
      authA,
    );
    expect(replay).toMatchObject({ id: runA.id, replayed: true });
    await expect(
      service.createCertificationRun(
        {
          publicationVersionId: versionId,
          certificationProtocolId: protocolB.id,
          assessmentMode: "human",
          idempotencyKey: "institute-a-run-001",
        },
        authA,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.createCertificationRun(
        {
          publicationVersionId: versionId,
          certificationProtocolId: protocolB.id,
          assessmentMode: "human",
          idempotencyKey: "institute-a-wrong-protocol",
        },
        authA,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const inputA = await service.getCertificationInput(runA.id, certifierA.id);
    expect(sha(canonicalJson(inputA.packet))).toBe(inputA.packetSha256);
    expect(inputA.packet.schemaVersion).toBe("1.2.0");
    expect(inputA.packet.version.publisherCanonicalUrl).toBeNull();
    expect(inputA.packet.content).toEqual([
      expect.objectContaining({
        id: "publication-content:certification-methods",
        role: "methods",
        text: expect.stringContaining("prespecified scientific evaluation protocol"),
      }),
    ]);
    expect(inputA.packet.completeness.content).toEqual({
      returnedDocuments: 1,
      totalDocumentsKnown: 1,
      truncated: false,
      coverage: "complete",
    });
    const { sha256: _packetDigest, ...packetWithoutDigest } = inputA.packet;
    expect(
      sha(
        canonicalJson({
          ...packetWithoutDigest,
          content: inputA.packet.content.map((document: { text: string }) => ({
            ...document,
            text: `${document.text} changed`,
          })),
        }),
      ),
    ).not.toBe(inputA.packet.sha256);
    const occurrenceId = inputA.packet.occurrences[0].id as string;
    expect(inputA.packet.occurrences[0].canonicalBinding).toBeNull();
    await (
      await import("./external-publication-materialization")
    ).materializeExternalPublicationClaim(occurrenceId, adminId);
    const livePacketAfterGraphChange = await (
      await import("./publication-version-packet")
    ).getPublicationVersionPacket(versionId);
    expect(livePacketAfterGraphChange.occurrences[0]?.canonicalBinding).not.toBeNull();
    expect((await service.getCertificationInput(runA.id, certifierA.id)).packet).toEqual(
      inputA.packet,
    );
    await prisma.publicationProductionAssertion.create({
      data: {
        publicationVersionId: versionId,
        sourceAssertionKey: "after-run",
        mode: "human",
        actorsJson: "[]",
        activitiesJson: "[]",
        statement: "Added after certification started.",
        strength: "source-declared",
        assertedAt: new Date(),
      },
    });
    expect((await service.getCertificationInput(runA.id, certifierA.id)).packetSha256).toBe(
      inputA.packetSha256,
    );
    expect((await service.getCertificationInput(runA.id, certifierA.id)).packet.content).toEqual(
      inputA.packet.content,
    );
    await expect(
      prisma.publicationVersion.update({
        where: { id: versionId },
        data: { contentCorpusJson: "[]" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.certificationRun.update({ where: { id: runA.id }, data: { inputPacketJson: "{}" } }),
    ).rejects.toThrow();
    await expect(
      service.submitCertificationResult(
        runA.id,
        { ...result("f".repeat(64), occurrenceId) },
        authA,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.submitCertificationResult(
        runA.id,
        { ...result(inputA.packetSha256, "hallucinated") },
        authA,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    const unknownRun = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolA.id,
        assessmentMode: "human",
        idempotencyKey: "institute-a-unknown-criterion",
      },
      authA,
    );
    const unknownInput = await service.getCertificationInput(unknownRun.id, certifierA.id);
    await expect(
      service.submitCertificationResult(
        unknownRun.id,
        {
          ...result(unknownInput.packetSha256, occurrenceId),
          criteria: [
            {
              criterionId: "hallucinated-criterion",
              status: "pass",
              rationale: "Unknown criterion.",
              evidenceRefs: [],
            },
          ],
        },
        authA,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    const duplicateRun = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolA.id,
        assessmentMode: "human",
        idempotencyKey: "institute-a-duplicate-criterion",
      },
      authA,
    );
    const duplicateInput = await service.getCertificationInput(duplicateRun.id, certifierA.id);
    const duplicateCriterion = result(duplicateInput.packetSha256, occurrenceId).criteria[0]!;
    await expect(
      service.submitCertificationResult(
        duplicateRun.id,
        {
          ...result(duplicateInput.packetSha256, occurrenceId),
          criteria: [duplicateCriterion, duplicateCriterion],
        },
        authA,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    const missingRun = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolA.id,
        assessmentMode: "human",
        idempotencyKey: "institute-a-missing-criterion",
      },
      authA,
    );
    const missingInput = await service.getCertificationInput(missingRun.id, certifierA.id);
    await expect(
      service.submitCertificationResult(
        missingRun.id,
        { ...result(missingInput.packetSha256, occurrenceId), criteria: [] },
        authA,
      ),
    ).rejects.toThrow();
    const invalidHumanProvenanceRun = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolA.id,
        assessmentMode: "human",
        idempotencyKey: "institute-a-invalid-human-provenance",
      },
      authA,
    );
    const invalidHumanInput = await service.getCertificationInput(
      invalidHumanProvenanceRun.id,
      certifierA.id,
    );
    const failedCertificationAgentRun = await prisma.agentRun.create({
      data: {
        agentType: "external-certification",
        packetHash: invalidHumanInput.packetSha256,
        status: "failed",
      },
    });
    await expect(
      service.submitCertificationResult(
        invalidHumanProvenanceRun.id,
        {
          ...result(invalidHumanInput.packetSha256, occurrenceId),
          provenance: { agentRunId: failedCertificationAgentRun.id },
        },
        authA,
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    const resultA = await service.submitCertificationResult(
      runA.id,
      result(inputA.packetSha256, occurrenceId),
      authA,
    );
    expect(
      (
        await service.submitCertificationResult(
          runA.id,
          result(inputA.packetSha256, occurrenceId),
          authA,
        )
      ).replayed,
    ).toBe(true);
    await expect(
      service.submitCertificationResult(runA.id, result(inputA.packetSha256, occurrenceId), authB),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.submitCertificationResult(
        runA.id,
        result(inputA.packetSha256, occurrenceId, "not-certified"),
        authA,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      prisma.certificationResult.update({
        where: { id: resultA.id },
        data: { outcome: "not-certified" },
      }),
    ).rejects.toThrow();
    const runB = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocolB.id,
        assessmentMode: "human",
        idempotencyKey: "collective-b-run-001",
      },
      authB,
    );
    const inputB = await service.getCertificationInput(runB.id, certifierB.id);
    await service.submitCertificationResult(
      runB.id,
      result(inputB.packetSha256, occurrenceId, "not-certified"),
      authB,
    );
    const publicResults = await service.listPublicationVersionCertifications(versionId);
    for (const summary of publicResults.certifications)
      expect(publicCertificationSummarySchema.parse(summary)).toEqual(summary);
    expect(publicResults.certifications[0]).not.toHaveProperty("certificationRunId");
    expect(publicResults.certifications.map((item) => [item.certifier.name, item.outcome])).toEqual(
      [
        ["Institute A", "certified"],
        ["Collective B", "not-certified"],
      ],
    );
    const aiProtocol = await service.createCertificationProtocol(
      {
        certifierId: certifierA.id,
        seriesKey: "generic-ai-review",
        version: "1.0.0",
        title: "Generic AI review",
        description: "A generic AI provenance fixture.",
        definition: { ...definition, assessmentModes: ["ai"] },
      },
      adminId,
    );
    const aiRun = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: aiProtocol.id,
        assessmentMode: "ai",
        idempotencyKey: "institute-a-ai-run",
      },
      authA,
    );
    const aiInput = await service.getCertificationInput(aiRun.id, certifierA.id);
    const aiSubmission = (agentRunId: string) => ({
      ...result(aiInput.packetSha256, occurrenceId),
      outcome: "inconclusive" as const,
      criteria: [
        {
          criterionId: "evidence",
          status: "concern" as const,
          rationale: "AI fixture retained exact execution provenance.",
          evidenceRefs: [{ type: "publication-occurrence" as const, id: occurrenceId }],
        },
      ],
      provenance: {
        agentRunId,
        provider: "fixture-provider",
        model: "fixture-model",
        modelVersion: "1",
        promptVersion: "generic-protocol-1",
        structuredOutputSha256: sha("structured-output"),
      },
    });
    const unrelatedAgentRun = await prisma.agentRun.create({
      data: {
        agentType: "discussion-answer",
        packetHash: aiInput.packetSha256,
        status: "succeeded",
        completedAt: new Date(),
      },
    });
    await expect(
      service.submitCertificationResult(aiRun.id, aiSubmission(unrelatedAgentRun.id), authA),
    ).rejects.toMatchObject({ code: "bad-request" });
    const unboundAgentRun = await prisma.agentRun.create({
      data: {
        agentType: "external-certification",
        packetHash: null,
        status: "succeeded",
        completedAt: new Date(),
      },
    });
    await expect(
      service.submitCertificationResult(aiRun.id, aiSubmission(unboundAgentRun.id), authA),
    ).rejects.toMatchObject({ code: "conflict" });
    const agentRun = await prisma.agentRun.create({
      data: {
        agentType: "external-certification",
        modelProvider: "fixture-provider",
        modelName: "fixture-model",
        modelVersion: "1",
        promptVersion: "generic-protocol-1",
        packetHash: aiInput.packetSha256,
        outputJson: canonicalJson({ outcome: "inconclusive" }),
        status: "succeeded",
        completedAt: new Date(),
      },
    });
    await service.submitCertificationResult(aiRun.id, aiSubmission(agentRun.id), authA);
    const retainedAi = await prisma.certificationResult.findUniqueOrThrow({
      where: { certificationRunId: aiRun.id },
    });
    expect(retainedAi.agentRunId).toBe(agentRun.id);
    expect(JSON.parse(retainedAi.provenanceJson)).toEqual(
      expect.objectContaining({ provider: "fixture-provider", model: "fixture-model" }),
    );
    expect(retainedAi.provenanceJson).not.toMatch(/secret|api[-_]?key/i);
    await service.addCertificationLifecycle(
      resultA.id,
      "withdrawn",
      "Certifier withdrew the assertion.",
      { certifierId: certifierA.id },
    );
    const withdrawnSummary = (await service.listPublicationVersionCertifications(versionId))
      .certifications[0]!;
    expect(withdrawnSummary.lifecycle.map((event) => event.kind)).toEqual(["issued", "withdrawn"]);
    expect(withdrawnSummary.lifecycleState).toBe("withdrawn");
    expect(await prisma.trustAssessment.count()).toBe(0);
    expect(await prisma.knowledgeNode.count()).toBe(1);
    expect(await prisma.publicationRelation.count()).toBe(0);
    expect(
      await prisma.publicationProductionAssertion.count({
        where: { publicationVersionId: versionId },
      }),
    ).toBe(1);
    await expect(
      prisma.certificationProtocol.update({
        where: { id: protocolA.id },
        data: { title: "Rewritten" },
      }),
    ).rejects.toThrow();
    expect((await service.retireCertificationProtocol(protocolA.id, adminId)).status).toBe(
      "retired",
    );
    await expect(
      service.createCertificationRun(
        {
          publicationVersionId: versionId,
          certificationProtocolId: protocolA.id,
          assessmentMode: "human",
          idempotencyKey: "retired-protocol-run",
        },
        authA,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const publication = await prisma.publicationVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { publicationId: true },
    });
    const versionTwo = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.publicationId,
        stableKey: "certification-version-v2",
        sourcesSha256: sha("source-v2"),
        observedPublicationBaseUrl: "https://publisher.example/article/v2/",
        adapterType: "myst",
        adapterBindingJson: canonicalJson({
          type: "myst",
          protocolVersion: "0.2.0",
          crossReferenceInventoryPath: "myst.xref.json",
          generatorName: "fixture",
          generatorVersion: "1.0.0",
        }),
        structuralProvenance: "published-structure",
        observedAt: new Date("2026-08-24T14:00:00.000Z"),
      },
    });
    expect(
      (await service.listPublicationVersionCertifications(versionTwo.id)).certifications,
    ).toEqual([]);
    await expect(service.getCertificationRun(runA.id, certifierB.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await service.revokeCertifierCredential(credentialA.id, adminId);
    await expect(
      service.authenticateCertifier(request(credentialA.token), "certification:read"),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("keeps retirement terminal and preserves its first timestamp", async () => {
    const certifier = await service.createCertifier(
      {
        slug: "retirement-fixture",
        name: "Retirement Fixture",
        description: "Exercises terminal certifier lifecycle handling.",
      },
      adminId,
    );
    const first = await service.setCertifierStatus(certifier.id, "retired", adminId);
    const replay = await service.setCertifierStatus(certifier.id, "retired", adminId);
    expect(replay.retiredAt).toBe(first.retiredAt);
    await expect(service.setCertifierStatus(certifier.id, "active", adminId)).rejects.toMatchObject(
      { code: "conflict" },
    );
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "certification.certifier-status",
          subjectType: "certifier",
          subjectId: certifier.id,
        },
      }),
    ).toBe(1);
  });

  it("converges concurrent owner terminal transitions with one immutable audit event", async () => {
    const certifier = await service.createCertifier(
      {
        slug: "terminal-transition-fixture",
        name: "Terminal Transition Fixture",
        description: "Exercises generic owner-scoped failed run transitions.",
      },
      adminId,
    );
    const protocol = await service.createCertificationProtocol(
      {
        certifierId: certifier.id,
        seriesKey: "terminal-transition",
        version: "1.0.0",
        title: "Terminal transition",
        description: "Failure handling fixture.",
        definition,
      },
      adminId,
    );
    const credential = await service.issueCertifierCredential(
      certifier.id,
      { label: "terminal-owner", scopes: ["certification:read", "certification:submit"] },
      adminId,
    );
    const auth = await service.authenticateCertifier(
      request(credential.token),
      "certification:submit",
    );
    const run = await service.createCertificationRun(
      {
        publicationVersionId: versionId,
        certificationProtocolId: protocol.id,
        assessmentMode: "human",
        idempotencyKey: "terminal-transition-run",
      },
      auth,
    );
    const transitions = await Promise.all([
      service.transitionCertificationRun(
        run.id,
        { status: "failed", reason: "Provider unavailable." },
        auth,
      ),
      service.transitionCertificationRun(
        run.id,
        { status: "failed", reason: "Provider unavailable." },
        auth,
      ),
    ]);
    expect(transitions.map((item) => item.replayed).sort()).toEqual([false, true]);
    expect(transitions[0]).toMatchObject({
      status: "failed",
      terminalReason: "Provider unavailable.",
    });
    expect(
      await prisma.auditEvent.count({
        where: { action: "certification.run-failed", subjectId: run.id },
      }),
    ).toBe(1);
    await expect(
      service.transitionCertificationRun(
        run.id,
        { status: "cancelled", reason: "Different." },
        auth,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.submitCertificationResult(
        run.id,
        result(run.input.packetSha256, "certification-occurrence-1"),
        auth,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      prisma.certificationRun.update({
        where: { id: run.id },
        data: { terminalReason: "rewritten" },
      }),
    ).rejects.toThrow();
  });

  it("records unsupported content explicitly and rejects a content-complete protocol", async () => {
    const certifier = await service.createCertifier(
      {
        slug: "content-required-fixture",
        name: "Content Required Fixture",
        description: "Requires a complete generic content section.",
      },
      adminId,
    );
    const protocol = await service.createCertificationProtocol(
      {
        certifierId: certifier.id,
        seriesKey: "content-required",
        version: "1.0.0",
        title: "Content required",
        description: "Generic completeness policy fixture.",
        definition,
      },
      adminId,
    );
    const credential = await service.issueCertifierCredential(
      certifier.id,
      { label: "content-reader", scopes: ["certification:read", "certification:submit"] },
      adminId,
    );
    const auth = await service.authenticateCertifier(
      request(credential.token),
      "certification:submit",
    );
    const subject = await prisma.publicationVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { publicationId: true },
    });
    const unsupported = await prisma.publicationVersion.create({
      data: {
        publicationId: subject.publicationId,
        stableKey: "certification-version-without-content-adapter",
        sourcesSha256: sha("source-without-content-adapter"),
        observedPublicationBaseUrl: "https://publisher.example/article/unsupported/",
        adapterType: "myst",
        adapterBindingJson: canonicalJson({ type: "myst", protocolVersion: "0.2.0" }),
        structuralProvenance: "published-structure",
        observedAt: new Date("2026-08-24T15:00:00.000Z"),
      },
    });
    const packet = await (
      await import("./publication-version-packet")
    ).getPublicationVersionPacket(unsupported.id);
    expect(packet.content).toEqual([]);
    expect(packet.completeness.content).toEqual({
      returnedDocuments: 0,
      totalDocumentsKnown: null,
      truncated: false,
      coverage: "unsupported",
    });
    await expect(
      service.createCertificationRun(
        {
          publicationVersionId: unsupported.id,
          certificationProtocolId: protocol.id,
          assessmentMode: "human",
          idempotencyKey: "content-required-unsupported-run",
        },
        auth,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("completes the third-party journey through documented HTTP route boundaries only", async () => {
    const certifier = await service.createCertifier(
      {
        slug: "api-only-certifier",
        name: "API-only Certifier",
        description: "Exercises the documented external integration boundary.",
      },
      adminId,
    );
    const protocol = await service.createCertificationProtocol(
      {
        certifierId: certifier.id,
        seriesKey: "api-only-review",
        version: "1.0.0",
        title: "API-only review",
        description: "A generic external protocol.",
        definition,
      },
      adminId,
    );
    const credential = await service.issueCertifierCredential(
      certifier.id,
      { label: "external-client", scopes: ["certification:read", "certification:submit"] },
      adminId,
    );
    const [runsRoute, inputRoute, resultRoute, publicRoute] = await Promise.all([
      import("../app/api/certification-runs/route"),
      import("../app/api/certification-runs/[id]/input/route"),
      import("../app/api/certification-runs/[id]/result/route"),
      import("../app/api/publication-versions/[id]/certifications/route"),
    ]);
    const headers = {
      authorization: `Bearer ${credential.token}`,
      "content-type": "application/json",
    };
    const createdResponse = await runsRoute.POST(
      new Request("https://atlas.example/api/certification-runs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          publicationVersionId: versionId,
          certificationProtocolId: protocol.id,
          assessmentMode: "human",
          idempotencyKey: "api-only-external-run",
        }),
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string };
    const inputResponse = await inputRoute.GET(
      new Request(`https://atlas.example/api/certification-runs/${created.id}/input`, {
        headers: { authorization: `Bearer ${credential.token}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(inputResponse.status).toBe(200);
    const captured = (await inputResponse.json()) as {
      packetSha256: string;
      packet: { occurrences: Array<{ id: string }> };
    };
    const submissionResponse = await resultRoute.POST(
      new Request(`https://atlas.example/api/certification-runs/${created.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          result(captured.packetSha256, captured.packet.occurrences[0]!.id, "certified"),
        ),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(submissionResponse.status).toBe(201);
    const publicResponse = await publicRoute.GET(
      new Request(`https://atlas.example/api/publication-versions/${versionId}/certifications`),
      { params: Promise.resolve({ id: versionId }) },
    );
    expect(publicResponse.status).toBe(200);
    const projection = (await publicResponse.json()) as {
      certifications: Array<{ id: string; certifier: { name: string } }>;
    };
    expect(projection.certifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          certifier: expect.objectContaining({ name: "API-only Certifier" }),
        }),
      ]),
    );
  });

  it("runs ORA as an ordinary certifier through the same HTTP route boundary with exact AgentRun provenance", async () => {
    const certifier = await service.createCertifier(
      {
        slug: "ora",
        name: "ORA",
        description: "Reference certification service using the generic ORAtlas certification API.",
      },
      adminId,
    );
    const protocol = await service.createCertificationProtocol(
      {
        certifierId: certifier.id,
        seriesKey: "scientific-merit-pilot",
        version: "0.1.0",
        title: "ORA Scientific Merit Pilot",
        description: "Pilot reporting and evidential-support assessment; not scientific truth.",
        definition: ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
      },
      adminId,
    );
    const credential = await service.issueCertifierCredential(
      certifier.id,
      { label: "ora-service", scopes: ["certification:read", "certification:submit"] },
      adminId,
    );
    const [runsRoute, inputRoute, resultRoute, transitionRoute, oraPackage, oraTesting] =
      await Promise.all([
        import("../app/api/certification-runs/route"),
        import("../app/api/certification-runs/[id]/input/route"),
        import("../app/api/certification-runs/[id]/result/route"),
        import("../app/api/certification-runs/[id]/transition/route"),
        import("@oratlas/ora-certifier"),
        import("@oratlas/ora-certifier/testing"),
      ]);
    const httpCalls: string[] = [];
    const routeFetch = async (requestInfo: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(requestInfo));
      const request = new Request(url, init);
      httpCalls.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/api/certification-runs") return runsRoute.POST(request);
      const match = /^\/api\/certification-runs\/([^/]+)\/(input|result|transition)$/.exec(
        url.pathname,
      );
      if (!match) throw new Error(`Unexpected ORA route ${url.pathname}`);
      const context = { params: Promise.resolve({ id: decodeURIComponent(match[1]!) }) };
      if (match[2] === "input") return inputRoute.GET(request, context);
      if (match[2] === "result") return resultRoute.POST(request, context);
      return transitionRoute.POST(request, context);
    };
    const recorder = {
      async recordSucceeded(input: {
        packetSha256: string;
        evaluation: { criteria: unknown; limitations: unknown };
        metadata: {
          provider: string;
          model: string;
          modelVersion?: string;
          promptVersion: string;
          startedAt: string;
          completedAt: string;
        };
      }) {
        const outputJson = canonicalJson({
          criteria: input.evaluation.criteria,
          limitations: input.evaluation.limitations,
        });
        const agentRun = await prisma.agentRun.create({
          data: {
            agentType: "external-certification",
            modelProvider: input.metadata.provider,
            modelName: input.metadata.model,
            modelVersion: input.metadata.modelVersion,
            promptVersion: input.metadata.promptVersion,
            packetHash: input.packetSha256,
            inputHash: input.packetSha256,
            inputReferencesJson: canonicalJson({ packetSha256: input.packetSha256 }),
            outputJson,
            status: "succeeded",
            startedAt: new Date(input.metadata.startedAt),
            completedAt: new Date(input.metadata.completedAt),
          },
        });
        return { agentRunId: agentRun.id, structuredOutputSha256: sha(outputJson) };
      },
    };
    const completed = await new oraPackage.OraCertificationService(
      new oraPackage.CertifierApiClient(
        "https://atlas.example",
        credential.token,
        routeFetch as typeof fetch,
      ),
      oraTesting.createDeterministicOraTestEvaluator("strong"),
      recorder,
    ).certify({
      publicationVersionId: versionId,
      certificationProtocolId: protocol.id,
      idempotencyKey: "ora-api-only-strong-fixture",
    });
    expect(completed.outcome).toBe("certified");
    expect(completed.input.packet).toMatchObject({
      schemaVersion: "1.2.0",
      content: [expect.objectContaining({ id: "publication-content:certification-methods" })],
    });
    expect(httpCalls).toEqual([
      "POST /api/certification-runs",
      expect.stringMatching(/^GET \/api\/certification-runs\/[^/]+\/input$/),
      expect.stringMatching(/^POST \/api\/certification-runs\/[^/]+\/result$/),
    ]);
    const persisted = await prisma.certificationResult.findUniqueOrThrow({
      where: { certificationRunId: completed.run.id },
      include: { agentRun: true },
    });
    expect(persisted.outcome).toBe("certified");
    expect(persisted.agentRun).toMatchObject({
      agentType: "external-certification",
      status: "succeeded",
      packetHash: completed.input.packetSha256,
    });
    expect(JSON.parse(persisted.conflictOfInterestJson)).toEqual({ status: "not-provided" });
    expect(JSON.parse(persisted.independenceJson).statement).toMatch(
      /independently of the publication's declared production workflow/,
    );

    const failedService = new oraPackage.OraCertificationService(
      new oraPackage.CertifierApiClient(
        "https://atlas.example",
        credential.token,
        routeFetch as typeof fetch,
      ),
      { evaluate: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
      recorder,
    );
    await expect(
      failedService.certify({
        publicationVersionId: versionId,
        certificationProtocolId: protocol.id,
        idempotencyKey: "ora-api-only-provider-failure",
      }),
    ).rejects.toThrow("provider unavailable");
    const failedRun = await prisma.certificationRun.findUniqueOrThrow({
      where: {
        certifierId_idempotencyKey: {
          certifierId: certifier.id,
          idempotencyKey: "ora-api-only-provider-failure",
        },
      },
    });
    expect(failedRun).toMatchObject({
      status: "failed",
      terminalReason: "ORA evaluator failed: provider unavailable",
    });
    expect(
      await prisma.certificationResult.count({ where: { certificationRunId: failedRun.id } }),
    ).toBe(0);
  });
});
