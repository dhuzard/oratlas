import { expect, test } from "@playwright/test";

test("aggregate-free TRUST renders every explicit criterion without inventing zero", async ({
  page,
}) => {
  await page.goto("/reviews/cortical-oscillations-attention-review");

  const claim = page.locator(".claim-card").filter({
    hasText:
      "Waking place-cell sequences are not faithfully reactivated during human sleep replay.",
  });
  const assessment = claim.locator("details");
  await assessment.locator("summary").click();

  const profile = assessment.getByRole("table", { name: "TRUST criteria" });
  await expect(profile).toBeVisible();
  await expect(profile.getByRole("row")).toHaveCount(11);
  await expect(profile.getByRole("columnheader", { name: "Rating" })).toBeVisible();
  await expect(profile.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(profile.getByRole("cell", { name: "not assessed", exact: true })).toHaveCount(20);
  await expect(assessment.getByText(/aggregate/i)).toHaveCount(0);
  await expect(assessment.getByRole("progressbar")).toHaveCount(0);
});
