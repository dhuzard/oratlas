import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@oratlas/contracts";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";
import type * as VerificationService from "./scientific-verification";

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({
  requireEditor: async () => ({ id: editorId, role: "EDITOR" }),
  getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
}));
const databaseName = `oratlas-verification-${process.pid}-${Date.now()}.db`;
const databasePath = join(process.cwd(), "packages", "db", "prisma", databaseName);
const databaseUrl = `file:./${databaseName}`;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
let prisma: PrismaClient;
let service: typeof VerificationService;
let editorId: string;
let versionId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
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
  service = await import("./scientific-verification");
  const editor = await prisma.user.create({
    data: { githubLogin: "verification-editor", role: "ADMIN" },
  });
  editorId = editor.id;
  const publication = await prisma.publication.create({
    data: {
      stableKey: "verification-synthetic-publication",
      publicationType: "research-article",
      recordSource: "external-publication",
      identityEvidenceJson: canonicalJson({
        basis: "registration",
        registrationKey: "verification-synthetic",
      }),
    },
  });
  const text = "Synthetic methods and reported t statistic.";
  const corpus = canonicalJson([
    {
      id: "publication-content:verification-synthetic",
      title: "Methods",
      role: "methods",
      sourcePath: "article.md",
      publishedUrl: "https://synthetic.example/article/",
      representation: "published-structured-text",
      text,
      sha256: sha(text),
      sourceArtifactIdentitySha256: sha("slot"),
      sourceArtifactSha256: sha(text),
    },
  ]);
  const version = await prisma.publicationVersion.create({
    data: {
      publicationId: publication.id,
      stableKey: "verification-synthetic-v1",
      sourcesSha256: sha("sources"),
      observedPublicationBaseUrl: "https://synthetic.example/article/",
      adapterType: "myst",
      adapterBindingJson: canonicalJson({
        type: "myst",
        protocolVersion: "0.2.0",
        crossReferenceInventoryPath: "myst.xref.json",
        generatorName: "fixture",
        generatorVersion: "1",
      }),
      structuralProvenance: "published-structure",
      contentCorpusJson: corpus,
      contentCorpusSha256: sha(corpus),
      contentCompletenessJson: canonicalJson({
        returnedDocuments: 1,
        totalDocumentsKnown: 1,
        truncated: false,
        coverage: "complete",
      }),
      observedAt: new Date("2026-08-25T00:00:00.000Z"),
    },
  });
  versionId = version.id;
  await prisma.publicationCapture.create({
    data: {
      id: "verification-synthetic-source-capture",
      publicationVersionId: version.id,
      artifactKind: "source-document",
      artifactIdentitySha256: sha("verification-synthetic-source-slot"),
      declaredPath: "article.md",
      requestedUrl: "https://synthetic.example/article/article.md",
      observedUrl: "https://synthetic.example/article/article.md",
      mediaType: "text/plain",
      contentSha256: sha(text),
      byteLength: Buffer.byteLength(text, "utf8"),
      contentBytes: text,
      structuralProvenance: "published-structure",
      capturedAt: new Date("2026-08-25T00:00:00.000Z"),
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (existsSync(databasePath)) rmSync(databasePath);
});

function bearer(token: string, lease?: string) {
  return new Request("https://atlas.example/api/verification-runs", {
    headers: {
      authorization: `Bearer ${token}`,
      ...(lease ? { "x-oratlas-verification-lease": lease } : {}),
    },
  });
}

describe("scientific verification ledger", () => {
  it("supports the external journey with frozen input, checked bytes, and immutable idempotent findings", async () => {
    const verifier = await service.createVerifier(
      { slug: "external-lab", name: "External Lab", description: "Independent external verifier." },
      editorId,
    );
    const protocol = await service.createVerificationProtocol(
      {
        authorityVerifierId: verifier.id,
        seriesKey: "reported-statistic-consistency",
        protocolVersion: "0.1.0",
        title: "Reported statistic consistency",
        description: "External protocol fixture.",
        verificationType: "reported-statistic-consistency",
        executionMode: "external-execution",
        supportedSubjectTypes: ["publication-version"],
        definition: { externalExecutionRequired: true },
      },
      editorId,
    );
    const credential = await service.issueVerifierCredential(
      verifier.id,
      { label: "worker", scopes: ["verification:read", "verification:submit"] },
      editorId,
    );
    expect(
      await prisma.verifierCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).not.toHaveProperty("token");
    const auth = await service.authenticateVerifier(
      bearer(credential.token),
      "verification:submit",
    );
    const run = await service.createVerificationRun(
      {
        verificationProtocolId: protocol.id,
        subject: { type: "publication-version", publicationVersionId: versionId },
        inputProfile: "blinded-scientific",
        inputProfileVersion: "1.0.0",
        idempotencyKey: "synthetic-verification-001",
      },
      editorId,
    );
    expect(
      await service.createVerificationRun(
        {
          verificationProtocolId: protocol.id,
          subject: { type: "publication-version", publicationVersionId: versionId },
          inputProfile: "blinded-scientific",
          inputProfileVersion: "1.0.0",
          idempotencyKey: "synthetic-verification-001",
        },
        editorId,
      ),
    ).toMatchObject({ id: run.id, replayed: true });

    const claim = await service.claimVerificationRun(run.id, auth, 300);
    const leased = bearer(credential.token, claim.leaseToken);
    const otherVerifier = await service.createVerifier(
      { slug: "other-external-lab", name: "Other Lab", description: "Non-claimant fixture." },
      editorId,
    );
    await expect(
      service.transitionVerificationRun(
        run.id,
        { status: "running" },
        {
          verifier: { verifierId: otherVerifier.id, credentialId: "other-credential" },
          request: leased,
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const frozen = await service.getVerificationInput(run.id, auth, leased);
    expect(sha(canonicalJson(frozen.input))).toBe(frozen.sha256);
    expect((frozen.input as { contributors: unknown[] }).contributors).toEqual([]);
    expect(
      await prisma.publicationVersion.findUniqueOrThrow({ where: { id: versionId } }),
    ).not.toHaveProperty("verificationScore");

    const bytes = new TextEncoder().encode(canonicalJson({ recomputedP: 0.00335 }));
    const prepared = await service.prepareVerificationArtifact(
      run.id,
      {
        artifactKey: "statistic-report",
        kind: "statistic-report",
        mediaType: "application/json",
        sha256: sha(bytes),
        byteLength: bytes.byteLength,
        visibility: "public",
      },
      auth,
      leased,
    );
    await service.uploadVerificationArtifact(
      prepared.artifactId,
      bytes,
      "application/json",
      auth,
      leased,
    );
    await service.completeVerificationArtifact(run.id, prepared.artifactId, auth, leased);
    await service.transitionVerificationRun(
      run.id,
      { status: "running" },
      { verifier: auth, request: leased },
    );

    const findingInput = {
      findingKey: "correct-t-test",
      findingType: "statistic-consistency",
      status: "verified" as const,
      impact: "informational" as const,
      statement: "Reported p-value is consistent under the selected protocol.",
      rationale: "The external worker compared exact frozen parameters.",
      reported: { testType: "t", statistic: 3.12, degreesOfFreedom: [38], reportedP: 0.0034 },
      observed: { recomputedP: 0.00335, library: "external-fixture" },
      artifactRefs: [prepared.artifactId],
      evidenceRefs: [{ type: "verification-artifact" as const, id: prepared.artifactId }],
    };
    const finding = await service.submitVerificationFinding(run.id, findingInput, auth, leased);
    expect(
      await service.submitVerificationFinding(run.id, findingInput, auth, leased),
    ).toMatchObject({ id: finding.id, replayed: true });
    await expect(
      service.submitVerificationFinding(
        run.id,
        { ...findingInput, statement: "Conflicting replay." },
        auth,
        leased,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.transitionVerificationRun(
      run.id,
      { status: "completed" },
      { verifier: auth, request: leased },
    );

    const publicProjection = await service.listPublicationVersionVerifications(versionId);
    expect(publicProjection.summary.statistics).toEqual({ verified: 1 });
    await expect(
      prisma.verificationFinding.update({
        where: { id: finding.id },
        data: { status: "discrepancy" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.verificationRun.update({ where: { id: run.id }, data: { inputJson: "{}" } }),
    ).rejects.toThrow();
    await expect(
      prisma.verifierCredential.update({
        where: { id: credential.id },
        data: { scopesJson: canonicalJson(["verification:read"]) },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.verificationProtocol.update({
        where: { id: protocol.id },
        data: { definitionJson: canonicalJson({ changedAfterUse: true }) },
      }),
    ).rejects.toThrow();
    const guardRepository = await prisma.repository.create({
      data: {
        owner: "verification",
        name: "exact-one-subject-guard",
        canonicalUrl: "https://github.com/synthetic-verification/exact-one-subject-guard",
      },
    });
    const guardSnapshot = await prisma.repositorySnapshot.create({
      data: {
        repositoryId: guardRepository.id,
        commitSha: "1".repeat(40),
        inspectionStatus: "succeeded",
        inspectionReportJson: "{}",
        contentHash: sha("guard-snapshot"),
      },
    });
    const guardNode = await prisma.knowledgeNode.create({
      data: {
        repositoryId: guardRepository.id,
        originType: "repository-object",
        localNodeId: "verification-exact-one-subject-guard",
        kind: "code",
      },
    });
    const guardNodeVersion = await prisma.knowledgeNodeVersion.create({
      data: {
        knowledgeNodeId: guardNode.id,
        snapshotId: guardSnapshot.id,
        title: "Exact-one-subject guard fixture",
        provenanceJson: canonicalJson({ source: "synthetic-guard-fixture" }),
        payloadJson: canonicalJson({}),
      },
    });
    await expect(
      prisma.verificationRun.create({
        data: {
          protocolId: protocol.id,
          publicationVersionId: versionId,
          knowledgeNodeVersionId: guardNodeVersion.id,
          inputProfile: "full",
          inputProfileVersion: "1.0.0",
          inputSchemaVersion: "guard-fixture/1.0.0",
          inputJson: "{}",
          inputSha256: sha("{}"),
          inputCapturedAt: new Date(),
          idempotencyKey: "invalid-two-subjects",
          requestedById: editorId,
          requestedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(service.claimVerificationRun(run.id, auth, 300)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("completes the public HTTP journey through the repository-independent clients", async () => {
    const verifier = await service.createVerifier(
      { slug: "api-only-lab", name: "API-only Lab", description: "HTTP boundary fixture." },
      editorId,
    );
    const protocol = await service.createVerificationProtocol(
      {
        authorityVerifierId: verifier.id,
        seriesKey: "analysis-result-comparison",
        protocolVersion: "0.1.0",
        title: "Analysis result comparison",
        description: "External API-only fixture.",
        verificationType: "analysis-result-comparison",
        executionMode: "external-execution",
        supportedSubjectTypes: ["publication-version"],
        definition: { methods: ["independent-reproduction"] },
      },
      editorId,
    );
    const credential = await service.issueVerifierCredential(
      verifier.id,
      { label: "api-worker", scopes: ["verification:read", "verification:submit"] },
      editorId,
    );
    const [
      runsRoute,
      claimRoute,
      inputRoute,
      prepareRoute,
      contentRoute,
      completeRoute,
      findingsRoute,
      transitionRoute,
      publicRunRoute,
      publicVersionRoute,
      sourceArtifactRoute,
      clientPackage,
    ] = await Promise.all([
      import("../app/api/verification-runs/route"),
      import("../app/api/verification-runs/[id]/claim/route"),
      import("../app/api/verification-runs/[id]/input/route"),
      import("../app/api/verification-runs/[id]/artifacts/prepare/route"),
      import("../app/api/verification-artifacts/[id]/content/route"),
      import("../app/api/verification-runs/[id]/artifacts/complete/route"),
      import("../app/api/verification-runs/[id]/findings/route"),
      import("../app/api/verification-runs/[id]/transition/route"),
      import("../app/api/verification-runs/[id]/route"),
      import("../app/api/publication-versions/[id]/verifications/route"),
      import("../app/api/verification-runs/[id]/source-artifacts/[artifactId]/route"),
      import("../../../../packages/verifier-client/src/index"),
    ]);
    const calls: string[] = [];
    const routeFetch = async (requestInfo: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(requestInfo));
      const headers = new Headers(init?.headers);
      if (!headers.has("authorization")) headers.set("origin", url.origin);
      const request = new Request(url, { ...init, headers });
      calls.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/api/verification-runs") return runsRoute.POST(request);
      const sourceMatch = /^\/api\/verification-runs\/([^/]+)\/source-artifacts\/([^/]+)$/.exec(
        url.pathname,
      );
      if (sourceMatch)
        return sourceArtifactRoute.GET(request, {
          params: Promise.resolve({
            id: decodeURIComponent(sourceMatch[1]!),
            artifactId: decodeURIComponent(sourceMatch[2]!),
          }),
        });
      const versionMatch = /^\/api\/publication-versions\/([^/]+)\/verifications$/.exec(
        url.pathname,
      );
      if (versionMatch)
        return publicVersionRoute.GET(request, {
          params: Promise.resolve({ id: decodeURIComponent(versionMatch[1]!) }),
        });
      const contentMatch = /^\/api\/verification-artifacts\/([^/]+)\/content$/.exec(url.pathname);
      if (contentMatch)
        return request.method === "PUT"
          ? contentRoute.PUT(request, {
              params: Promise.resolve({ id: decodeURIComponent(contentMatch[1]!) }),
            })
          : contentRoute.GET(request, {
              params: Promise.resolve({ id: decodeURIComponent(contentMatch[1]!) }),
            });
      const match =
        /^\/api\/verification-runs\/([^/]+)(?:\/(claim|input|findings|transition|artifacts\/prepare|artifacts\/complete))?$/.exec(
          url.pathname,
        );
      if (!match) throw new Error(`Unexpected verification route ${url.pathname}`);
      const context = { params: Promise.resolve({ id: decodeURIComponent(match[1]!) }) };
      if (!match[2]) return publicRunRoute.GET(request, context);
      if (match[2] === "claim") return claimRoute.POST(request, context);
      if (match[2] === "input") return inputRoute.GET(request, context);
      if (match[2] === "findings") return findingsRoute.POST(request, context);
      if (match[2] === "transition") return transitionRoute.POST(request, context);
      if (match[2] === "artifacts/prepare") return prepareRoute.POST(request, context);
      return completeRoute.POST(request, context);
    };
    const editorClient = new clientPackage.VerificationEditorApiClient(
      "https://atlas.example",
      routeFetch as typeof fetch,
    );
    const requested = await editorClient.createRun({
      verificationProtocolId: protocol.id,
      subject: { type: "publication-version", publicationVersionId: versionId },
      inputProfile: "full",
      inputProfileVersion: "1.0.0",
      idempotencyKey: "api-only-external-run-001",
    });
    const runId = requested.id as string;
    const client = new clientPackage.VerifierApiClient(
      "https://atlas.example",
      credential.token,
      routeFetch as typeof fetch,
    );
    await client.claim(runId);
    const input = await client.getInput(runId);
    expect(input).toMatchObject({ verificationRunId: runId, schemaVersion: "1.3.0" });
    const capture = (
      input.sourceArtifacts as {
        id: string;
        sha256: string;
        byteLength: number;
        mediaType: string;
      }[]
    )[0]!;
    const sourceBytes = await client.downloadSourceArtifact(runId, capture.id, {
      sha256: capture.sha256,
      byteLength: capture.byteLength,
      mediaType: capture.mediaType,
    });
    expect(new TextDecoder().decode(sourceBytes)).toContain("Synthetic methods");
    const bytes = new TextEncoder().encode(canonicalJson({ independentlyReproduced: true }));
    const prepared = await client.prepareArtifact(runId, {
      artifactKey: "analysis-output",
      kind: "analysis-result",
      mediaType: "application/json",
      sha256: sha(bytes),
      byteLength: bytes.byteLength,
      visibility: "public",
    });
    const artifactId = prepared.artifactId as string;
    await client.uploadArtifact(runId, artifactId, bytes, "application/json");
    await client.completeArtifact(runId, artifactId);
    await client.transition(runId, { status: "running" });
    const finding = {
      findingKey: "independent-reproduction",
      findingType: "analysis-result-comparison",
      status: "verified",
      impact: "major",
      statement: "The synthetic analysis result was independently reproduced.",
      rationale: "The external fixture supplied its exact result artifact.",
      observed: { method: "independent-reproduction" },
      evidenceRefs: [{ type: "verification-artifact", id: artifactId }],
      artifactRefs: [artifactId],
    };
    const created = await client.submitFinding(runId, finding);
    expect(await client.submitFinding(runId, finding)).toMatchObject({
      id: created.id,
      replayed: true,
    });
    await expect(
      client.submitFinding(runId, { ...finding, status: "discrepancy" }),
    ).rejects.toMatchObject({ status: 409 });
    await client.transition(runId, { status: "completed" });
    expect(await client.getPublicRun(runId)).toMatchObject({ id: runId, status: "completed" });
    expect(await client.listPublicVersionVerifications(versionId)).toMatchObject({
      publicationVersionId: versionId,
    });
    expect(calls).toContain("PUT /api/verification-artifacts/" + artifactId + "/content");
  });
});
