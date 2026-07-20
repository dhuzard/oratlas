import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SYNTHESIS_PUBLIC_AI_LABEL, SYNTHESIS_PUBLIC_SCOPE_NOTICE } from "@oratlas/contracts";

test("editor gates generated, rejected, and accepted synthesis drafts", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(page).toHaveURL(/\/editorial/);

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const node = await prisma.knowledgeNode.findFirstOrThrow({
    where: { localNodeId: "replay-boundary-claim", versions: { some: {} } },
    orderBy: { id: "asc" },
    include: {
      versions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });
  const opposingNode = await prisma.knowledgeNode.findFirstOrThrow({
    where: { localNodeId: "replay-consolidation-claim", versions: { some: {} } },
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
    citations: Array<{ href?: string; nodeId: string; nodeVersionId: string; title: string }>;
    provenance: { packetHash: string; model: string };
  };
  expect(draft.citations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ nodeId: node.id, nodeVersionId: node.versions[0]!.id }),
      expect.objectContaining({
        nodeId: opposingNode.id,
        nodeVersionId: opposingNode.versions[0]!.id,
      }),
    ]),
  );
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
  await expect(page.getByRole("navigation", { name: "In this synthesis" })).toBeVisible();
  const disclosure = page.getByRole("complementary", {
    name: "Article navigation and disclosure",
  });
  await expect(disclosure).toContainText(draft.provenance.model);
  await expect(disclosure).toContainText(draft.provenance.packetHash);
  const contradictionSection = page.locator("#contradictions-and-open-questions").locator("..");
  await expect(contradictionSection.getByRole("note", { name: "Disputed evidence" })).toBeVisible();
  await expect(contradictionSection.locator("p.synthesis-paragraph")).not.toHaveCount(0);

  const inlineCitation = page.locator("a.synthesis-inline-citation-link").first();
  const inlineHref = await inlineCitation.getAttribute("href");
  expect(
    draft.citations.some(
      (citation) => inlineHref === `/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`,
    ),
  ).toBe(true);
  await inlineCitation.click();
  await expect(page).toHaveURL(new RegExp(`${inlineHref!}$`));
  await page.goto(`/reviews/${slug}`);

  const firstCitation = page.locator("details.synthesis-citation").first();
  await firstCitation.locator("summary").click();
  const evidenceLink = firstCitation.getByRole("link", { name: "Open exact evidence node" });
  const evidenceHref = await evidenceLink.getAttribute("href");
  expect(
    draft.citations.some(
      (citation) => evidenceHref === `/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`,
    ),
  ).toBe(true);
  expect(evidenceHref).toBeTruthy();
  await expect(firstCitation.getByText(/TRUST is relation-scoped context/i)).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(disclosure).toBeVisible();
  await evidenceLink.click();
  await expect(page).toHaveURL(new RegExp(`${evidenceHref!}$`));
  await page.goto(`/reviews/${slug}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const persistentMobileDisclosure = page.getByLabel("Persistent AI disclosure");
  await expect(persistentMobileDisclosure).toBeVisible();
  await expect(persistentMobileDisclosure).toContainText(draft.provenance.packetHash);
  await expect(persistentMobileDisclosure).toContainText(SYNTHESIS_PUBLIC_SCOPE_NOTICE);
  await expect(persistentMobileDisclosure).toContainText(/disclosed software agent/i);
  await expect(persistentMobileDisclosure).toContainText(
    /accountable for the publication decision/i,
  );
  expect(
    await persistentMobileDisclosure.evaluate((element) => getComputedStyle(element).position),
  ).toBe("sticky");
  const mobileCitation = page.locator("details.synthesis-citation").first();
  await mobileCitation.locator("summary").click();
  const mobilePanel = mobileCitation.locator(".synthesis-citation-panel");
  await expect(mobilePanel).toBeVisible();
  const panelBounds = await mobilePanel.boundingBox();
  expect(panelBounds).not.toBeNull();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("/archive?contentType=synthesis");
  await expect(page.getByText(draft.document.title, { exact: true })).toBeVisible();
  await expect(page.getByText("freshness unchecked", { exact: true })).toBeVisible();
  await page.goto("/archive?contentType=review");
  await expect(page.getByText(draft.document.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Hippocampal Replay/).first()).toBeVisible();
  await page.goto("/archive?contentType=node");
  await expect(page.getByText(draft.document.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(node.versions[0]!.title, { exact: true }).first()).toBeVisible();
  await page.goto("/coverage");
  await expect(page.getByRole("heading", { name: "Topic coverage" })).toBeVisible();
  await expect(page.getByText(node.versions[0]!.title, { exact: true })).toHaveCount(0);

  await page.goto("/editorial");
  const freshScanResponse = page.waitForResponse((response) =>
    response.url().includes("/api/editorial/syntheses/staleness/scan"),
  );
  await page.getByRole("button", { name: "Scan accepted syntheses" }).click();
  expect((await freshScanResponse).ok()).toBeTruthy();
  await page.goto(`/reviews/${slug}`);
  await expect(page.getByText("Freshness checked")).toBeVisible();
  await page.goto("/archive?contentType=synthesis");
  await expect(page.getByText("up to date", { exact: true })).toBeVisible();

  const priorVersion = node.versions[0]!;
  const snapshotId = `e2e-synthesis-stale-${Date.now()}`;
  const versionId = `${snapshotId}-version`;
  const commitSha = "d".repeat(40);
  const editor = await prisma.user.findFirstOrThrow({ where: { role: "EDITOR" } });
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
  const sourceSubmission = await prisma.submission.create({
    data: {
      submitterId: editor.id,
      reviewerId: editor.id,
      repositoryId: node.repositoryId,
      snapshotId,
      status: "accepted",
      acceptedNodeSelectionJson: JSON.stringify([node.localNodeId]),
      submittedAt: new Date(),
      reviewedAt: new Date(),
    },
  });
  const provenance = JSON.parse(priorVersion.provenanceJson) as Record<string, unknown>;
  await prisma.knowledgeNodeVersion.create({
    data: {
      id: versionId,
      knowledgeNodeId: node.id,
      snapshotId,
      sourceSubmissionId: sourceSubmission.id,
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

  await page.goto("/coverage");
  const uncoveredVersion = page.getByRole("link", {
    name: `${priorVersion.title} — newer evidence`,
  });
  await expect(uncoveredVersion).toBeVisible();
  const generationLink = page
    .locator("article")
    .filter({ has: uncoveredVersion })
    .getByRole("link", { name: "Start an editor-gated synthesis from this node →" });
  await expect(generationLink).toBeVisible();
  await generationLink.click();
  await expect(page.getByLabel("Seed node ID")).toHaveValue(node.id);

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
  await page.goto("/archive?contentType=synthesis");
  const staleSynthesis = page.locator("article.card").filter({ hasText: draft.document.title });
  await expect(staleSynthesis.getByText(/^stale · \d+ affected reference/)).toBeVisible();

  await prisma.knowledgeNodeVersion.delete({ where: { id: versionId } });
  await prisma.repositorySnapshot.delete({ where: { id: snapshotId } });
  await page.goto("/coverage");
  await expect(page.getByText(priorVersion.title, { exact: true })).toHaveCount(0);
  const citation = draft.citations[0];
  expect(citation).toBeTruthy();
  const citationHref = `/nodes/${citation!.nodeId}/versions/${citation!.nodeVersionId}`;
  await page.goto(`/reviews/${slug}`);
  const citationLink = page
    .locator("#grounding-citations")
    .locator(`a[href="${citationHref}"]`)
    .first();
  await expect(citationLink).toBeVisible();
  await citationLink.click();
  await expect(page).toHaveURL(new RegExp(`${citationHref.replaceAll("/", "\\/")}$`));
});
