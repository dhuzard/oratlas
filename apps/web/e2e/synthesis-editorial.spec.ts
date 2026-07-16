import { expect, test } from "@playwright/test";

test("editor gates generated, rejected, and accepted synthesis drafts", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as editor/ }).click();
  await expect(page).toHaveURL(/\/editorial/);

  const { getPrisma } = await import("@oratlas/db");
  const prisma = getPrisma();
  const node = await prisma.knowledgeNode.findFirstOrThrow({
    where: { kind: "figure", versions: { some: {} } },
    orderBy: { id: "asc" },
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
  await rejectedCard.getByRole("button", { name: "Reject" }).click();
  const rejected = await rejectionResponse;
  expect(rejected.ok(), await rejected.text()).toBeTruthy();
  expect((await page.request.get(`/api/syntheses/${slug}`)).status()).toBe(404);
  expect((await page.request.get(`/reviews/${slug}`)).status()).toBe(404);

  const card = page.locator(`article[data-draft-id="${draft.id}"]`);
  await expect(card).toContainText("pending");
  const decisionResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/editorial/syntheses/") && response.url().endsWith("/decision"),
  );
  await card.getByRole("button", { name: "Accept and publish" }).click();
  const accepted = await decisionResponse;
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const result = (await accepted.json()) as { reviewSlug: string };

  expect(result.reviewSlug).toBe(slug);
  await page.goto(`/reviews/${slug}`);
  await expect(page.getByText("AI-written synthesis")).toBeVisible();
  await expect(page.getByText("AI-generated, editor-approved")).toBeVisible();
  const citation = draft.citations[0];
  expect(citation).toBeTruthy();
  const citationHref = `/nodes/${citation!.nodeId}/versions/${citation!.nodeVersionId}`;
  const citationLink = page.locator(`a[href="${citationHref}"]`).first();
  await expect(citationLink).toBeVisible();
  await citationLink.click();
  await expect(page).toHaveURL(new RegExp(`${citationHref.replaceAll("/", "\\/")}$`));
});
