import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`Explore landscape stays contained and readable on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const nodesResponse = await page.request.get("/api/nodes?kind=claim&pageSize=1");
    expect(nodesResponse.ok()).toBe(true);
    const nodes = (await nodesResponse.json()) as { items: Array<{ id: string }> };
    expect(nodes.items[0]?.id).toBeTruthy();
    await page.goto(`/explore?focus=${encodeURIComponent(nodes.items[0]!.id)}`);

    const landscape = page.getByRole("region", { name: "Guided knowledge landscape" });
    await expect(landscape).toBeVisible();
    await expect(
      landscape.getByRole("navigation", { name: "Knowledge landscape details" }),
    ).toBeVisible();

    const labels = await landscape.locator(".landscape-primary-link").allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => !label.trimStart().startsWith("{"))).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const bounds = await landscape.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    const visualBounds = await landscape.locator(".knowledge-landscape-visual").boundingBox();
    const focusedBounds = await landscape.locator(".landscape-node-focused").boundingBox();
    expect(visualBounds).not.toBeNull();
    expect(focusedBounds).not.toBeNull();
    expect(focusedBounds!.x).toBeGreaterThanOrEqual(visualBounds!.x);
    expect(focusedBounds!.x + focusedBounds!.width).toBeLessThanOrEqual(
      visualBounds!.x + visualBounds!.width + 1,
    );
    if (process.env.ORATLAS_CAPTURE_SCREENSHOTS === "1") {
      await page.screenshot({
        path: testInfo.outputPath(`explore-${viewport.name}.png`),
        fullPage: true,
      });
    }
  });
}

test("focusing a preserved review keeps the human landscape within its claim contract", async ({
  page,
}) => {
  const nodesResponse = await page.request.get("/api/nodes?kind=review&pageSize=1");
  expect(nodesResponse.ok()).toBe(true);
  const nodes = (await nodesResponse.json()) as { items: Array<{ id: string }> };
  test.skip(!nodes.items[0]?.id, "The active fixture has no canonical review node");
  await page.goto(`/explore?focus=${encodeURIComponent(nodes.items[0]!.id)}`);
  const landscape = page.getByRole("region", { name: "Guided knowledge landscape" });
  await expect(page).toHaveURL(/focus=/);
  await expect(page.getByText(/Application error/i)).toHaveCount(0);
  await expect(landscape.getByRole("heading", { level: 2 })).toContainText("One step from");
  expect(
    await landscape.locator('section[aria-labelledby="landscape-claim-title"] > ul > li').count(),
  ).toBeLessThanOrEqual(6);
});
