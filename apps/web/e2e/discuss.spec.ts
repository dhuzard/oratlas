import { test, expect, type Page } from "@playwright/test";

/**
 * Fill the question field and wait until the submit button enables. In dev,
 * React may hydrate after Playwright's first fill and reset the controlled
 * input, so we refill until the button reflects the value.
 */
async function askQuestion(page: Page, question: string) {
  const field = page.getByLabel("Your question");
  const button = page.getByRole("button", { name: /Ask Atlas Discuss/ });
  await expect(async () => {
    await field.fill(question);
    await expect(button).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await button.click();
}

test.describe("Atlas Discuss — deterministic mode", () => {
  test("returns a grounded evidence summary without an LLM key", async ({ page }) => {
    await page.goto("/discuss");
    await askQuestion(page, "hippocampal replay memory consolidation");
    await expect(page.getByText(/Deterministic/).first()).toBeVisible();
    await expect(page.getByText(/not independent replication/i)).toBeVisible();
  });

  test("reports insufficient evidence for unrelated questions", async ({ page }) => {
    await page.goto("/discuss");
    await askQuestion(page, "lattice gauge quantum chromodynamics confinement topology");
    await expect(page.getByText(/insufficient|No matching claims/i).first()).toBeVisible();
  });
});
