import { expect, test } from "@playwright/test";

test("primary tasks and public API discovery stay reachable", async ({ page }) => {
  await page.goto("/");

  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary.getByRole("link", { name: "Find claims" })).toHaveAttribute(
    "href",
    "/explore",
  );
  await expect(primary.getByRole("link", { name: "Compare" })).toHaveAttribute("href", "/compare");
  await expect(primary.getByRole("link", { name: "Sources" })).toHaveAttribute(
    "href",
    "/publications",
  );
  await expect(
    page.getByRole("navigation", { name: "Utilities" }).getByRole("link", {
      name: "API & agents",
    }),
  ).toHaveAttribute("href", "/api-docs");

  await page.goto("/api-docs");
  await expect(page.getByRole("heading", { level: 1, name: "API & agents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAPI YAML" })).toHaveAttribute(
    "href",
    "/openapi.yaml",
  );
  await expect(page.getByRole("link", { name: "agent access guide" })).toHaveAttribute(
    "href",
    "/api-docs/agents",
  );
});

test("Sources tabs preserve the existing publication, archive, and research-object routes", async ({
  page,
}) => {
  await page.goto("/publications");
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  const collections = page.getByRole("navigation", { name: "Source collections" });
  await expect(collections.getByRole("link", { name: "Registered publications" })).toHaveAttribute(
    "href",
    "/publications",
  );
  await expect(collections.getByRole("link", { name: "Registered publications" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(collections.getByRole("link", { name: "Archived reviews" })).toHaveAttribute(
    "href",
    "/archive",
  );
  await expect(collections.getByRole("link", { name: "Research objects" })).toHaveAttribute(
    "href",
    "/nodes",
  );

  await collections.getByRole("link", { name: "Archived reviews" }).click();
  await expect(page).toHaveURL(/\/archive$/, { timeout: 30_000 });
  await expect(
    page.getByRole("navigation", { name: "Source collections" }).getByRole("link", {
      name: "Archived reviews",
    }),
  ).toHaveAttribute("aria-current", "page");

  await page
    .getByRole("navigation", { name: "Source collections" })
    .getByRole("link", {
      name: "Research objects",
    })
    .click();
  await expect(page).toHaveURL(/\/nodes$/, { timeout: 30_000 });
  await expect(
    page.getByRole("navigation", { name: "Source collections" }).getByRole("link", {
      name: "Research objects",
    }),
  ).toHaveAttribute("aria-current", "page");
});

test("Sources keeps the supported source handoffs explicit", async ({ page }) => {
  await page.goto("/publications");
  await expect(page.getByRole("heading", { name: "Add a supported public source" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Inspect and deposit a repository" }),
  ).toHaveAttribute("href", "/submit");
  await expect(page.getByRole("link", { name: "Prepare a MyST publication" })).toHaveAttribute(
    "href",
    "/connect",
  );
});
