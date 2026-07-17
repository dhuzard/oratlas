import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { canonicalJson } from "@oratlas/contracts";

const firstCommitSha = "d".repeat(40);
const firstTreeSha = "e".repeat(40);
const secondCommitSha = "f".repeat(40);
const secondTreeSha = "a".repeat(40);

test("submitter finalizes a node-only capture and an editor publishes its nodes", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const unique = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const repositoryName = `node-e2e-${unique}`;
  const repositoryUrl = `https://github.com/e2e-lab/${repositoryName}`;
  const githubRepositoryId = `${Date.now()}${randomBytes(4).readUInt32BE()}`;

  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as submitter/ }).click();
  await expect(page.getByText("atlas-submitter")).toBeVisible();

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const submitter = await prisma.user.findUniqueOrThrow({
    where: { githubUserId: "mock:atlas-submitter" },
  });
  const token = randomBytes(32).toString("base64url");
  const fixture = captureFixture(repositoryName, repositoryUrl, {
    githubRepositoryId,
    commitSha: firstCommitSha,
    treeSha: firstTreeSha,
  });
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
      commitSha: firstCommitSha,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  let activeCapture = { fixture, token, payloadHash };

  await page.route("**/api/inspect", async (route) => {
    const active = activeCapture;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        inspectionResponse(active.fixture, active.token, active.payloadHash, repositoryUrl),
      ),
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

  const pendingProposal = await prisma.nodeEdgeProposal.findFirstOrThrow({
    where: { sourceSubmissionId: finalized.submissionId },
  });
  const submitterDecisionStatus = await page.evaluate(async (proposalId) => {
    const response = await fetch(`/api/editorial/node-edge-proposals/${proposalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "confirm",
        expectedRevision: 0,
        note: "A submitter cannot confer editorial authority.",
      }),
    });
    return response.status;
  }, pendingProposal.id);
  expect(submitterDecisionStatus).toBe(403);
  const oversizedEdgeDecisionStatus = await editorPage.evaluate(async (proposalId) => {
    const response = await fetch(`/api/editorial/node-edge-proposals/${proposalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(300_000) }),
    });
    return response.status;
  }, pendingProposal.id);
  expect(oversizedEdgeDecisionStatus).toBe(413);

  const confirmProposal = editorPage
    .locator("article.claim-card")
    .filter({ hasText: "uses-dataset" })
    .filter({ hasText: "author assertion" });
  await expect(confirmProposal.getByText(/proposal — not editor-confirmed/)).toBeVisible();
  await confirmProposal
    .getByPlaceholder(/Attributable decision note/)
    .fill("Editor checked the captured dataset relation.");
  await confirmProposal.getByRole("button", { name: "Confirm edge" }).click();
  const rejectProposal = editorPage
    .locator("article.claim-card")
    .filter({ hasText: "derives-from" });
  await rejectProposal
    .getByPlaceholder(/Attributable decision note/)
    .fill("The captured record does not justify derivation.");
  await rejectProposal.getByRole("button", { name: "Reject" }).click();

  const publishedSourceIdentity = await prisma.knowledgeNode.findFirstOrThrow({
    where: { repository: { canonicalUrl: repositoryUrl }, localNodeId: "claim:e2e" },
  });
  const publicProjection = await editorPage.evaluate(async (nodeId) => {
    const response = await fetch(`/api/nodes/${nodeId}/edges`);
    return response.json() as Promise<{ edges: Array<{ relationType: string; status: string }> }>;
  }, publishedSourceIdentity.id);
  expect(publicProjection.edges).toEqual([
    expect.objectContaining({ relationType: "uses-dataset", status: "confirmed" }),
  ]);

  await editorPage.goto("/nodes");
  const publicNode = editorPage.locator("article.card").filter({ hasText: repositoryName });
  await expect(publicNode.getByText(fixture.title)).toBeVisible();
  await expect(editorPage.locator('img[src="x"]')).toHaveCount(0);

  const sourceIdentity = await prisma.knowledgeNode.findFirstOrThrow({
    where: { repository: { canonicalUrl: repositoryUrl }, localNodeId: "claim:e2e" },
    include: {
      repository: true,
      versions: { include: { snapshot: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });
  const datasetIdentity = await prisma.knowledgeNode.findFirstOrThrow({
    where: { repository: { canonicalUrl: repositoryUrl }, localNodeId: "dataset:e2e" },
    include: {
      repository: true,
      versions: { include: { snapshot: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });
  const sourceVersion = sourceIdentity.versions[0]!;
  const datasetVersion = datasetIdentity.versions[0]!;
  const agentEvidence = {
    method: "offline-causal-e2e",
    references: [sourceVersion.id, datasetVersion.id],
  };
  const agentCandidate = {
    sourceStableKey: stableNodeVersionKey(
      githubRepositoryId,
      sourceIdentity.localNodeId,
      sourceVersion.snapshot.commitSha,
    ),
    targetStableKey: stableNodeVersionKey(
      githubRepositoryId,
      datasetIdentity.localNodeId,
      datasetVersion.snapshot.commitSha,
    ),
    relationType: "supports",
    rationale: "The external deterministic agent found support in the captured observations.",
    evidence: agentEvidence,
  };
  const candidateJson = canonicalJson(agentCandidate);
  const agentOutputJson = canonicalJson({
    candidate: agentCandidate,
    candidateHash: sha256(candidateJson),
  });
  const agentRun = await prisma.agentRun.create({
    data: {
      id: `node-edge-agent-${unique}`,
      agentType: "node-edge-proposal",
      modelProvider: "offline-e2e",
      modelName: "deterministic-causal-edge",
      modelVersion: "1.0.0",
      outputJson: agentOutputJson,
      status: "succeeded",
      completedAt: new Date(),
    },
  });
  const agentProposal = createAgentProposalThroughServerBoundary({
    agentRunId: agentRun.id,
    sourceNodeVersionId: sourceVersion.id,
    targetNodeVersionId: datasetVersion.id,
    relationType: agentCandidate.relationType,
    rationale: agentCandidate.rationale,
    evidence: agentCandidate.evidence,
  });
  const persistedAgentBoundary = await prisma.nodeEdgeProposal.findUniqueOrThrow({
    where: { id: agentProposal.proposalId },
    include: { agentRun: true },
  });
  expect(persistedAgentBoundary).toMatchObject({
    origin: "proposed-by-agent",
    status: "proposed",
    agentRunId: agentRun.id,
    evidenceJson: canonicalJson(agentEvidence),
  });
  expect(persistedAgentBoundary.agentRun?.outputJson).toBe(agentOutputJson);
  expect(
    await prisma.nodeEdge.count({
      where: {
        sourceNodeVersionId: sourceVersion.id,
        targetNodeId: datasetIdentity.id,
        relationType: "supports",
      },
    }),
  ).toBe(0);

  await editorPage.goto("/editorial");
  const agentProposalCard = editorPage
    .locator("article.claim-card")
    .filter({ hasText: "supports" })
    .filter({ hasText: "agent proposal" })
    .filter({ hasText: agentRun.id });
  await expect(agentProposalCard.getByText(/proposal — not editor-confirmed/)).toBeVisible();
  await agentProposalCard
    .getByPlaceholder(/Attributable decision note/)
    .fill("The editor checked the exact agent run, endpoint versions, and evidence bytes.");
  const agentDecisionResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes(`/api/editorial/node-edge-proposals/${agentProposal.proposalId}`) &&
      response.request().method() === "POST",
  );
  await agentProposalCard.getByRole("button", { name: "Confirm edge" }).click();
  expect((await agentDecisionResponse).ok()).toBeTruthy();
  expect(
    await prisma.nodeEdge.count({
      where: {
        sourceNodeVersionId: sourceVersion.id,
        targetNodeId: datasetIdentity.id,
        relationType: "supports",
        status: "confirmed",
        provenance: "confirmed-by-editor",
      },
    }),
  ).toBe(1);

  await editorPage.goto("/editorial");
  await editorPage.getByLabel("Seed node ID").fill(sourceIdentity.id);
  const generationResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/generate") &&
      response.request().method() === "POST",
  );
  await editorPage.getByRole("button", { name: "Generate synthesis" }).click();
  const generated = await generationResponse;
  expect(generated.ok(), await generated.text()).toBeTruthy();
  const draft = (await generated.json()) as {
    id: string;
    document: { title: string };
    citations: Array<{ nodeId: string; nodeVersionId: string }>;
    provenance: { provider: string; model: string };
  };
  expect(draft.provenance).toMatchObject({
    provider: "deterministic",
    model: "bounded-template-1.0",
  });
  expect(draft.citations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ nodeId: sourceIdentity.id, nodeVersionId: sourceVersion.id }),
      expect.objectContaining({ nodeId: datasetIdentity.id, nodeVersionId: datasetVersion.id }),
    ]),
  );
  const synthesisDraft = await prisma.synthesisDraft.findUniqueOrThrow({
    where: { id: draft.id },
    include: { agentRun: true },
  });
  expect(synthesisDraft).toMatchObject({
    status: "pending",
    generationMode: "deterministic-template",
  });
  expect(synthesisDraft.agentRun).toMatchObject({
    status: "succeeded",
    modelProvider: "deterministic",
    modelName: "bounded-template-1.0",
  });
  const privateSlug = `synthesis-${synthesisDraft.seriesKey.slice(0, 20)}`;
  expect((await editorPage.request.get(`/api/syntheses/${privateSlug}`)).status()).toBe(404);
  expect((await editorPage.request.get(`/reviews/${privateSlug}`)).status()).toBe(404);

  await editorPage.goto("/editorial");
  const draftCard = editorPage.locator(`article[data-draft-id="${draft.id}"]`);
  await expect(draftCard).toContainText("pending");
  const acceptSynthesis = draftCard.getByRole("button", { name: "Accept and publish" });
  await expect(acceptSynthesis).toBeDisabled();
  for (const checkbox of await draftCard.getByRole("checkbox").all()) await checkbox.check();
  await draftCard.getByLabel("SPDX license expression").fill("CC-BY-4.0");
  await draftCard
    .getByLabel("Rights statement")
    .fill("The editor confirms publication rights for this grounded offline synthesis.");
  await draftCard
    .getByLabel("Editorial rationale")
    .fill("The editor reviewed the complete draft, citations, agent boundary, and disclosures.");
  await expect(acceptSynthesis).toBeEnabled();
  const synthesisDecisionResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes(`/api/editorial/syntheses/${draft.id}/decision`) &&
      response.request().method() === "POST",
  );
  await acceptSynthesis.click();
  const synthesisDecision = await synthesisDecisionResponse;
  expect(synthesisDecision.ok(), await synthesisDecision.text()).toBeTruthy();
  const acceptedSynthesis = (await synthesisDecision.json()) as { reviewSlug: string };

  await editorPage.goto(`/reviews/${acceptedSynthesis.reviewSlug}`);
  await expect(editorPage.getByRole("heading", { name: draft.document.title })).toBeVisible();
  await expect(editorPage.getByText("editor accepted", { exact: true }).first()).toBeVisible();
  const citationLink = editorPage.locator("a.synthesis-inline-citation-link").first();
  const citationHref = await citationLink.getAttribute("href");
  expect(
    draft.citations.some(
      (citation) => citationHref === `/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`,
    ),
  ).toBe(true);
  expect(citationHref).toBeTruthy();
  await Promise.all([
    editorPage.waitForURL(citationHref!, { timeout: 15_000 }),
    citationLink.click(),
  ]);
  await expect(editorPage.getByRole("heading", { name: /Escaped|observations/ })).toBeVisible();

  const followUpFixture = captureFixture(repositoryName, repositoryUrl, {
    githubRepositoryId,
    commitSha: secondCommitSha,
    treeSha: secondTreeSha,
    followUp: true,
  });
  const followUpToken = randomBytes(32).toString("base64url");
  const followUpPayloadJson = canonicalJson(followUpFixture.payload);
  const followUpPayloadHash = sha256(followUpPayloadJson);
  await prisma.inspectionCapture.create({
    data: {
      tokenHash: sha256(followUpToken),
      payloadJson: followUpPayloadJson,
      payloadHash: followUpPayloadHash,
      githubRepositoryId,
      canonicalUrlAtCapture: repositoryUrl,
      inspectedByUserId: submitter.id,
      commitSha: secondCommitSha,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  activeCapture = {
    fixture: followUpFixture,
    token: followUpToken,
    payloadHash: followUpPayloadHash,
  };

  await page.goto("/submit");
  await page.getByLabel("Public GitHub repository URL").fill(repositoryUrl);
  await page.getByRole("button", { name: "Inspect repository" }).click();
  await expect(page.getByRole("heading", { name: "Review extracted metadata" })).toBeVisible();
  await expect(page.getByText(secondCommitSha)).toBeVisible();
  await page.getByRole("button", { name: "Continue to node candidates" }).click();
  await expect(page.getByText(followUpFixture.title, { exact: true })).toBeVisible();
  await expect(page.getByText(followUpFixture.newNodeTitle, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue to validation" }).click();
  const followUpSubmissionResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/submissions") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit for editorial review" }).click();
  const followUpSubmitted = await followUpSubmissionResponse;
  expect(followUpSubmitted.ok(), await followUpSubmitted.text()).toBeTruthy();
  const followUpSubmission = (await followUpSubmitted.json()) as { submissionId: string };
  expect(
    await prisma.submission.findUniqueOrThrow({ where: { id: followUpSubmission.submissionId } }),
  ).toMatchObject({ status: "pending-editorial-review" });
  await page.goto("/nodes");
  await expect(page.getByText(followUpFixture.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(followUpFixture.newNodeTitle, { exact: true })).toHaveCount(0);

  await editorPage.goto("/editorial");
  const followUpCard = editorPage
    .locator("article.card")
    .filter({ hasText: repositoryName })
    .filter({ hasText: secondCommitSha });
  await expect(
    followUpCard.locator("strong").getByText(followUpFixture.title, { exact: true }),
  ).toBeVisible();
  await expect(
    followUpCard.locator("strong").getByText(followUpFixture.newNodeTitle, { exact: true }),
  ).toBeVisible();
  const followUpDecisionResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/decision") && response.request().method() === "POST",
  );
  await followUpCard.getByRole("button", { name: "Accept" }).click();
  expect((await followUpDecisionResponse).ok()).toBeTruthy();

  const updatedSource = await prisma.knowledgeNode.findUniqueOrThrow({
    where: { id: sourceIdentity.id },
    include: {
      versions: { include: { snapshot: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });
  expect(updatedSource.versions).toHaveLength(2);
  expect(updatedSource.versions[0]).toMatchObject({
    title: followUpFixture.title,
    snapshot: { commitSha: secondCommitSha },
  });
  const newNode = await prisma.knowledgeNode.findFirstOrThrow({
    where: { repository: { canonicalUrl: repositoryUrl }, localNodeId: "code:e2e-followup" },
    include: { versions: { include: { snapshot: true } } },
  });
  expect(newNode.versions).toHaveLength(1);
  expect(newNode.versions[0]).toMatchObject({ snapshot: { commitSha: secondCommitSha } });

  await editorPage.goto("/nodes");
  await expect(editorPage.getByText(followUpFixture.title, { exact: true })).toBeVisible();
  await expect(editorPage.getByText(followUpFixture.newNodeTitle, { exact: true })).toBeVisible();
  await editorPage.goto("/coverage");
  const uncoveredNode = editorPage.getByRole("link", {
    name: followUpFixture.newNodeTitle,
  });
  await expect(uncoveredNode).toBeVisible();
  await expect(
    editorPage
      .locator("article")
      .filter({ has: uncoveredNode })
      .getByText("uncovered current version", { exact: true }),
  ).toBeVisible();

  await editorPage.goto("/editorial");
  const staleScanResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/staleness/scan") &&
      response.request().method() === "POST",
  );
  await editorPage.getByRole("button", { name: "Scan accepted syntheses" }).click();
  expect((await staleScanResponse).ok()).toBeTruthy();
  await editorPage.reload();
  const staleProposal = editorPage
    .locator("article[data-staleness-proposal]")
    .filter({
      has: editorPage.locator(`a[href="/reviews/${acceptedSynthesis.reviewSlug}"]`),
    })
    .filter({ hasText: "node-head-changed" });
  await expect(staleProposal).toBeVisible();
  const staleDecisionResponse = editorPage.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/staleness/") &&
      response.url().endsWith("/decision"),
  );
  await staleProposal.getByRole("button", { name: "Request private regeneration" }).click();
  expect((await staleDecisionResponse).ok()).toBeTruthy();

  await editorPage.goto(`/reviews/${acceptedSynthesis.reviewSlug}`);
  await expect(editorPage.getByText("Newer evidence exists")).toBeVisible();
  await editorPage.goto("/archive?contentType=synthesis");
  const synthesisResult = editorPage.locator("article.card").filter({
    has: editorPage.locator(`a[href="/reviews/${acceptedSynthesis.reviewSlug}"]`),
  });
  await expect(synthesisResult.getByText(/^stale · \d+ affected reference/)).toBeVisible();

  await editorContext.close();
  await prisma.$disconnect();
});

function captureFixture(
  repositoryName: string,
  repositoryUrl: string,
  options: {
    githubRepositoryId: string;
    commitSha: string;
    treeSha: string;
    followUp?: boolean;
  },
) {
  const { githubRepositoryId, commitSha, treeSha, followUp = false } = options;
  const title = followUp ? "E2E causal source head v2" : 'Escaped <script>alert("node")</script>';
  const newNodeTitle = "E2E follow-up analysis code";
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
    githubRepositoryId,
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
  const secondNode = followUp
    ? {
        status: "ok" as const,
        sourcePath: "nodes/publications.json",
        sourcePointer: "/1",
        declaredId: "code:e2e-followup",
        node: {
          id: "code:e2e-followup",
          kind: "code" as const,
          title: newNodeTitle,
          contributors: [{ displayName: "E2E Researcher" }],
          license: "CC-BY-4.0",
          provenance: { sourcePath: "nodes/publications.json", repositoryUrl, commitSha },
          payload: {
            entryPoints: ["src/follow-up.ts"],
            language: "TypeScript",
            releaseRef: "v2.0.0",
          },
        },
        fieldProvenance: {},
        doiReferences: [],
        issues: [],
      }
    : {
        status: "ok" as const,
        sourcePath: "nodes/publications.json",
        sourcePointer: "/1",
        declaredId: "dataset:e2e",
        node: {
          id: "dataset:e2e",
          kind: "dataset" as const,
          title: "E2E observations",
          contributors: [{ displayName: "E2E Researcher" }],
          license: "CC-BY-4.0",
          provenance: { sourcePath: "nodes/publications.json", repositoryUrl, commitSha },
          payload: { artifactPath: "data/observations.csv", format: "text/csv", sizeBytes: 42 },
        },
        fieldProvenance: {},
        doiReferences: [],
        issues: [],
      };
  const edges = followUp
    ? []
    : [
        {
          status: "ok" as const,
          sourcePath: "nodes/edges.jsonl",
          sourcePointer: "line:1",
          edge: {
            sourceNodeId: "claim:e2e",
            targetNodeId: "dataset:e2e",
            relationType: "uses-dataset" as const,
            rationale: "The claim uses the captured observations.",
          },
          issues: [],
        },
        {
          status: "ok" as const,
          sourcePath: "nodes/edges.jsonl",
          sourcePointer: "line:2",
          edge: {
            sourceNodeId: "claim:e2e",
            targetNodeId: "dataset:e2e",
            relationType: "derives-from" as const,
            rationale: "A second proposal exercises rejection.",
          },
          issues: [],
        },
      ];
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
          text: followUp
            ? "The second immutable source head adds a causal follow-up result."
            : 'Literal markup: <img src=x onerror="alert(1)">',
          contributors: [{ displayName: "E2E Researcher" }],
          license: "CC-BY-4.0",
          provenance: { sourcePath: "nodes/publications.json", repositoryUrl, commitSha },
          payload: {
            statement: followUp
              ? "The follow-up source head reports a causal update."
              : "The e2e node is safely rendered.",
            qualifiers: [],
          },
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
      secondNode,
    ],
    edges,
    counts: {
      ok: 2,
      invalid: 0,
      skipped: 0,
      edgesOk: edges.length,
      edgesInvalid: 0,
      edgesSkipped: 0,
    },
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
    newNodeTitle,
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

function inspectionResponse(
  fixture: ReturnType<typeof captureFixture>,
  token: string,
  payloadHash: string,
  repositoryUrl: string,
) {
  return {
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
      commitSha: fixture.payload.report.selectedSource.commitSha,
      authors: [],
      keywords: [],
      domains: [],
    },
    compatibility: fixture.payload.extraction.compatibility,
    validation: fixture.payload.validation,
    knowledgeCounts: { claims: 0, citations: 0, relations: 0, trust: 0 },
    nodeExtraction: fixture.payload.extraction.nodeExtraction,
    publicationTargets: { proseReview: false, knowledgeNodes: true },
  };
}

function stableNodeVersionKey(
  githubRepositoryId: string,
  localNodeId: string,
  commitSha: string,
): string {
  return canonicalJson({ githubRepositoryId, localNodeId, commitSha });
}

function createAgentProposalThroughServerBoundary(input: {
  agentRunId: string;
  sourceNodeVersionId: string;
  targetNodeVersionId: string;
  relationType: string;
  rationale: string;
  evidence: unknown;
}): { proposalId: string; idempotent: boolean } {
  const lifecycleUrl = new URL("../src/lib/node-edge-lifecycle.ts", import.meta.url).href;
  const script = `
    import { createAgentNodeEdgeProposal } from ${JSON.stringify(lifecycleUrl)};
    const result = await createAgentNodeEdgeProposal(${JSON.stringify(input)});
    process.stdout.write(JSON.stringify(result));
  `;
  const output = execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "--input-type=module", "--eval", script],
    { encoding: "utf8", env: process.env },
  );
  return JSON.parse(output) as { proposalId: string; idempotent: boolean };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
