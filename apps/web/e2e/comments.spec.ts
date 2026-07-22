import { test, expect } from "@playwright/test";

const REVIEW = "/reviews/hippocampal-replay-computational-review";

test.describe("Open discussion", () => {
  test("shows seeded comments and the threaded exchange to anonymous readers", async ({ page }) => {
    await page.goto(REVIEW);
    const section = page.locator('[data-register="open-discussion"]');
    await expect(section.getByRole("heading", { name: /Open discussion/ })).toBeVisible();
    await expect(section).toContainText(/not TRUST assessments/i);
    // A seeded question and its editor reply are both rendered.
    await expect(section.getByText(/Does the replay-consolidation link hold/i)).toBeVisible();
    await expect(section.getByText(/Girardeau et al\. \(2009\)/i)).toBeVisible();
    // Anonymous readers are prompted to sign in rather than shown a form.
    await expect(section.getByRole("link", { name: /Sign in/ })).toBeVisible();

    const sentinel = "Does the replay-consolidation link hold";
    await expect(
      page.locator('[data-register="formal-assessment"]', { hasText: sentinel }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-register="formal-challenge"]', { hasText: sentinel }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-register="formal-editorial"]', { hasText: sentinel }),
    ).toHaveCount(0);
  });

  test("a signed-in user can post a comment that persists", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as submitter/ }).click();
    await expect(page).toHaveURL(/\/submit/);

    await page.goto(REVIEW);
    await page.waitForLoadState("networkidle");

    const body = `Reproducibility question ${Date.now()}`;
    const field = page.getByLabel("Your comment");
    await expect(async () => {
      await field.fill(body);
      await expect(page.getByRole("button", { name: /^Post comment$/ })).toBeEnabled({
        timeout: 1000,
      });
    }).toPass({ timeout: 30_000 });

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/comments") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: /^Post comment$/ }).click(),
    ]);
    expect(response.ok()).toBeTruthy();

    // The durable outcome: the comment is rendered after the server refresh…
    await expect(page.locator("#community-review").getByText(body)).toBeVisible();
    // …and survives a full reload (it was persisted, not just optimistic state).
    await page.reload();
    await expect(page.locator("#community-review").getByText(body)).toBeVisible();
  });
});
