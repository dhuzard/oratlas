import { expect, test } from "@playwright/test";

test("public navigation exposes semantic API and agent documentation", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", {
      name: "API & agents",
    })
    .click();

  await expect(page).toHaveURL(/\/api-docs$/);
  await expect(page.getByRole("heading", { level: 1, name: "API & agents" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Quick start" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAPI YAML" })).toHaveAttribute(
    "href",
    "/openapi.yaml",
  );
  await expect(page.getByRole("link", { name: "agent access guide" })).toHaveAttribute(
    "href",
    "/api-docs/agents",
  );
});
