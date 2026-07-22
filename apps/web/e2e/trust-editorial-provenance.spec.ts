import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getPrisma } from "@oratlas/db";
import { createSessionToken } from "../src/lib/session-token";

const nodeAssessmentId = "ora-f01-node-assessment";
const paginationAssessmentPrefix = "ora-f01-page-assessment-";
const rawSourceSentinel = "ORA_F01_RAW_SOURCE_JSON_MUST_NOT_RENDER";

test.beforeAll(async () => {
  const prisma = getPrisma();
  const proposal = await prisma.nodeEdgeProposal.findFirst({
    where: {
      origin: "asserted-by-author",
      sourceNodeVersion: { knowledgeNode: { kind: "claim" } },
      targetNode: { kind: { in: ["dataset", "code", "figure"] } },
    },
    orderBy: { id: "asc" },
    include: {
      sourceNodeVersion: { include: { knowledgeNode: true } },
      targetNode: true,
    },
  });
  if (!proposal) throw new Error("Seed data did not expose a node-edge proposal.");
  await prisma.nodeRelationTrustAssessment.upsert({
    where: { id: nodeAssessmentId },
    update: {},
    create: {
      id: nodeAssessmentId,
      nodeEdgeProposalId: proposal.id,
      protocolVersion: "trust-node-fixture-2.0",
      assessorType: "human",
      assessorId: "primary-node-assessor",
      assessedAt: new Date("2026-02-02T02:02:02.000Z"),
      limitationsJson: "[]",
      evidenceJson: JSON.stringify({ pointer: "node-evidence.json:8" }),
      reviewStatus: "unverified-import",
      sourceRecordJson: JSON.stringify({
        subjectType: "node-relation",
        subject: {
          claimNodeId: proposal.sourceNodeVersion.knowledgeNode.localNodeId,
          evidenceNodeId: proposal.targetNode.localNodeId,
          evidenceKind: proposal.targetNode.kind,
          relationType: proposal.relationType,
        },
        protocolVersion: "trust-node-fixture-2.0",
        assessorType: "agent",
        assessorId: "source-node-agent",
        assessedAt: "2026-02-01T01:01:01.000Z",
        criteria: {},
        evidence: { pointer: rawSourceSentinel },
        reviewStatus: "agent-proposed",
      }),
      sourceReviewStatus: "agent-proposed",
      sourceAssessorType: "agent",
      sourceAssessorId: "source-node-agent",
      sourceAssessedAt: new Date("2026-02-01T01:01:01.000Z"),
      sourceEvidenceJson: JSON.stringify({ pointer: rawSourceSentinel }),
    },
  });
  const sourceAssessment = await prisma.trustAssessment.findFirst({ orderBy: { id: "asc" } });
  if (!sourceAssessment) throw new Error("Seed data did not expose claim-citation TRUST.");
  await prisma.trustAssessment.deleteMany({
    where: { id: { startsWith: paginationAssessmentPrefix } },
  });
  const {
    id: sourceId,
    createdAt: sourceCreatedAt,
    updatedAt: sourceUpdatedAt,
    ...sourceData
  } = sourceAssessment;
  void sourceId;
  void sourceCreatedAt;
  void sourceUpdatedAt;
  await prisma.trustAssessment.createMany({
    data: Array.from({ length: 26 }, (_, index) => ({
      ...sourceData,
      id: `${paginationAssessmentPrefix}${String(index).padStart(2, "0")}`,
      sourceRecordHash: `${paginationAssessmentPrefix}hash-${String(index).padStart(2, "0")}`,
      sourceLineageKey: `${paginationAssessmentPrefix}lineage-${String(index).padStart(2, "0")}`,
      supersedesAssessmentId: null,
    })),
  });
});

test.afterAll(async () => {
  await getPrisma().nodeRelationTrustAssessment.deleteMany({
    where: { id: nodeAssessmentId },
  });
  await getPrisma().trustAssessment.deleteMany({
    where: { id: { startsWith: paginationAssessmentPrefix } },
  });
});

test("editor sees exact assessor, protocol, date, evidence, and source provenance in both TRUST queues", async ({
  page,
  context,
}, testInfo) => {
  const prisma = getPrisma();
  const editor = await prisma.user.findUnique({ where: { githubLogin: "atlas-editor" } });
  if (!editor) throw new Error("Seed data did not expose the editor fixture.");
  const citationAssessment = await prisma.trustAssessment.findFirst({
    where: { assessorId: { not: null } },
    orderBy: [{ assessedAt: "asc" }, { id: "asc" }],
  });
  if (!citationAssessment) throw new Error("Seed data did not expose claim-citation TRUST.");

  await context.addCookies([
    {
      name: "oratlas_session",
      value: createSessionToken(editor.id, "e2e-session-secret"),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/editorial?trustFilter=all");
  const totalAssessments =
    (await prisma.trustAssessment.count()) + (await prisma.nodeRelationTrustAssessment.count());
  await expect(
    page.getByRole("heading", { name: `TRUST provenance queue (${totalAssessments})` }),
  ).toBeVisible();

  const citation = page.getByRole("region", {
    name: `Claim-citation TRUST assessment ${citationAssessment.id}`,
  });
  await expect(citation).toBeVisible();
  await expect(citation).toContainText(citationAssessment.assessorId!);
  await expect(citation).toContainText(citationAssessment.protocolVersion);
  await expect(citation).toContainText(citationAssessment.assessedAt!.toISOString());
  await expect(citation).toContainText("Protocol identifierTRUST");
  await expect(citation).toContainText("Repository relation assertion");
  await expect(citation.getByRole("row", { name: /Aggregate/i })).toHaveCount(0);

  const node = page.getByRole("region", {
    name: `Node-relation TRUST assessment ${nodeAssessmentId}`,
  });
  await expect(node).toBeVisible();
  await expect(node).toContainText("primary-node-assessor");
  await expect(node).toContainText("source-node-agent");
  await expect(node).toContainText("trust-node-fixture-2.0");
  await expect(node).toContainText("2026-02-02T02:02:02.000Z");
  await expect(node).toContainText("Evidence pointersuppliedsupplied");
  await expect(node).toContainText("agent-proposed");
  await expect(node).toContainText("not applicable to node-relation records");
  await expect(node.getByRole("row", { name: /Aggregate/i })).toHaveCount(0);
  await expect(page.getByText(rawSourceSentinel)).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page })
    .include(`[aria-label="Node-relation TRUST assessment ${nodeAssessmentId}"]`)
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("trust-editorial-provenance.png"),
    fullPage: true,
  });

  const pagination = page.getByRole("navigation", { name: "TRUST queue pagination" });
  await expect(pagination.getByRole("link", { name: "Next" })).toBeVisible();
  await pagination.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/trustPage=2/);
  await expect(
    page.getByRole("navigation", { name: "TRUST queue pagination" }).getByRole("link", {
      name: "Previous",
    }),
  ).toBeVisible();
  await expect(page.getByText(new RegExp(`Showing 26.*of ${totalAssessments}`))).toBeVisible();
});
