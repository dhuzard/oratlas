import { test, expect } from "@playwright/test";

test.describe("Public archive browsing", () => {
  test("home page lists recently accepted reviews", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "The arXiv for AI-generated scientific reviews",
    );
    const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNavigation.getByRole("link", { name: "Explore" })).toHaveAttribute(
      "href",
      "/explore",
    );
    await expect(primaryNavigation.getByRole("link", { name: "Submit a review" })).toBeVisible();
    await expect(primaryNavigation.getByRole("link", { name: "How it works" })).toBeVisible();
    await expect(primaryNavigation.getByRole("link", { name: "Graph" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Hippocampal Replay/ }).first()).toBeVisible();
  });

  test("unified Explore defaults to claims and switches to reviews", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Claims and scientific reviews",
    );
    const contentNavigation = page.getByRole("navigation", { name: "Explore content" });
    await expect(contentNavigation.getByRole("link", { name: /Claims/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".explore-result").first()).toBeVisible();

    await contentNavigation.getByRole("link", { name: /Reviews/ }).click();
    await expect(page).toHaveURL(/\/explore\?view=reviews/);
    await expect(contentNavigation.getByRole("link", { name: /Reviews/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: /Hippocampal Replay/ }).first()).toBeVisible();
  });

  test("unified Explore safely handles malformed public query parameters", async ({ page }) => {
    await page.goto("/explore?page=abc");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Claims and scientific reviews",
    );
    await expect(page.getByText("Page NaN")).toHaveCount(0);

    await page.goto("/explore?view=reviews&page=abc&sort=unexpected");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Claims and scientific reviews",
    );
    await expect(page.locator("#sort")).toHaveValue("accepted");
  });

  test("archive filters to repository-only reviews", async ({ page }) => {
    await page.goto("/archive?hasDoi=false");
    await expect(page.getByText(/repository-only/i).first()).toBeVisible();
  });

  test("review page shows repository, commit, DOI distinction, claims and TRUST", async ({
    page,
  }) => {
    await page.goto("/reviews/hippocampal-replay-computational-review");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hippocampal Replay");
    const inspectionPath = page.getByRole("navigation", { name: "Inspect this review" });
    await expect(inspectionPath.getByRole("link", { name: /Original record/ })).toHaveAttribute(
      "href",
      "#original-record",
    );
    await expect(inspectionPath.getByRole("link", { name: /Claims & evidence/ })).toHaveAttribute(
      "href",
      "#linked-evidence",
    );
    await expect(inspectionPath.getByRole("link", { name: /Assessments/ })).toHaveAttribute(
      "href",
      "#assessments",
    );
    await expect(inspectionPath.getByRole("link", { name: /Disagreements/ })).toHaveAttribute(
      "href",
      "#disagreements",
    );
    // Version DOI and concept DOI are distinct rows (exact: these are <dt>
    // labels, and page prose such as comments may mention the same phrase).
    await expect(page.getByText("Version DOI", { exact: true })).toBeVisible();
    await expect(page.getByText("Concept DOI", { exact: true })).toBeVisible();
    // Example DOI is marked non-resolvable.
    await expect(page.getByText(/example — not resolvable/i).first()).toBeVisible();
    // A contradicting relation is present.
    await expect(page.getByText(/contradicts/i).first()).toBeVisible();
    // TRUST assessment is available.
    await expect(page.getByText(/TRUST assessment/i).first()).toBeVisible();
    await page.locator("details").evaluateAll((details) => {
      for (const detail of details) detail.open = true;
    });
    await expect(
      page
        .locator('[data-prov="human-reviewed"]:visible')
        .filter({ hasText: "Atlas structurally verified" })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-prov="repository-fact"]:visible')
        .filter({ hasText: "Repository/source-native — not verified by Atlas" })
        .first(),
    ).toBeVisible();
  });

  test("claim explorer finds a contradicting claim", async ({ page }) => {
    await page.goto("/claims?relationType=contradicts");
    await expect(page.getByText(/contradicting/i).first()).toBeVisible();
  });
});
