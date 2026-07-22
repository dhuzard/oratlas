import { expect, test } from "@playwright/test";

const REPOSITORY_URL = "https://github.com/dhuzard/ethical-debt-AI-review";
const RELEASE_TAG = "v0.1.0-trust-preview.3";
const COMMIT_SHA = "955e2994e0c6a042be80851b2125c2064c211dcf";
const TREE_SHA = "095ceeb0ab7f5d9d3bc32f77869dcc856c707806";

test("inspects the frozen Ethical Debt release through the submission journey", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/signin");
  await page.getByRole("button", { name: /Sign in as submitter/ }).click();

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
  await expect(page.getByText(`Captured release: ${COMMIT_SHA}`)).toBeVisible();
  await page.getByRole("button", { name: "Continue to node candidates" }).click();
  await expect(page.getByText("No node manifest candidates were found.")).toBeVisible();
});
