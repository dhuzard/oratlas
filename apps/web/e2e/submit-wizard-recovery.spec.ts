import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers/auth";

test("inspection failures keep source selection available for recovery", async ({ page }) => {
  await signInAs(page, "submitter");
  await page.goto("/submit");
  const source = page.getByLabel("Public GitHub repository URL");

  await source.fill("https://example.org/not-a-github-repository");
  const unsupportedResponse = page.waitForResponse(
    (response) => response.url().includes("/api/inspect") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inspect repository" }).click();
  expect((await unsupportedResponse).status()).toBe(400);
  await expect(page.locator(".notice-error[role=alert]")).toBeVisible();
  await expect(source).toHaveValue("https://example.org/not-a-github-repository");

  await page.route("**/api/inspect", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "rate-limited",
          message: "Too many inspection requests. Try again shortly.",
        },
      }),
    }),
  );
  await source.fill("https://github.com/e2e-lab/recovery-fixture");
  await page.getByRole("button", { name: "Inspect repository" }).click();
  await expect(page.locator(".notice-error[role=alert]")).toContainText(
    "Too many inspection requests",
  );
  await expect(source).toHaveValue("https://github.com/e2e-lab/recovery-fixture");

  await page.unroute("**/api/inspect");
  await page.route("**/api/inspect", (route) => route.abort());
  await page.getByRole("button", { name: "Inspect repository" }).click();
  await expect(page.locator(".notice-error[role=alert]")).toContainText(
    "Network error during inspection.",
  );
  await expect(source).toHaveValue("https://github.com/e2e-lab/recovery-fixture");
});
