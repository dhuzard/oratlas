import { expect, test } from "@playwright/test";

test.describe("Replication Marketplace", () => {
  test("renders bounded published triage provenance with explicit scientific boundaries", async ({
    page,
  }) => {
    await page.goto("/replications");
    await expect(page.getByRole("heading", { name: "Replication marketplace" })).toBeVisible();
    await expect(page.getByText(/not a truth score/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Published editorial triage provenance/ }),
    ).toBeVisible();
    await expect(page.getByText(/anonymous page requests never trigger synthesis/i)).toBeVisible();
    await expect(page.getByText(/not a live or complete ranking/i)).toBeVisible();
  });

  test("public API is bounded and never exposes private drafts", async ({ request }) => {
    const response = await request.get("/api/replications?page=1&pageSize=10");
    expect(response.ok()).toBeTruthy();
    const result = (await response.json()) as {
      page: number;
      pageSize: number;
      briefs: Array<{ status: string }>;
    };
    expect(result).toMatchObject({ page: 1, pageSize: 10 });
    expect(result.briefs.every((brief) => brief.status !== "draft")).toBe(true);

    const rejected = await request.get("/api/replications?pageSize=51");
    expect(rejected.status()).toBe(400);
  });
});
