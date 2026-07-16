import { createHash, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { canonicalJson } from "@oratlas/contracts";

const commitSha = "d".repeat(40);
const treeSha = "e".repeat(40);

test("submitter finalizes a node-only capture and an editor publishes its nodes", async ({
  page,
  browser,
}) => {
  const repositoryName = `node-e2e-${Date.now()}`;
  const repositoryUrl = `https://github.com/e2e-lab/${repositoryName}`;

  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as submitter/ }).click();
  await expect(page.getByText("atlas-submitter")).toBeVisible();

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const submitter = await prisma.user.findUniqueOrThrow({
    where: { githubUserId: "mock:atlas-submitter" },
  });
  const token = randomBytes(32).toString("base64url");
  const fixture = captureFixture(repositoryName, repositoryUrl);
  const payloadJson = canonicalJson(fixture.payload);
  const payloadHash = sha256(payloadJson);
  await prisma.inspectionCapture.create({
    data: {
      tokenHash: sha256(token),
      payloadJson,
      payloadHash,
      githubRepositoryId: fixture.payload.report.githubRepositoryId!,
      canonicalUrlAtCapture: repositoryUrl,
      inspectedByUserId: submitter.id,
      commitSha,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });

  await page.route("**/api/inspect", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        repo: fixture.payload.report.repo,
        selectedSource: fixture.payload.report.selectedSource,
        captureToken: token,
        captureExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        capturePayloadHash: payloadHash,
        inspectionStatus: "succeeded",
        inspectionWarnings: [],
        extractedMetadata: fixture.payload.extraction.metadata,
        effectiveMetadata: {
          title: fixture.title,
          repositoryUrl,
          commitSha,
          authors: [],
          keywords: [],
          domains: [],
        },
        compatibility: fixture.payload.extraction.compatibility,
        validation: fixture.payload.validation,
        knowledgeCounts: { claims: 0, citations: 0, relations: 0, trust: 0 },
        nodeExtraction: fixture.payload.extraction.nodeExtraction,
        publicationTargets: { proseReview: false, knowledgeNodes: true },
      }),
    });
  });

  await page.getByLabel("Public GitHub repository URL").fill(repositoryUrl);
  await page.getByRole("button", { name: "Inspect repository" }).click();
  await expect(page.getByRole("heading", { name: "Review extracted metadata" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to node candidates" }).click();
  await expect(
    page.getByRole("heading", { name: "Review extracted node candidates" }),
  ).toBeVisible();
  await expect(page.getByText(fixture.title)).toBeVisible();
  await page.getByRole("button", { name: "Continue to validation" }).click();
  const submissionResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/submissions") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit for editorial review" }).click();
  const finalizedResponse = await submissionResponse;
  expect(finalizedResponse.ok()).toBeTruthy();
  const finalized = (await finalizedResponse.json()) as { submissionId: string };
  await expect(page.getByRole("heading", { name: "Submission received" })).toBeVisible();
  const forbiddenStatus = await page.evaluate(async (submissionId) => {
    const response = await fetch("/api/editorial/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        decision: "accept",
        overrides: [],
        selectedNodeIds: ["claim:e2e"],
      }),
    });
    return response.status;
  }, finalized.submissionId);
  expect(forbiddenStatus).toBe(403);

  const editorContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const editorPage = await editorContext.newPage();
  await editorPage.goto("/signin");
  await editorPage.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(editorPage.locator("nav").getByText("atlas-editor (editor)")).toBeVisible();
  const oversizedStatus = await editorPage.evaluate(async () => {
    const response = await fetch("/api/editorial/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(300_000) }),
    });
    return response.status;
  });
  expect(oversizedStatus).toBe(413);
  const submissionCard = editorPage.locator("article.card").filter({ hasText: repositoryName });
  await expect(submissionCard.getByText(fixture.title).last()).toBeVisible();
  await expect(submissionCard.getByRole("checkbox").last()).toBeChecked();
  const decisionResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/decision") && response.request().method() === "POST",
  );
  await submissionCard.getByRole("button", { name: "Accept" }).click();
  expect((await decisionResponse).ok()).toBeTruthy();

  await editorPage.goto("/nodes");
  const publicNode = editorPage.locator("article.card").filter({ hasText: repositoryName });
  await expect(publicNode.getByText(fixture.title)).toBeVisible();
  await expect(editorPage.locator('img[src="x"]')).toHaveCount(0);
  await editorContext.close();
  await prisma.$disconnect();
});

function captureFixture(repositoryName: string, repositoryUrl: string) {
  const title = 'Escaped <script>alert("node")</script>';
  const inspectedAt = new Date().toISOString();
  const absent = { detected: false, evidence: [] as string[] };
  const report = {
    schemaVersion: "1.0.0" as const,
    repo: {
      host: "github.com" as const,
      owner: "e2e-lab",
      name: repositoryName,
      canonicalUrl: repositoryUrl,
    },
    inspectedAt,
    status: "succeeded" as const,
    githubRepositoryId: String(Date.now()),
    defaultBranch: "main",
    latestCommitSha: commitSha,
    topics: [],
    releases: [],
    tags: [],
    selectedSource: {
      kind: "default-branch" as const,
      branch: "main",
      commitSha,
      treeSha,
    },
    tree: [],
    treeTruncated: false,
    files: {},
    warnings: [],
    limits: {
      maxFileBytes: 512_000,
      maxTotalBytes: 3_000_000,
      maxFileCount: 24,
      totalBytesFetched: 0,
      filesFetched: 0,
    },
  };
  const provenance = {
    source: "repository-metadata" as const,
    commitSha,
    extractorVersion: "e2e",
    extractedAt: inspectedAt,
    confidence: 1,
    warnings: [],
  };
  const compatibility = {
    schemaVersion: "1.0.0" as const,
    templateForkDetected: absent,
    templateFilesDetected: absent,
    mystProjectDetected: absent,
    bibliographyDetected: absent,
    reviewContentDetected: absent,
    provenanceDetected: absent,
    trustDataDetected: absent,
    releaseDetected: absent,
    doiDetected: absent,
    overallCompatibility: "compatible" as const,
    levelRationale: ["Valid node declaration detected."],
    blockingErrors: [],
    warnings: [],
    recommendations: [],
  };
  const nodeExtraction = {
    schemaVersion: "1.0.0" as const,
    extractorVersion: "e2e",
    commitSha,
    manifest: { path: "node-manifest.json" as const, status: "ok" as const, errors: [] },
    nodes: [
      {
        status: "ok" as const,
        sourcePath: "nodes/publications.json",
        sourcePointer: "/0",
        declaredId: "claim:e2e",
        node: {
          id: "claim:e2e",
          kind: "claim" as const,
          title,
          text: 'Literal markup: <img src=x onerror="alert(1)">',
          contributors: [{ displayName: "E2E Researcher" }],
          license: "CC-BY-4.0",
          provenance: { sourcePath: "nodes/publications.json", repositoryUrl, commitSha },
          payload: { statement: "The e2e node is safely rendered.", qualifiers: [] },
        },
        fieldProvenance: {
          title: {
            source: "node-record" as const,
            file: "nodes/publications.json",
            pointer: "/0/title",
            commitSha,
            extractorVersion: "e2e",
            confidence: 1 as const,
          },
        },
        doiReferences: [],
        issues: [],
      },
    ],
    edges: [],
    counts: { ok: 1, invalid: 0, skipped: 0, edgesOk: 0, edgesInvalid: 0, edgesSkipped: 0 },
    errors: [],
    warnings: [],
  };
  const validation = {
    schemaVersion: "1.0.0" as const,
    hardErrors: [],
    warnings: [],
    releaseValidation: { releaseDetected: false, details: ["Repository-only node submission."] },
    metadataCompleteness: { requiredMissing: [], recommendedMissing: [], score: 1 },
    compatibilityLevel: "compatible" as const,
    evidenceDataAvailable: false,
    trustDataAvailable: false,
    validatedAt: inspectedAt,
  };
  return {
    title,
    payload: {
      schemaVersion: "1.1.0" as const,
      report,
      extraction: {
        metadata: {
          extractorVersion: "e2e",
          extractedAt: inspectedAt,
          commitSha,
          fields: {
            title: { value: title, provenance },
            repositoryUrl: { value: repositoryUrl, provenance },
            commitSha: { value: commitSha, provenance },
          },
          warnings: [],
        },
        manifestPresent: false,
        knowledge: { claims: [], citations: [], relations: [], trust: [], warnings: [] },
        nodeExtraction,
        compatibility,
      },
      validation,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
