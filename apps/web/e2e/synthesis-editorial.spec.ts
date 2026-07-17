import { expect, test } from "@playwright/test";
import { SYNTHESIS_PUBLIC_AI_LABEL, SYNTHESIS_PUBLIC_SCOPE_NOTICE } from "@oratlas/contracts";

test("editor gates generated, rejected, and accepted synthesis drafts", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(page).toHaveURL(/\/editorial/);

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const node = await prisma.knowledgeNode.findFirstOrThrow({
    where: { kind: "figure", versions: { some: {} } },
    orderBy: { id: "asc" },
    include: {
      versions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });
  await page.getByLabel("Seed node ID").fill(node.id);
  const generationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/generate") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Generate synthesis" }).click();
  const generated = await generationResponse;
  expect(generated.ok(), await generated.text()).toBeTruthy();
  const draft = (await generated.json()) as {
    id: string;
    seriesKey: string;
    document: { title: string };
    citations: Array<{ href?: string; nodeId: string; nodeVersionId: string }>;
  };
  const slug = `synthesis-${draft.seriesKey.slice(0, 20)}`;
  expect((await page.request.get(`/api/syntheses/${slug}`)).status()).toBe(404);
  expect((await page.request.get(`/reviews/${slug}`)).status()).toBe(404);
  await page.goto("/archive");
  await expect(page.getByText(draft.document.title, { exact: true })).toHaveCount(0);

  await page.goto("/editorial");
  await page.getByLabel("Seed node ID").fill(node.id);
  const rejectedGenerationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/generate") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Generate synthesis" }).click();
  const rejectedGeneration = await rejectedGenerationResponse;
  expect(rejectedGeneration.ok(), await rejectedGeneration.text()).toBeTruthy();
  const rejectedDraft = (await rejectedGeneration.json()) as { id: string };

  await page.reload();
  const rejectedCard = page.locator(`article[data-draft-id="${rejectedDraft.id}"]`);
  const rejectionResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/editorial/syntheses/${rejectedDraft.id}/decision`),
  );
  await rejectedCard
    .getByLabel("Editorial rationale")
    .fill("The draft requires a different editorial outcome before it can be published.");
  await rejectedCard.getByRole("button", { name: "Reject" }).click();
  const rejected = await rejectionResponse;
  expect(rejected.ok(), await rejected.text()).toBeTruthy();
  expect((await page.request.get(`/api/syntheses/${slug}`)).status()).toBe(404);
  expect((await page.request.get(`/reviews/${slug}`)).status()).toBe(404);

  const card = page.locator(`article[data-draft-id="${draft.id}"]`);
  await expect(card).toContainText("pending");
  for (const sectionTitle of [
    "Background",
    "State of knowledge",
    "Agreements",
    "Contradictions and open questions",
    "Data and code availability",
    "Limitations",
  ]) {
    await expect(card.getByRole("heading", { name: sectionTitle, exact: true })).toBeVisible();
  }
  const acceptButton = card.getByRole("button", { name: "Accept and publish" });
  await expect(acceptButton).toBeDisabled();
  for (const checkbox of await card.getByRole("checkbox").all()) await checkbox.check();
  await card.getByLabel("SPDX license expression").fill("CC-BY-4.0");
  await card
    .getByLabel("Rights statement")
    .fill("The editor confirms publication rights for this grounded synthesis.");
  await card
    .getByLabel("Editorial rationale")
    .fill("The editor reviewed the complete immutable draft and all required publication checks.");
  await expect(acceptButton).toBeEnabled();
  const decisionResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/") && response.url().endsWith("/decision"),
  );
  await acceptButton.click();
  const accepted = await decisionResponse;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const result = (await accepted.json()) as { reviewSlug: string };

  expect(result.reviewSlug).toBe(slug);
  await page.goto(`/reviews/${slug}`);
  await expect(page.getByText(SYNTHESIS_PUBLIC_AI_LABEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(SYNTHESIS_PUBLIC_SCOPE_NOTICE, { exact: true })).toBeVisible();
  await expect(page.getByText("Freshness not yet checked")).toBeVisible();

  await page.goto("/editorial");
  const freshScanResponse = page.waitForResponse((response) =>
    response.url().includes("/api/editorial/syntheses/staleness/scan"),
  );
  await page.getByRole("button", { name: "Scan accepted syntheses" }).click();
  expect((await freshScanResponse).ok()).toBeTruthy();
  await page.goto(`/reviews/${slug}`);
  await expect(page.getByText("Freshness checked")).toBeVisible();

  const priorVersion = node.versions[0]!;
  const snapshotId = `e2e-synthesis-stale-${Date.now()}`;
  const versionId = `${snapshotId}-version`;
  const commitSha = "d".repeat(40);
  await prisma.repositorySnapshot.create({
    data: {
      id: snapshotId,
      repositoryId: node.repositoryId,
      commitSha,
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: "e".repeat(64),
    },
  });
  const provenance = JSON.parse(priorVersion.provenanceJson) as Record<string, unknown>;
  await prisma.knowledgeNodeVersion.create({
    data: {
      id: versionId,
      knowledgeNodeId: node.id,
      snapshotId,
      title: `${priorVersion.title} — newer evidence`,
      abstract: priorVersion.abstract,
      text: priorVersion.text,
      contributorsJson: priorVersion.contributorsJson,
      license: priorVersion.license,
      provenanceJson: JSON.stringify({ ...provenance, commitSha }),
      payloadJson: priorVersion.payloadJson,
      isExample: priorVersion.isExample,
      createdAt: new Date(Date.now() + 1_000),
    },
  });

  await page.goto("/editorial");
  const staleScanResponse = page.waitForResponse((response) =>
    response.url().includes("/api/editorial/syntheses/staleness/scan"),
  );
  await page.getByRole("button", { name: "Scan accepted syntheses" }).click();
  expect((await staleScanResponse).ok()).toBeTruthy();
  await page.reload();
  const proposal = page.locator("article[data-staleness-proposal]").filter({
    hasText: "node-head-changed",
  });
  await expect(proposal).toBeVisible();
  const proposalDecisionResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/staleness/") &&
      response.url().endsWith("/decision"),
  );
  await proposal.getByRole("button", { name: "Request private regeneration" }).click();
  expect((await proposalDecisionResponse).ok()).toBeTruthy();
  await page.goto(`/reviews/${slug}`);
  await expect(page.getByText("Newer evidence exists")).toBeVisible();

  await prisma.knowledgeNodeVersion.delete({ where: { id: versionId } });
  await prisma.repositorySnapshot.delete({ where: { id: snapshotId } });
  const citation = draft.citations[0];
  expect(citation).toBeTruthy();
  const citationHref = `/nodes/${citation!.nodeId}/versions/${citation!.nodeVersionId}`;
  const citationLink = page.locator(`a[href="${citationHref}"]`).first();
  await expect(citationLink).toBeVisible();
  await citationLink.click();
  await expect(page).toHaveURL(new RegExp(`${citationHref.replaceAll("/", "\\/")}$`));
});
