import { expect, test } from "@playwright/test";

test("legacy exact claims keep unknown scope and original passport fragments", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/reviews/hippocampal-replay-computational-review");
  expect(response.ok()).toBe(true);
  const review = (await response.json()) as {
    version: { id: string };
    claims: Array<{
      localClaimId: string;
      text: string;
      relations: Array<{ id: string }>;
    }>;
  };
  const declaredScope = review.claims.find((claim) => claim.localClaimId === "claim-001");
  const unknownScope = review.claims.find((claim) => claim.localClaimId === "claim-002");
  expect(declaredScope).toBeTruthy();
  expect(unknownScope).toBeTruthy();

  const left = `/claims/${review.version.id}/claim-001`;
  const right = `/claims/${review.version.id}/claim-002`;
  const pair = await page.goto(`/compare/claims?${new URLSearchParams({ left, right })}`);
  expect(pair?.status()).toBe(200);
  const firstSide = page.getByRole("region", { name: "First claim occurrence" });
  const secondSide = page.getByRole("region", { name: "Second claim occurrence" });
  await expect(firstSide).toContainText(left);
  await expect(firstSide).toContainText(declaredScope!.text);
  await expect(firstSide).toContainText("rodent hippocampus");
  await expect(secondSide).toContainText(right);
  await expect(secondSide).toContainText(unknownScope!.text);
  await expect(secondSide).toContainText("No structured scope was declared");
  await expect(
    page.getByText(/Both occurrences belong to the same exact source version/),
  ).toBeVisible();

  const relation = declaredScope!.relations[0];
  expect(relation?.id).toBeTruthy();
  const passport = await page.goto(`${left}#relation-${relation!.id}`);
  expect(passport?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`#relation-${relation!.id}$`));
  await expect(page.locator(`#relation-${relation!.id}`)).toBeVisible();

  await page.goto("/explore");
  const oldPassportFragment = await page.goto(`${left}#original-record`);
  if (oldPassportFragment) expect(oldPassportFragment.status()).toBe(200);
  await expect(page).toHaveURL(/#original-record$/);
  await expect(page.getByRole("heading", { name: "Original claim record" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exact source context" })).toBeVisible();
});
