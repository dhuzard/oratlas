import { test, expect } from "@playwright/test";
import { canonicalJson } from "@oratlas/contracts";
import { getPrisma } from "@oratlas/db";
import { proposeNodeIdentities } from "@oratlas/knowledge";

const prisma = getPrisma();

test("seeded claims in two reviews can be confirmed or rejected without merging", async ({
  page,
}) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const statement = "Daily treatment improves overall survival among adults after twelve months.";
  const source = await createClaimFixture(`c01-source-${suffix}`, statement, "d");
  const confirmedTarget = await createClaimFixture(
    `c01-confirm-${suffix}`,
    statement.toUpperCase().replace(/\.$/, "!"),
    "e",
  );
  const rejectedTarget = await createClaimFixture(
    `c01-reject-${suffix}`,
    statement.replace(/\.$/, "?"),
    "f",
  );
  const report = proposeNodeIdentities(
    [source, confirmedTarget, rejectedTarget].map((fixture) => ({
      knowledgeNodeId: fixture.nodeId,
      repositoryId: fixture.repositoryId,
      localNodeId: fixture.localNodeId,
      kind: "claim" as const,
      aliases: [],
      claim: { statement: fixture.statement, qualifiers: [] },
    })),
  );
  const proposalFor = async (targetNodeId: string) => {
    const proposal = report.proposals.find(
      (candidate) =>
        [candidate.source.knowledgeNodeId, candidate.target.knowledgeNodeId].includes(
          source.nodeId,
        ) &&
        [candidate.source.knowledgeNodeId, candidate.target.knowledgeNodeId].includes(targetNodeId),
    )!;
    await prisma.nodeIdentityProposal.create({
      data: {
        id: proposal.proposalId,
        kind: proposal.kind,
        sourceNodeId: proposal.source.knowledgeNodeId,
        targetNodeId: proposal.target.knowledgeNodeId,
        signalsJson: canonicalJson(proposal.signals),
        sharedAliasesJson: canonicalJson(proposal.sharedAliases),
        sourceTextHash: proposal.sourceTextHash,
        targetTextHash: proposal.targetTextHash,
        textSimilarity: proposal.textSimilarity,
        methodVersion: proposal.methodVersion,
      },
    });
    return proposal;
  };
  await proposalFor(confirmedTarget.nodeId);
  await proposalFor(rejectedTarget.nodeId);

  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(page).toHaveURL(/\/editorial/);

  const confirmCard = page
    .locator("article.claim-card")
    .filter({ hasText: confirmedTarget.reviewTitle });
  await confirmCard
    .getByPlaceholder(/Attributable decision note/)
    .fill("Editor confirmed identical normalized wording and matching scientific scope.");
  const confirmResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/node-identity-proposals/") &&
      response.request().method() === "POST",
  );
  await confirmCard.getByRole("button", { name: "Confirm same claim" }).click();
  expect((await confirmResponse).ok()).toBeTruthy();
  await expect(confirmCard).toHaveCount(0);

  const rejectCard = page
    .locator("article.claim-card")
    .filter({ hasText: rejectedTarget.reviewTitle });
  await rejectCard
    .getByPlaceholder(/Attributable decision note/)
    .fill("Editor rejected this candidate after checking its separately declared scope.");
  const rejectResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/node-identity-proposals/") &&
      response.request().method() === "POST",
  );
  await rejectCard.getByRole("button", { name: "Reject" }).click();
  expect((await rejectResponse).ok()).toBeTruthy();

  await page.goto(`/nodes/${source.nodeId}`);
  const alsoAsserted = page.getByRole("heading", { name: "Also asserted in (1)" });
  await expect(alsoAsserted).toBeVisible();
  await expect(page.getByText(confirmedTarget.reviewTitle).first()).toBeVisible();
  await expect(page.getByText(rejectedTarget.reviewTitle)).toHaveCount(0);

  await page.goto(`/claims/${source.versionId}/${source.localNodeId}`);
  await expect(page.getByRole("heading", { name: "Also asserted in (1)" })).toBeVisible();
  await expect(page.getByText(new RegExp(confirmedTarget.reviewTitle)).first()).toBeVisible();
  await expect(page.getByText(/do not merge claims or carry TRUST assessments/)).toBeVisible();
  expect(
    await prisma.knowledgeNode.count({
      where: { id: { in: [source.nodeId, confirmedTarget.nodeId] } },
    }),
  ).toBe(2);
});

async function createClaimFixture(slug: string, statement: string, hashChar: string) {
  const repository = await prisma.repository.create({
    data: {
      owner: slug,
      name: "review",
      canonicalUrl: `https://github.com/${slug}/review`,
    },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha: hashChar.repeat(40),
      contentHash: hashChar.repeat(64),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
    },
  });
  const reviewTitle = `C01 ${slug} review`;
  const review = await prisma.review.create({
    data: {
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
      slug,
      title: reviewTitle,
      status: "published",
    },
  });
  const reviewVersion = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: reviewTitle,
      metadataJson: canonicalJson({ keywords: [], domains: [] }),
      publicState: "published",
      publishedAt: new Date(),
    },
  });
  const localNodeId = `claim-${slug}`;
  const node = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId, kind: "claim" },
  });
  await prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: node.id,
      snapshotId: snapshot.id,
      title: reviewTitle,
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({
        sourcePath: `claims/${localNodeId}.json`,
        repositoryUrl: repository.canonicalUrl,
      }),
      payloadJson: canonicalJson({ statement, qualifiers: [] }),
    },
  });
  await prisma.claim.create({
    data: {
      reviewVersionId: reviewVersion.id,
      knowledgeNodeId: node.id,
      localClaimId: localNodeId,
      text: statement,
      normalizedText: statement.toLowerCase(),
    },
  });
  return {
    nodeId: node.id,
    repositoryId: repository.id,
    localNodeId,
    statement,
    reviewTitle,
    versionId: reviewVersion.id,
  };
}
