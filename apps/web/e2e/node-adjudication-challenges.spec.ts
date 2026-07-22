import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "@oratlas/contracts";
import { getPrisma } from "@oratlas/db";

const prisma = getPrisma();
const runId = `${process.pid}-${Date.now()}`;
const proposalId = `ora-d02a-e2e-proposal-${runId}`;
const assessmentIds = [
  `ora-d02a-e2e-assessment-high-${runId}`,
  `ora-d02a-e2e-assessment-low-${runId}`,
];
let nodeId = "";

test.beforeAll(async () => {
  const seedProposal = await prisma.nodeEdgeProposal.findFirstOrThrow({
    where: {
      sourceNodeVersion: { knowledgeNode: { kind: "claim" } },
      targetNode: { kind: { in: ["dataset", "code", "figure"] } },
    },
    orderBy: { id: "asc" },
    include: {
      sourceNodeVersion: { include: { knowledgeNode: true } },
      targetNode: { include: { repository: true } },
      targetNodeVersion: { include: { snapshot: true } },
    },
  });
  nodeId = seedProposal.sourceNodeVersion.knowledgeNodeId;
  await prisma.nodeEdgeProposal.upsert({
    where: { id: proposalId },
    update: {},
    create: {
      id: proposalId,
      originKey: `e2e:d02a:author-asserted-node-relation:${runId}`,
      sourceStableKey: seedProposal.sourceStableKey,
      targetStableKey: seedProposal.targetStableKey,
      sourceNodeVersionId: seedProposal.sourceNodeVersionId,
      targetNodeId: seedProposal.targetNodeId,
      targetNodeVersionId: seedProposal.targetNodeVersionId,
      relationType: seedProposal.relationType,
      origin: "asserted-by-author",
      rationale: "Deterministic D02a browser fixture.",
      evidenceJson: "{}",
      status: "confirmed",
    },
  });

  const sourceRecord = (rating: "high" | "low", assessorId: string) =>
    canonicalJson({
      subjectType: "node-relation",
      subject: {
        claimNodeId: seedProposal.sourceNodeVersion.knowledgeNode.localNodeId,
        evidenceNodeId: seedProposal.targetNode.localNodeId,
        evidenceKind: seedProposal.targetNode.kind,
        relationType: seedProposal.relationType,
        evidenceRepository: {
          githubRepositoryId: seedProposal.targetNode.repository.githubRepositoryId!,
          commitSha: seedProposal.targetNodeVersion.snapshot.commitSha,
        },
      },
      protocolVersion: "trust-d02a-e2e-v1",
      assessorType: "human",
      assessorId,
      assessedAt: "2026-07-22T10:00:00.000Z",
      criteria: { sourceAccess: { rating, status: "assessed" } },
      reviewStatus: "human-reviewed",
    });

  for (const [index, rating] of (["high", "low"] as const).entries()) {
    const assessorId = `d02a-e2e-assessor-${index + 1}`;
    await prisma.nodeRelationTrustAssessment.upsert({
      where: { id: assessmentIds[index]! },
      update: {},
      create: {
        id: assessmentIds[index]!,
        nodeEdgeProposalId: proposalId,
        protocolVersion: "trust-d02a-e2e-v1",
        assessorType: "human",
        assessorId,
        assessedAt: new Date("2026-07-22T10:00:00.000Z"),
        sourceAccess: JSON.stringify({ rating, status: "assessed" }),
        sourceRecordJson: sourceRecord(rating, assessorId),
        sourceReviewStatus: "human-reviewed",
        sourceAssessorType: "human",
        sourceAssessorId: assessorId,
        sourceAssessedAt: new Date("2026-07-22T10:00:00.000Z"),
      },
    });
  }
});

test("publishes and challenges an exact node adjudication with attributable evidence", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(page).toHaveURL(/\/editorial/);
  await page.goto("/editorial/trust-adjudications");
  const disagreement = page
    .locator("article")
    .filter({ hasText: assessmentIds[0] })
    .filter({ hasText: assessmentIds[1] });
  await expect(disagreement).toBeVisible();
  await disagreement
    .locator("textarea")
    .fill("The explicit source-access ratings remain a material disagreement.");
  const [adjudicationResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/editorial/trust/adjudications") &&
        response.request().method() === "POST",
    ),
    disagreement.getByRole("button", { name: "Record adjudication" }).click(),
  ]);
  expect(adjudicationResponse.status()).toBe(200);
  const { id: adjudicationId } = (await adjudicationResponse.json()) as { id: string };

  await page.context().clearCookies();
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as submitter/ }).click();
  await expect(page).toHaveURL(/\/submit/);
  await page.goto(`/nodes/${nodeId}`);

  const adjudicationAnchor = page.locator(`#adjudication-${adjudicationId}`);
  await expect(adjudicationAnchor).toBeVisible();
  await expect(adjudicationAnchor).toContainText("disagreement upheld by @atlas-editor");
  const register = page.locator('[data-register="formal-challenge"]');
  await register.getByLabel("Immutable subject").selectOption({
    label: `Adjudication ${adjudicationId}`,
  });
  await register.getByLabel("Grounds").selectOption("methodology");
  const objection = `Exact node-adjudication objection ${Date.now()}`;
  await register.getByLabel("Objection").fill(objection);
  const [challengeResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/nodes/${nodeId}/challenges`) &&
        response.request().method() === "POST",
    ),
    register.getByRole("button", { name: "File challenge" }).click(),
  ]);
  expect(challengeResponse.status()).toBe(201);
  const { id: challengeId } = (await challengeResponse.json()) as { id: string };
  const challengeAnchor = page.locator(`#challenge-${challengeId}`);
  await expect(challengeAnchor).toContainText(objection);
  await expect(
    challengeAnchor.getByRole("link", { name: `Adjudication ${adjudicationId}` }),
  ).toHaveAttribute("href", `/nodes/${nodeId}#adjudication-${adjudicationId}`);

  await page.reload();
  const responseBody = `Attributable source-node contributor response ${Date.now()}`;
  const challenge = page.locator(`#challenge-${challengeId}`);
  await challenge.getByLabel("Contributor response").fill(responseBody);
  const [contributorResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/challenges/${challengeId}/responses`) &&
        response.request().method() === "POST",
    ),
    challenge.getByRole("button", { name: "Respond as contributor of record" }).click(),
  ]);
  expect(contributorResponse.status()).toBe(200);
  await expect(challenge).toContainText(responseBody);
  await expect(challenge).toContainText("@atlas-submitter · contributor of record");

  const jsonLink = page.getByRole("link", { name: "Scholarly challenge JSON" });
  const crateLink = page.getByRole("link", { name: "Challenge RO-Crate" });
  await expect(jsonLink).toHaveAttribute("href", `/api/nodes/${nodeId}/exports/challenges.json`);
  await expect(crateLink).toHaveAttribute(
    "href",
    `/api/nodes/${nodeId}/exports/challenges-ro-crate`,
  );
  const [jsonResponse, crateResponse] = await Promise.all([
    page.request.get(`/api/nodes/${nodeId}/exports/challenges.json`),
    page.request.get(`/api/nodes/${nodeId}/exports/challenges-ro-crate`),
  ]);
  expect(jsonResponse.ok()).toBeTruthy();
  expect(crateResponse.ok()).toBeTruthy();
  const json = (await jsonResponse.json()) as { challenges: Array<{ id: string }> };
  const crate = (await crateResponse.json()) as { "@graph": Array<{ "@id": string }> };
  expect(json.challenges).toContainEqual(expect.objectContaining({ id: challengeId }));
  expect(crate["@graph"]).toContainEqual(
    expect.objectContaining({ "@id": expect.stringContaining(`#challenge-${challengeId}`) }),
  );

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(blocking, blocking.map(({ id, help }) => `${id}: ${help}`).join("\n")).toEqual([]);
});
