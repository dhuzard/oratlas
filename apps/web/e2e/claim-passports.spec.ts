import { test, expect } from "@playwright/test";

test.describe("Claim passports & evidence monitoring", () => {
  test("living-review endpoint reports the seeded retraction proposal", async ({ request }) => {
    const res = await request.get(
      "/api/reviews/hippocampal-replay-computational-review/update-proposals",
    );
    expect(res.ok()).toBeTruthy();
    const feed = await res.json();
    expect(feed.openCount).toBeGreaterThanOrEqual(1);
    expect(feed.proposals[0].citationStatus).toBe("retracted");

    const missing = await request.get("/api/reviews/no-such-review/update-proposals");
    expect(missing.status()).toBe(404);
  });

  test("claim passport page renders identity, evidence, lineage and alerts", async ({
    page,
    request,
  }) => {
    const detail = await request.get("/api/reviews/hippocampal-replay-computational-review");
    const review = await detail.json();
    const claim = review.claims.find((candidate: { relations: Array<{ trust?: unknown }> }) =>
      candidate.relations.some((relation) => relation.trust),
    );
    expect(claim).toBeDefined();

    await page.goto(`/claims/${review.version.id}/${encodeURIComponent(claim.localClaimId)}`);
    await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible();
    await expect(page.getByText("claim passport").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Lineage across versions/ })).toBeVisible();
    await expect(
      page
        .getByText(/Atlas structurally verified|Repository\/source-native — not verified by Atlas/)
        .first(),
    ).toBeVisible();

    const passport = await request.get(
      `/api/claims/${review.version.id}/${encodeURIComponent(claim.localClaimId)}`,
    );
    expect(passport.ok()).toBeTruthy();
    const body = await passport.json();
    expect(body.localClaimId).toBe(claim.localClaimId);
    expect(body.claimId).toContain("oratlas:claim:v1:");
    expect(body.evidence.some((relation: { trust?: unknown }) => relation.trust)).toBe(true);

    const unknown = await request.get(`/api/claims/${review.version.id}/no-such-claim`);
    expect(unknown.status()).toBe(404);
  });

  test("version page badges claims with open evidence alerts", async ({ page }) => {
    await page.goto("/reviews/hippocampal-replay-computational-review");
    await expect(page.getByText(/evidence alert \(\d+\)/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "passport" }).first()).toBeVisible();
  });
});
