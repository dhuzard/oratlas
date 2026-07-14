import { test, expect } from "@playwright/test";

test.describe("Editorial workflow (mock auth)", () => {
  test("submitter mock sign-in reaches the submission wizard", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as submitter/ }).click();
    await expect(page).toHaveURL(/\/submit/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Submit a computational review",
    );
  });

  test("editor can sign in and see the editorial dashboard with audit log", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as editor/ }).click();
    await expect(page).toHaveURL(/\/editorial/);
    await expect(page.getByRole("heading", { name: "Editorial dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  });

  test("editor accepts a pending submission and it appears in the archive", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as editor/ }).click();
    await expect(page).toHaveURL(/\/editorial/);

    const pending = page.getByText(/spike-sorting-methods-review/).first();
    await expect(pending).toBeVisible();

    // Wait for the client component to hydrate before clicking (the decision
    // handler is client-side fetch, unlike the server-action sign-in form).
    await page.waitForLoadState("networkidle");
    const acceptButton = page.getByRole("button", { name: /^Accept$/ }).first();
    await expect(acceptButton).toBeEnabled();
    // Assert the durable outcome: the decision POST succeeds and the review
    // becomes visible in the public archive.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/editorial/decision") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      acceptButton.click(),
    ]);
    expect(response.ok()).toBeTruthy();

    await page.goto("/archive");
    await expect(page.getByText(/Spike-Sorting Methods/i).first()).toBeVisible();
  });
});
