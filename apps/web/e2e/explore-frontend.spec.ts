import AxeBuilder from "@axe-core/playwright";
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

test("Explore has one intent entry, preserves scope, and recovers from no matches", async ({
  page,
}) => {
  const parameters = new URLSearchParams({
    q: "no-match-oratlas-unique-topic",
    reviewSlug: "missing-review",
    claimType: "empirical",
    relationType: "supports",
    trustCriterion: "entailment",
  });
  parameters.append("known", "known-node-one");
  parameters.append("known", "known-node-two");
  parameters.append("interest", "data-code");
  await page.goto(`/explore?${parameters}`);
  await expect(page.locator('input[type="search"][name="q"]')).toHaveCount(1);
  await expect(page.getByLabel("Topic or question")).toHaveValue(parameters.get("q")!);
  const empty = page.getByRole("region", { name: "Guided knowledge landscape" });
  await expect(empty).toContainText("Showing 0 matching claims");
  await page.getByRole("button", { name: "Show my knowledge path" }).click();
  const submitted = new URL(page.url()).searchParams;
  for (const [key, value] of parameters) expect(submitted.getAll(key)).toContain(value);
  await empty.getByRole("link", { name: "Clear refinements" }).click();
  const cleared = new URL(page.url()).searchParams;
  expect(cleared.get("q")).toBe(parameters.get("q"));
  expect(cleared.getAll("known")).toEqual(parameters.getAll("known"));
  expect(cleared.getAll("interest")).toEqual(["data-code"]);
  for (const key of ["reviewSlug", "claimType", "relationType", "trustCriterion"])
    expect(cleared.has(key)).toBe(false);
  await empty.getByRole("link", { name: /Try the topic/ }).click();
  await expect(page.getByLabel("Topic or question")).toHaveValue("replay");
  await expect(page.locator(".landscape-primary-link").first()).toBeVisible();
});

test("scoped Explore exposes keyboard graph and readable connections without serious axe failures", async ({
  page,
}) => {
  await page.goto("/explore?q=replay");
  const landscape = page.getByRole("region", { name: "Guided knowledge landscape" });
  const svgLink = landscape.locator('svg a[href*="focus="]').first();
  await svgLink.focus();
  await expect(svgLink).toBeFocused();
  const href = await svgLink.getAttribute("href");
  expect(href).toContain("focus=");
  await svgLink.press("Enter");
  await expect(page).toHaveURL(href!);
  await expect(landscape.getByRole("heading", { level: 2 })).toContainText("One step from");
  const focusedParameters = new URL(page.url()).searchParams;
  await page.getByRole("button", { name: "Show my knowledge path" }).click();
  expect(new URL(page.url()).searchParams.get("focus")).toBe(focusedParameters.get("focus"));
  const overview = landscape.getByRole("link", { name: "Return to overview" });
  await overview.focus();
  await expect(overview).toBeFocused();
  await overview.press("Enter");
  await expect(page).toHaveURL(/q=replay$/);
  const listLink = landscape.getByRole("link", {
    name: "Read the same nodes and connections as a list",
  });
  await listLink.focus();
  await listLink.press("Enter");
  await expect(
    landscape.getByRole("navigation", { name: "Knowledge landscape details" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(landscape.locator(".landscape-primary-link").first()).toBeFocused();
  await expect(landscape.getByRole("heading", { name: "Connections in this path" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
  // A 1440×900 browser at 200% zoom has a 720×450 CSS viewport.
  // CSS `zoom` does not update media queries and is not browser zoom.
  await page.setViewportSize({ width: 720, height: 450 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel("Topic or question")).toBeVisible();
});
