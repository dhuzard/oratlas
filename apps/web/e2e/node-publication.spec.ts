import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  canonicalJson,
  subgraphEvidencePacketSchema,
  synthesisStalenessAffectedReferenceSchema,
} from "@oratlas/contracts";

const firstCommitSha = "d".repeat(40);
const firstTreeSha = "e".repeat(40);
const secondCommitSha = "f".repeat(40);
const secondTreeSha = "a".repeat(40);
const followUpTag = "follow-up-v2";
const firstSourceTitle = 'Escaped <script>alert("node")</script>';
const followUpSourceTitle = "E2E causal source head v2";
const followUpNewNodeTitle = "E2E follow-up analysis code";

interface InspectionResponse {
  captureToken: string;
  capturePayloadHash: string;
  selectedSource: {
    kind: string;
    commitSha: string;
    treeSha: string;
    releaseTag?: string;
  };
  nodeExtraction: {
    manifest: { path: string; status: string };
    nodes: Array<{ node?: { id: string; title: string } }>;
    edges: Array<{
      edge?: { sourceNodeId: string; targetNodeId: string; relationType: string };
    }>;
  };
}

test("submitter finalizes a node-only capture and an editor publishes its nodes", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const unique = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const repositoryName = `node-e2e-${unique}`;
  const repositoryUrl = `https://github.com/e2e-lab/${repositoryName}`;
  const githubRepositoryId = String(
    Number.parseInt(createHash("sha256").update(repositoryName).digest("hex").slice(0, 12), 16),
  );

  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as submitter/ }).click();
  await expect(page.getByText("atlas-submitter")).toBeVisible();

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const submitter = await prisma.user.findUniqueOrThrow({
    where: { githubUserId: "mock:atlas-submitter" },
  });

  await page.getByLabel("Public GitHub repository URL").fill(repositoryUrl);
  const firstInspectionResponse = page.waitForResponse(
    (response) => response.url().includes("/api/inspect") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inspect repository" }).click();
  const firstInspectionHttp = await firstInspectionResponse;
  expect(firstInspectionHttp.ok(), await firstInspectionHttp.text()).toBeTruthy();
  const firstInspection = (await firstInspectionHttp.json()) as InspectionResponse;
  expect(firstInspection.selectedSource).toMatchObject({
    kind: "default-branch",
    commitSha: firstCommitSha,
    treeSha: firstTreeSha,
  });
  expect(firstInspection.nodeExtraction.manifest).toMatchObject({
    path: "node-manifest.json",
    status: "ok",
  });
  expect(firstInspection.nodeExtraction.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        node: expect.objectContaining({ id: "claim:e2e", title: firstSourceTitle }),
      }),
      expect.objectContaining({ node: expect.objectContaining({ id: "dataset:e2e" }) }),
    ]),
  );
  expect(firstInspection.nodeExtraction.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        edge: expect.objectContaining({
          sourceNodeId: "claim:e2e",
          targetNodeId: "dataset:e2e",
          relationType: "uses-dataset",
        }),
      }),
    ]),
  );
  const firstCapture = await prisma.inspectionCapture.findUniqueOrThrow({
    where: { tokenHash: sha256(firstInspection.captureToken) },
  });
  expect(firstCapture).toMatchObject({
    payloadHash: firstInspection.capturePayloadHash,
    githubRepositoryId,
    canonicalUrlAtCapture: repositoryUrl,
    inspectedByUserId: submitter.id,
    commitSha: firstCommitSha,
  });
  expect(sha256(firstCapture.payloadJson)).toBe(firstCapture.payloadHash);
  expect(canonicalJson(JSON.parse(firstCapture.payloadJson))).toBe(firstCapture.payloadJson);
  const firstCapturePayload = JSON.parse(firstCapture.payloadJson) as {
    report: {
      selectedSource: { commitSha: string; treeSha: string };
      files: Record<string, string>;
    };
    extraction: { nodeExtraction: InspectionResponse["nodeExtraction"] };
  };
  expect(firstCapturePayload.report.selectedSource).toMatchObject({
    commitSha: firstCommitSha,
    treeSha: firstTreeSha,
  });
  expect(Object.keys(firstCapturePayload.report.files)).toEqual(
    expect.arrayContaining([
      "node-manifest.json",
      "nodes/claim.json",
      "nodes/dataset.json",
      "nodes/edges.jsonl",
    ]),
  );
  expect(firstCapturePayload.extraction.nodeExtraction).toEqual(firstInspection.nodeExtraction);
  await expect(page.getByRole("heading", { name: "Review extracted metadata" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to node candidates" }).click();
  await expect(
    page.getByRole("heading", { name: "Review extracted node candidates" }),
  ).toBeVisible();
  await expect(page.getByText(firstSourceTitle)).toBeVisible();
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
  await page.goto("/nodes");
  await expect(page.locator("article.card").filter({ hasText: repositoryName })).toHaveCount(0);
  expect(
    await prisma.knowledgeNode.count({
      where: { repository: { canonicalUrl: repositoryUrl } },
    }),
  ).toBe(0);
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
  await expect(submissionCard.getByText(firstSourceTitle).last()).toBeVisible();
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
  await expect(publicNode.getByText(firstSourceTitle)).toBeVisible();
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
  const confirmedAgentProposal = await prisma.nodeEdgeProposal.findUniqueOrThrow({
    where: { id: agentProposal.proposalId },
    include: { confirmedEdge: true },
  });
  expect(confirmedAgentProposal).toMatchObject({
    status: "confirmed",
    sourceNodeVersionId: sourceVersion.id,
    targetNodeVersionId: datasetVersion.id,
    reviewedAt: expect.any(Date),
    confirmedEdgeId: expect.any(String),
  });
  const supportsEdge = confirmedAgentProposal.confirmedEdge!;
  expect(supportsEdge).toMatchObject({
    sourceNodeVersionId: sourceVersion.id,
    targetNodeId: datasetIdentity.id,
    confirmedTargetNodeVersionId: datasetVersion.id,
    relationType: "supports",
    status: "confirmed",
    provenance: "confirmed-by-editor",
    confirmedById: expect.any(String),
    confirmedAt: expect.any(Date),
  });

  const sourceVersionResponse = await editorPage.request.get(
    `/api/nodes/${sourceIdentity.id}/versions/${sourceVersion.id}`,
  );
  expect(sourceVersionResponse.ok()).toBeTruthy();
  const sourceVersionPublic = (await sourceVersionResponse.json()) as {
    edges: Array<{
      id: string;
      direction: string;
      relationType: string;
      provenance: string;
      relatedNode: { id: string; versionId: string };
    }>;
  };
  expect(sourceVersionPublic.edges).toContainEqual(
    expect.objectContaining({
      id: supportsEdge.id,
      direction: "outgoing",
      relationType: "supports",
      provenance: "confirmed-by-editor",
      relatedNode: expect.objectContaining({
        id: datasetIdentity.id,
        versionId: datasetVersion.id,
      }),
    }),
  );
  await editorPage.goto(`/nodes/${sourceIdentity.id}/versions/${sourceVersion.id}`);
  const supportsRelation = editorPage
    .locator(".node-relation-list > li")
    .filter({ hasText: "supports" })
    .filter({
      has: editorPage.locator(
        `a[href="/nodes/${datasetIdentity.id}/versions/${datasetVersion.id}"]`,
      ),
    });
  await expect(supportsRelation).toBeVisible();
  await expect(supportsRelation).toContainText("confirmed by editor");

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
  const synthesisPacket = subgraphEvidencePacketSchema.parse(JSON.parse(synthesisDraft.packetJson));
  expect(synthesisPacket.edges).toContainEqual(
    expect.objectContaining({
      id: supportsEdge.id,
      sourceNodeId: sourceIdentity.id,
      sourceVersionId: sourceVersion.id,
      targetNodeId: datasetIdentity.id,
      targetVersionId: datasetVersion.id,
      relationType: "supports",
      status: "confirmed",
      provenance: "confirmed-by-editor",
    }),
  );
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
  const acceptedSynthesis = (await synthesisDecision.json()) as {
    reviewSlug: string;
    reviewVersionId: string;
  };

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

  await page.goto("/submit");
  await page.getByLabel("Public GitHub repository URL").fill(repositoryUrl);
  await page.getByLabel("Source to capture").selectOption("tag");
  await page.getByLabel("Exact tag").fill(followUpTag);
  const followUpInspectionResponse = page.waitForResponse(
    (response) => response.url().includes("/api/inspect") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inspect repository" }).click();
  const followUpInspectionHttp = await followUpInspectionResponse;
  expect(followUpInspectionHttp.ok(), await followUpInspectionHttp.text()).toBeTruthy();
  const followUpInspection = (await followUpInspectionHttp.json()) as InspectionResponse;
  expect(followUpInspection.selectedSource).toMatchObject({
    kind: "tag",
    commitSha: secondCommitSha,
    treeSha: secondTreeSha,
    releaseTag: followUpTag,
  });
  expect(followUpInspection.nodeExtraction.manifest).toMatchObject({
    path: "node-manifest.json",
    status: "ok",
  });
  expect(followUpInspection.nodeExtraction.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        node: expect.objectContaining({ id: "claim:e2e", title: followUpSourceTitle }),
      }),
      expect.objectContaining({
        node: expect.objectContaining({ id: "code:e2e-followup", title: followUpNewNodeTitle }),
      }),
    ]),
  );
  const followUpCapture = await prisma.inspectionCapture.findUniqueOrThrow({
    where: { tokenHash: sha256(followUpInspection.captureToken) },
  });
  expect(followUpCapture).toMatchObject({
    payloadHash: followUpInspection.capturePayloadHash,
    githubRepositoryId,
    canonicalUrlAtCapture: repositoryUrl,
    inspectedByUserId: submitter.id,
    commitSha: secondCommitSha,
  });
  expect(sha256(followUpCapture.payloadJson)).toBe(followUpCapture.payloadHash);
  expect(canonicalJson(JSON.parse(followUpCapture.payloadJson))).toBe(followUpCapture.payloadJson);
  const followUpCapturePayload = JSON.parse(followUpCapture.payloadJson) as {
    report: {
      selectedSource: { commitSha: string; treeSha: string };
      files: Record<string, string>;
    };
    extraction: { nodeExtraction: InspectionResponse["nodeExtraction"] };
  };
  expect(followUpCapturePayload.report.selectedSource).toMatchObject({
    commitSha: secondCommitSha,
    treeSha: secondTreeSha,
  });
  expect(Object.keys(followUpCapturePayload.report.files)).toEqual(
    expect.arrayContaining(["node-manifest.json", "nodes/claim.json", "nodes/follow-up-code.json"]),
  );
  expect(followUpCapturePayload.extraction.nodeExtraction).toEqual(
    followUpInspection.nodeExtraction,
  );
  await expect(page.getByRole("heading", { name: "Review extracted metadata" })).toBeVisible();
  await expect(page.getByText(secondCommitSha)).toBeVisible();
  await page.getByRole("button", { name: "Continue to node candidates" }).click();
  await expect(page.getByText(followUpSourceTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(followUpNewNodeTitle, { exact: true })).toBeVisible();
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
  await expect(page.locator("article.card").filter({ hasText: repositoryName })).toHaveCount(2);
  await expect(
    page
      .locator("article.card")
      .filter({ hasText: repositoryName })
      .getByText(followUpSourceTitle, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator("article.card")
      .filter({ hasText: repositoryName })
      .getByText(followUpNewNodeTitle, { exact: true }),
  ).toHaveCount(0);

  await editorPage.goto("/editorial");
  const followUpCard = editorPage
    .locator("article.card")
    .filter({ hasText: repositoryName })
    .filter({ hasText: secondCommitSha });
  await expect(
    followUpCard.locator("strong").getByText(followUpSourceTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    followUpCard.locator("strong").getByText(followUpNewNodeTitle, { exact: true }),
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
  const sourceVersionV2 = updatedSource.versions.find(
    (version) => version.snapshot.commitSha === secondCommitSha,
  );
  if (!sourceVersionV2) throw new Error("Expected the accepted follow-up commit to create v2.");
  expect(sourceVersionV2).toMatchObject({
    title: followUpSourceTitle,
    snapshot: { commitSha: secondCommitSha },
  });
  const newNode = await prisma.knowledgeNode.findFirstOrThrow({
    where: { repository: { canonicalUrl: repositoryUrl }, localNodeId: "code:e2e-followup" },
    include: { versions: { include: { snapshot: true } } },
  });
  expect(newNode.versions).toHaveLength(1);
  expect(newNode.versions[0]).toMatchObject({ snapshot: { commitSha: secondCommitSha } });

  await editorPage.goto("/nodes");
  const currentRepositoryNodes = editorPage.locator("article.card").filter({
    hasText: repositoryName,
  });
  await expect(
    currentRepositoryNodes.getByText(followUpSourceTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    currentRepositoryNodes.getByText(followUpNewNodeTitle, { exact: true }),
  ).toBeVisible();
  await editorPage.goto("/coverage");
  const uncoveredNode = editorPage.getByRole("link", {
    name: followUpNewNodeTitle,
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
  const stalenessProposal = await prisma.synthesisRegenerationProposal.findFirstOrThrow({
    where: {
      acceptedReviewVersionId: acceptedSynthesis.reviewVersionId,
      status: "open",
    },
    include: { evaluation: true },
  });
  expect(stalenessProposal.evaluation).toMatchObject({
    acceptedReviewVersionId: acceptedSynthesis.reviewVersionId,
    status: "stale",
  });
  expect(JSON.parse(stalenessProposal.evaluation.reasonCodesJson)).toContain("node-head-changed");
  const affectedReferences = synthesisStalenessAffectedReferenceSchema
    .array()
    .parse(JSON.parse(stalenessProposal.evaluation.affectedReferencesJson));
  expect(affectedReferences).toContainEqual({
    kind: "node",
    id: sourceIdentity.id,
    change: "changed",
    previousVersionId: sourceVersion.id,
    currentVersionId: sourceVersionV2.id,
  });
  await editorPage.reload();
  const staleProposal = editorPage
    .locator("article[data-staleness-proposal]")
    .filter({
      has: editorPage.locator(`a[href="/reviews/${acceptedSynthesis.reviewSlug}"]`),
    })
    .filter({ hasText: "node-head-changed" });
  await expect(staleProposal).toBeVisible();
  await staleProposal.getByText("Inspect bounded affected references").click();
  const exactSourceDelta = staleProposal.locator("li").filter({
    hasText: `node ${sourceIdentity.id} · changed`,
  });
  await expect(exactSourceDelta).toBeVisible();
  await expect(
    exactSourceDelta.locator(`a[href="/nodes/${sourceIdentity.id}/versions/${sourceVersion.id}"]`),
  ).toBeVisible();
  await expect(
    exactSourceDelta.locator(
      `a[href="/nodes/${sourceIdentity.id}/versions/${sourceVersionV2.id}"]`,
    ),
  ).toBeVisible();
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
