import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

interface BrowserResponse {
  status: number;
  body: string;
}

async function postJson(page: Page, url: string, data: unknown): Promise<BrowserResponse> {
  return page.evaluate(
    async ({ target, body }) => {
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.text() };
    },
    { target: url, body: data },
  );
}

const selector = (nodeId: string) => ({
  schemaVersion: "synthesis-selector/1.0.0" as const,
  selection: { kind: "seed" as const, nodeId },
  depth: 2,
  maxNodes: 50,
  maxEdges: 200,
  relationTypes: [
    "contradicts",
    "derives-from",
    "extends",
    "replicates",
    "supports",
    "uses-code",
    "uses-dataset",
  ],
  trustPolicy: "authoritative-current-relation-trust-v1" as const,
  currentVersionPolicy: "newest-valid-no-history-fallback" as const,
  topicSeedPolicy: "current-public-title-abstract-search-v1" as const,
  topicSeedLimit: 5,
  edgePolicy: "editor-confirmed-exact-versions-only" as const,
  includeContradictions: true,
});

const checklist = {
  groundingAndCitationsReviewed: true,
  contradictionAndNonConsensusFramingReviewed: true,
  attributionAndAiDisclosureReviewed: true,
  limitationsReviewed: true,
  privacyAndInjectionLeakageReviewed: true,
  rightsAndLicenseConfirmed: true,
};

async function generate(page: Page, nodeId: string, requestKey: string) {
  const response = await postJson(page, "/api/editorial/syntheses/generate", {
    selector: selector(nodeId),
    requestKey,
  });
  expect(response.status, response.body).toBe(200);
  return JSON.parse(response.body) as { id: string; revision: number };
}

async function accept(page: Page, draft: { id: string; revision: number }, suffix: string) {
  const response = await postJson(page, "/api/editorial/syntheses/" + draft.id + "/decision", {
    action: "accept",
    expectedRevision: draft.revision,
    idempotencyKey: "e2e-diff-accept-" + suffix,
    rationale:
      "The editor reviewed the complete immutable draft, evidence delta, attribution and rights.",
    licenseSpdx: "CC-BY-4.0",
    rightsStatement: "The editor confirms publication rights for this grounded synthesis.",
    checklist,
  });
  expect(response.status, response.body).toBe(200);
  return JSON.parse(response.body) as {
    reviewSlug: string;
    reviewVersionId: string;
  };
}

test("reader links to a structured-first diff between two actually accepted generations", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(page).toHaveURL(/\/editorial/);

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const unique = "e2e-generation-diff-" + Date.now() + "-" + randomUUID().slice(0, 8);
  const repository = await prisma.repository.findFirstOrThrow({
    where: { snapshots: { some: {} } },
    orderBy: { id: "asc" },
    include: { snapshots: { orderBy: { capturedAt: "asc" }, take: 1 } },
  });
  const initialSnapshot = repository.snapshots[0]!;
  const nodeId = unique + "-node";
  const firstVersionId = unique + "-v1";
  const secondVersionId = unique + "-v2";
  await prisma.knowledgeNode.create({
    data: {
      id: nodeId,
      repositoryId: repository.id,
      localNodeId: unique,
      kind: "claim",
    },
  });
  await prisma.knowledgeNodeVersion.create({
    data: {
      id: firstVersionId,
      knowledgeNodeId: nodeId,
      snapshotId: initialSnapshot.id,
      title: "First accepted generation evidence",
      abstract: "The original bounded evidence snapshot.",
      text: "The first immutable evidence version supports the initial synthesis.",
      contributorsJson: '[{"displayName":"E2E Evidence Author"}]',
      license: "CC-BY-4.0",
      provenanceJson: JSON.stringify({
        sourcePath: "knowledge/e2e-generation-diff.json",
        repositoryUrl: repository.canonicalUrl,
        commitSha: initialSnapshot.commitSha,
      }),
      payloadJson: JSON.stringify({
        statement: "The first immutable evidence version supports the initial synthesis.",
        qualifiers: [],
      }),
      isExample: false,
      createdAt: new Date(),
    },
  });

  const firstDraft = await generate(page, nodeId, "e2e-diff-generate-first-" + unique);
  const firstAcceptance = await accept(page, firstDraft, "first-" + unique);
  await page.goto("/reviews/" + firstAcceptance.reviewSlug);
  await expect(
    page.getByRole("link", { name: /What changed since accepted version/i }),
  ).toHaveCount(0);

  const commitSha = createHash("sha1").update(unique).digest("hex");
  const secondSnapshotId = unique + "-snapshot";
  const editor = await prisma.user.findFirstOrThrow({ where: { role: "EDITOR" } });
  await prisma.repositorySnapshot.create({
    data: {
      id: secondSnapshotId,
      repositoryId: repository.id,
      commitSha,
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: createHash("sha256").update(unique).digest("hex"),
    },
  });
  const secondSourceSubmission = await prisma.submission.create({
    data: {
      submitterId: editor.id,
      reviewerId: editor.id,
      repositoryId: repository.id,
      snapshotId: secondSnapshotId,
      status: "accepted",
      acceptedNodeSelectionJson: JSON.stringify([unique]),
      submittedAt: new Date(),
      reviewedAt: new Date(),
    },
  });
  await prisma.knowledgeNodeVersion.create({
    data: {
      id: secondVersionId,
      knowledgeNodeId: nodeId,
      snapshotId: secondSnapshotId,
      sourceSubmissionId: secondSourceSubmission.id,
      title: "Second accepted generation evidence",
      abstract: "The bounded evidence changed for the next synthesis.",
      text: "The second immutable evidence version materially updates the synthesis.",
      contributorsJson: '[{"displayName":"E2E Evidence Author"}]',
      license: "CC-BY-4.0",
      provenanceJson: JSON.stringify({
        sourcePath: "knowledge/e2e-generation-diff.json",
        repositoryUrl: repository.canonicalUrl,
        commitSha,
      }),
      payloadJson: JSON.stringify({
        statement: "The second immutable evidence version materially updates the synthesis.",
        qualifiers: [],
      }),
      isExample: false,
      createdAt: new Date(Date.now() + 1_000),
    },
  });

  const secondDraft = await generate(page, nodeId, "e2e-diff-generate-second-" + unique);
  const secondAcceptance = await accept(page, secondDraft, "second-" + unique);
  expect(secondAcceptance.reviewSlug).toBe(firstAcceptance.reviewSlug);
  expect(secondAcceptance.reviewVersionId).not.toBe(firstAcceptance.reviewVersionId);

  await page.goto("/reviews/" + secondAcceptance.reviewSlug);
  const changesLink = page.getByRole("link", {
    name: "What changed since accepted version 1",
  });
  await expect(changesLink).toBeVisible();
  await expect(changesLink).toHaveAttribute(
    "href",
    "/reviews/" + secondAcceptance.reviewSlug + "/changes",
  );
  await Promise.all([
    page.waitForURL("/reviews/" + secondAcceptance.reviewSlug + "/changes", {
      timeout: 15_000,
    }),
    changesLink.click(),
  ]);
  await expect(
    page.getByRole("heading", { name: "What changed between accepted synthesis generations" }),
  ).toBeVisible();
  await expect(page.getByText("Accepted version 1 → accepted version 2")).toBeVisible();
  const structuredDelta = page.getByRole("region", { name: "Structured evidence delta" });
  await expect(structuredDelta.getByText(firstVersionId, { exact: true })).toBeVisible();
  await expect(structuredDelta.getByText(secondVersionId, { exact: true })).toBeVisible();
  await expect(page.getByText("Re-assessed at a new immutable version")).toBeVisible();
  expect(
    await page.locator("#structured-evidence-delta, #secondary-document-delta").allTextContents(),
  ).toEqual(["Structured evidence delta", "Secondary review document delta"]);
  const publicBody = await page.locator("body").innerText();
  for (const privateField of [
    "packetJson",
    "documentJson",
    "selectorJson",
    "agentRun",
    "decisionRationale",
  ]) {
    expect(publicBody).not.toContain(privateField);
  }
});
