import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson, type CertificationProtocolDefinition } from "@oratlas/contracts";
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
  submitCertificationResult,
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
  submitCertificationResult: typeof submitCertificationResult;
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
  requireCompleteSections: ["occurrences"],
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
    expect(inputA.packet.version.publisherCanonicalUrl).toBeNull();
    const occurrenceId = inputA.packet.occurrences[0].id as string;
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
    await service.submitCertificationResult(
      aiRun.id,
      {
        ...result(aiInput.packetSha256, occurrenceId),
        outcome: "inconclusive",
        criteria: [
          {
            criterionId: "evidence",
            status: "concern",
            rationale: "AI fixture retained exact execution provenance.",
            evidenceRefs: [{ type: "publication-occurrence", id: occurrenceId }],
          },
        ],
        provenance: {
          agentRunId: agentRun.id,
          provider: "fixture-provider",
          model: "fixture-model",
          modelVersion: "1",
          promptVersion: "generic-protocol-1",
          structuredOutputSha256: sha("structured-output"),
        },
      },
      authA,
    );
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
    expect(
      (
        await service.listPublicationVersionCertifications(versionId)
      ).certifications[0].lifecycle.map((event: { kind: string }) => event.kind),
    ).toEqual(["issued", "withdrawn"]);
    expect(await prisma.trustAssessment.count()).toBe(0);
    expect(await prisma.knowledgeNode.count()).toBe(0);
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
      certifications: Array<{ certificationRunId: string; certifier: { name: string } }>;
    };
    expect(projection.certifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          certificationRunId: created.id,
          certifier: expect.objectContaining({ name: "API-only Certifier" }),
        }),
      ]),
    );
  });
});
