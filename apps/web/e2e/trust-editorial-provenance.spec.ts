import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getPrisma } from "@oratlas/db";
import { createSessionToken } from "../src/lib/session-token";

const nodeAssessmentId = "ora-f01-node-assessment";
const rawSourceSentinel = "ORA_F01_RAW_SOURCE_JSON_MUST_NOT_RENDER";

test.beforeAll(async () => {
  const prisma = getPrisma();
  const proposal = await prisma.nodeEdgeProposal.findFirst({ orderBy: { id: "asc" } });
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
      sourceRecordJson: JSON.stringify({ sentinel: rawSourceSentinel }),
      sourceReviewStatus: "agent-proposed",
      sourceAssessorType: "agent",
      sourceAssessorId: "source-node-agent",
      sourceAssessedAt: new Date("2026-02-01T01:01:01.000Z"),
      sourceEvidenceJson: JSON.stringify({ pointer: rawSourceSentinel }),
    },
  });
});

test.afterAll(async () => {
  await getPrisma().nodeRelationTrustAssessment.deleteMany({
    where: { id: nodeAssessmentId },
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

  const citation = page.getByRole("region", {
    name: `Claim-citation TRUST assessment ${citationAssessment.id}`,
  });
  await expect(citation).toBeVisible();
  await expect(citation).toContainText(citationAssessment.assessorId!);
  await expect(citation).toContainText(citationAssessment.protocolVersion);
  await expect(citation).toContainText(citationAssessment.assessedAt!.toISOString());
  await expect(citation).toContainText("Protocol identifierTRUST");
  await expect(citation).toContainText("Repository relation assertion");

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
  await expect(page.getByText(rawSourceSentinel)).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page })
    .include(`[aria-label="Node-relation TRUST assessment ${nodeAssessmentId}"]`)
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("trust-editorial-provenance.png"),
    fullPage: true,
  });
});
