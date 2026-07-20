import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

/**
 * Automated WCAG coverage (issue #7). Each key public surface is scanned with
 * axe-core against the WCAG 2.1 A/AA rule set. The gate is serious and
 * critical violations — these are the machine-detectable failures (contrast,
 * names/roles, landmarks, form labels). Manual review still covers what axe
 * cannot, but this keeps regressions from shipping silently.
 */
const PAGES: Array<{ name: string; path: string }> = [
  { name: "home", path: "/" },
  { name: "archive", path: "/archive" },
  { name: "review", path: "/reviews/hippocampal-replay-computational-review" },
  { name: "contradiction map", path: "/synthesis" },
  { name: "replication marketplace", path: "/replications" },
  { name: "claim explorer", path: "/claims" },
  { name: "topic coverage", path: "/coverage" },
];

for (const { name, path } of PAGES) {
  test(`${name} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );

    // Surface a readable summary on failure rather than an opaque count.
    expect(
      blocking,
      blocking
        .map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.length} node(s)]`)
        .join("\n"),
    ).toEqual([]);
  });
}

test("topic coverage supports keyboard navigation at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/coverage");
  const exactNode = page.locator('a[href^="/nodes/"][href*="/versions/"]').first();
  await exactNode.focus();
  await expect(exactNode).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/nodes\/[^/]+\/versions\/[^/]+$/);
});

for (const kind of ["claim", "dataset"] as const) {
  test(`${kind} node page has no serious or critical accessibility violations`, async ({
    page,
    request,
  }) => {
    const response = await request.get(`/api/nodes?kind=${kind}&pageSize=1`);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { items: Array<{ id: string }> };
    expect(body.items[0]?.id).toBeTruthy();
    await page.goto(`/nodes/${body.items[0]!.id}`);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(
      blocking,
      blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
    ).toEqual([]);
  });
}
