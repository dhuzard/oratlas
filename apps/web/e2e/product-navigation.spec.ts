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

test("Find claims collection links wrap within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");
  await expect(page.getByRole("navigation", { name: "Complete scholarly indexes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("public source pilot preserves inspection boundaries and exact upstream context", async ({
  page,
}) => {
  await page.goto("/publications");
  await page.getByText("Three public source examples · read-only pilot", { exact: true }).click();
  await page.getByRole("link", { name: "Inspect the public source pilot" }).click();
  await expect(page).toHaveURL(/\/publications\/pilot$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "What three public source exports expose",
  );
  await expect(page.getByText(/inspection results, not a live inventory/)).toBeVisible();
  await expect(page.getByText(/separately frozen v0.1.0-trust-preview.3/)).toBeVisible();
  for (const [repository, commit] of [
    ["dhuzard/ethical-debt-AI-review", "8170221a6ae90975de3c31540e278f8df96ee524"],
    ["dhuzard/nts-animal-use-review", "b957ced01f0ff80fefcb08e5bebbdfe321383863"],
    ["dhuzard/hcm-circadian-mouse-review", "a906c5f15e77b8a4ac0671c9df15f75b8095029f"],
  ]) {
    await expect(
      page.getByRole("link", { name: `Upstream source context · ${repository}` }),
    ).toHaveAttribute("href", `https://github.com/${repository}/tree/${commit}`);
  }
  await expect(
    page.getByRole("heading", {
      name: "No established cross-source scientific relationship",
    }),
  ).toBeVisible();
  await expect(page.getByText(/not verified identifier ownership/)).toBeVisible();
  await expect(page.locator('a[href^="/compare/claims"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Compare available public claim records" }).click();
  await expect(page.getByText(/A source inspection is not an accepted claim record/)).toBeVisible();
});
