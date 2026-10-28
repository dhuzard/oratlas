import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public synthetic pair preserves distinct exact references through copy and reopen", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const entry = page.getByRole("link", { name: "Compare two claims · synthetic example" });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toBeVisible({
    timeout: 30_000,
  });
  const original = new URL(page.url());
  const left = original.searchParams.get("left");
  const right = original.searchParams.get("right");
  expect(left).toBeTruthy();
  expect(right).toBeTruthy();
  expect(left).not.toBe(right);
  const sides = page.getByRole("region", { name: /^(First|Second) claim occurrence$/ });
  await expect(sides).toHaveCount(2);
  for (const side of await sides.all()) {
    await expect(side.getByRole("heading", { name: "Declared scope" })).toBeVisible();
    await expect(side.getByRole("heading", { name: "Source context" })).toBeVisible();
    await expect(side.getByRole("heading", { name: "Linked evidence" })).toBeVisible();
    await expect(side.getByRole("link", { name: "Inspect exact occurrence" })).toBeVisible();
  }
  const firstSide = page.getByRole("region", { name: "First claim occurrence" });
  const exactSourceLink = firstSide.getByRole("link", { name: "Read exact source version" });
  const exactSourceHref = await exactSourceLink.getAttribute("href");
  expect(exactSourceHref).toMatch(/^\/reviews\/[^/]+\/versions\/[^/]+$/);
  const sourceResponse = await page.goto(exactSourceHref!);
  expect(sourceResponse?.ok()).toBe(true);
  await expect(page).toHaveURL(new URL(exactSourceHref!, original.origin).href);
  await expect(page.locator("article").first()).toBeVisible();
  await page.goto(original.href);
  expect(new URL(page.url()).searchParams.get("left")).toBe(left);
  expect(new URL(page.url()).searchParams.get("right")).toBe(right);
  await expect(page.getByRole("heading", { name: "Relationship and uncertainty" })).toBeVisible();
  await expect(page.getByText(/No relationship in this bounded view/)).toBeVisible();
  await page.getByRole("button", { name: "Copy exact pair link" }).click();
  await expect(page.getByRole("status")).toHaveText("Copied exact references.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original.href);
  await page.getByRole("button", { name: "Copy exact references", exact: true }).click();
  const references = await page.evaluate(() => navigator.clipboard.readText());
  expect(references).toContain(left!);
  expect(references).toContain(right!);
  await page.reload();
  await page.getByRole("link", { name: "Reopen exact pair" }).click();
  expect(new URL(page.url()).searchParams.get("left")).toBe(left);
  expect(new URL(page.url()).searchParams.get("right")).toBe(right);
  await expect(page.getByRole("region", { name: "First claim occurrence" })).toContainText(left!);
  await expect(page.getByRole("region", { name: "Second claim occurrence" })).toContainText(right!);
});

test("exact pair is keyboard readable, accessible and contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("link", { name: "Compare two claims · synthetic example" }).click();
  await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Copy exact references", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "Copy exact references", exact: true }),
  ).toBeFocused();
  const results = await new AxeBuilder({ page }).include(".claim-pair-page").analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("review comparison query behavior remains available", async ({ page }) => {
  const left = "hippocampal-replay-computational-review";
  const right = "cortical-oscillations-attention-review";
  await page.goto(`/compare?${new URLSearchParams({ left, right })}`);
  await expect(
    page.getByRole("heading", { name: "Compare claims with their evidence" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compare review coverage" })).toBeVisible();
  await expect(page.getByLabel("First record")).toHaveValue(left);
  await expect(page.getByLabel("Second record")).toHaveValue(right);
  await page.getByRole("button", { name: "Compare records", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("left")).toBe(left);
  expect(new URL(page.url()).searchParams.get("right")).toBe(right);
  await expect(
    page.getByRole("heading", { name: "What each deposit makes inspectable" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Hippocampal replay/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cortical oscillations/i })).toBeVisible();
});

test("missing or ambiguous exact references do not choose a default pair", async ({ page }) => {
  for (const query of ["", "?left=/claims/missing/missing", "?left=a&left=b&right=c"]) {
    const response = await page.goto(`/compare/claims${query}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "This claim pair is unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose two exact claims" })).toHaveAttribute(
      "href",
      "/compare",
    );
  }
});
