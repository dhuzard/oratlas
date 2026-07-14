import { test, expect } from "@playwright/test";

test.describe("Independence-aware synthesis", () => {
  test("contradiction map classifies the seeded scope difference", async ({ request }) => {
    const res = await request.get("/api/synthesis/contradictions");
    expect(res.ok()).toBeTruthy();
    const map = await res.json();
    expect(map.reviewCount).toBeGreaterThanOrEqual(2);
    // The replay and attention reviews oppose each other over one shared work
    // (same DOI) with differing declared scope.
    const scopeDiff = map.contradictions.find(
      (c: { kind: string }) => c.kind === "scope-difference",
    );
    expect(scopeDiff).toBeDefined();
    expect(scopeDiff.sharedFamilyCount).toBe(1);
    expect(scopeDiff.differingScopeFields).toContain("population");
  });

  test("contradiction map page renders", async ({ page }) => {
    await page.goto("/synthesis");
    await expect(page.getByRole("heading", { name: "Contradiction map" })).toBeVisible();
    await expect(page.getByText(/scope difference/i).first()).toBeVisible();
  });

  test("claim passport shows an independence summary", async ({ page, request }) => {
    const detail = await request.get("/api/reviews/hippocampal-replay-computational-review");
    const review = await detail.json();
    const claim = review.claims.find(
      (c: { localClaimId: string }) => c.localClaimId === "claim-001",
    );
    await page.goto(`/claims/${review.version.id}/${encodeURIComponent(claim.localClaimId)}`);
    await expect(
      page.getByRole("heading", { name: /Independence & contradictions/ }),
    ).toBeVisible();
    await expect(page.getByText(/Supporting works/).first()).toBeVisible();
  });
});
