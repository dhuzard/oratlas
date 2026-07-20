import { expect, test, type Page } from "@playwright/test";
import { getPrisma } from "@oratlas/db";

const prisma = getPrisma();

test("review, claim, citation, relation, node, and edge deep links resolve", async ({ page }) => {
  const relation = await prisma.claimEvidenceRelation.findFirstOrThrow({
    where: {
      claim: { reviewVersion: { review: { status: "published" } } },
      trustAssessments: { some: {} },
    },
    include: {
      claim: { include: { reviewVersion: { include: { review: true } } } },
      citation: true,
      trustAssessments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const version = relation.claim.reviewVersion;
  const reviewBase = `/reviews/${version.review.slug}/versions/${version.id}`;

  await expectResolved(page, reviewBase, "article");
  await expectResolved(
    page,
    `/claims/${version.id}/${encodeURIComponent(relation.claim.localClaimId)}`,
    "article",
  );
  await expectTarget(
    page,
    `${reviewBase}#citation-${encodeURIComponent(relation.citation.localCitationId)}`,
    `citation-${relation.citation.localCitationId}`,
  );
  await expectTarget(page, `${reviewBase}#relation-${relation.id}`, `relation-${relation.id}`);
  await expectTarget(
    page,
    `${reviewBase}#assessment-${relation.trustAssessments[0]!.id}`,
    `assessment-${relation.trustAssessments[0]!.id}`,
  );

  const edge = await prisma.nodeEdge.findFirstOrThrow({
    where: { status: "confirmed" },
    include: { sourceNodeVersion: true },
  });
  await expectResolved(
    page,
    `/nodes/${edge.sourceNodeVersion.knowledgeNodeId}/versions/${edge.sourceNodeVersionId}`,
    "article",
  );
  await expectTarget(
    page,
    `/graph?seed=${encodeURIComponent(edge.sourceNodeVersion.knowledgeNodeId)}&edgeStatus=confirmed&depth=1&limit=50#edge-${edge.id}`,
    `edge-${edge.id}`,
  );
});

async function expectResolved(page: Page, url: string, selector: string) {
  const response = await page.goto(url);
  if (response) expect(response.ok(), url).toBeTruthy();
  await expect(page.locator(selector).first()).toBeVisible();
}

async function expectTarget(page: Page, url: string, id: string) {
  const response = await page.goto(url);
  if (response) expect(response.ok(), url).toBeTruthy();
  const target = page.locator(`[id="${id}"]`);
  await expect(target).toBeVisible();
  await expect(target).toHaveCSS("outline-style", "solid");
}
