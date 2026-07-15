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
