import { test, expect } from "@playwright/test";

test.describe("Grounded Q&A traversal gate", () => {
  test("does not expose archive-wide Discuss outside an explicit Explore path", async ({
    page,
  }) => {
    await page.goto("/discuss");

    await expect(page.getByRole("heading", { name: "Grounded Q&A" })).toBeVisible();
    await expect(
      page.getByText(/available only after you traverse the canonical graph/i),
    ).toBeVisible();
    await expect(page.getByLabel("Your question")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /Choose a graph path in Explore/i }),
    ).toHaveAttribute("href", "/explore");
  });

  test("rejects direct discussion requests without a signed traversal scope", async ({
    request,
  }) => {
    const response = await request.post("/api/discuss", {
      data: { question: "What evidence is available?" },
      headers: { Origin: "http://localhost:3000" },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad-request" },
    });
  });
});
