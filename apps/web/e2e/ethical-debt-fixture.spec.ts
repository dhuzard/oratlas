import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers/auth";

const REPOSITORY_URL = "https://github.com/dhuzard/ethical-debt-AI-review";
const RELEASE_TAG = "v0.1.0-trust-preview.3";
const COMMIT_SHA = "955e2994e0c6a042be80851b2125c2064c211dcf";
const TREE_SHA = "095ceeb0ab7f5d9d3bc32f77869dcc856c707806";

test("recovers from inspection failures and inspects the frozen Ethical Debt release", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAs(page, "submitter");
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
  await page.unroute("**/api/inspect");

  await page.getByLabel("Public GitHub repository URL").fill(REPOSITORY_URL);
  await page.getByLabel("Source to capture").selectOption("release");
  await page.getByLabel("Exact tag").fill(RELEASE_TAG);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/inspect") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inspect repository" }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  const inspection = (await response.json()) as {
    selectedSource: { kind: string; commitSha: string; treeSha: string; releaseTag: string };
    compatibility: { overallCompatibility: string };
    knowledgeCounts: { claims: number; citations: number; relations: number; trust: number };
    nodeExtraction: { nodes: unknown[] };
  };
  expect(inspection).toMatchObject({
    selectedSource: {
      kind: "release",
      commitSha: COMMIT_SHA,
      treeSha: TREE_SHA,
      releaseTag: RELEASE_TAG,
    },
    compatibility: { overallCompatibility: "compatible" },
    knowledgeCounts: { claims: 529, citations: 994, relations: 1_392, trust: 1_392 },
    nodeExtraction: { nodes: [] },
  });

  await expect(page.getByRole("heading", { name: "Review extracted metadata" })).toBeVisible();
  await expect(page.getByLabel("Review title")).toHaveValue(
    "The Ethical Debt: Why wasting animal data is wasting animal lives",
  );
  await expect(page.getByText(`Exact commit: ${COMMIT_SHA}`)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review extracted node candidates" }),
  ).toBeVisible();
  await expect(page.getByText("No node manifest candidates were found.")).toBeVisible();
  await page.getByLabel("I reviewed this capture and its source version").check();
  await page.getByRole("button", { name: "Continue to submission" }).click();
  await expect(page.getByRole("heading", { name: "Submit this exact capture" })).toBeVisible();
});
