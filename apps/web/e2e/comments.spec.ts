import { test, expect } from "@playwright/test";

const REVIEW = "/reviews/hippocampal-replay-computational-review";

test.describe("Open discussion", () => {
  test("shows seeded comments and the threaded exchange to anonymous readers", async ({ page }) => {
    await page.goto(REVIEW);
    const section = page.locator('[data-register="open-discussion"]');
    await expect(section.getByRole("heading", { name: /Open discussion/ })).toBeVisible();
    await expect(section).toContainText(/not TRUST assessments/i);
    // A seeded question and its editor reply are both rendered.
    await expect(section.getByText(/Does the replay-consolidation link hold/i)).toBeVisible();
    await expect(section.getByText(/Girardeau et al\. \(2009\)/i)).toBeVisible();
    // Anonymous readers are prompted to sign in rather than shown a form.
    await expect(section.getByRole("link", { name: /Sign in/ })).toBeVisible();

    const sentinel = "Does the replay-consolidation link hold";
    await expect(
      page.locator('[data-register="formal-assessment"]', { hasText: sentinel }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-register="formal-challenge"]', { hasText: sentinel }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-register="formal-editorial"]', { hasText: sentinel }),
    ).toHaveCount(0);
  });

  test("a signed-in user can post a comment that persists", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as submitter/ }).click();
    await expect(page).toHaveURL(/\/submit/);

    await page.goto(REVIEW);
    await page.waitForLoadState("networkidle");

    const body = `Reproducibility question ${Date.now()}`;
    const field = page.getByLabel("Your comment");
    await expect(async () => {
      await field.fill(body);
      await expect(page.getByRole("button", { name: /^Post comment$/ })).toBeEnabled({
        timeout: 1000,
      });
    }).toPass({ timeout: 30_000 });

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/comments") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: /^Post comment$/ }).click(),
    ]);
    expect(response.ok()).toBeTruthy();

    // The durable outcome: the comment is rendered after the server refresh…
    await expect(page.locator("#community-review").getByText(body)).toBeVisible();
    // …and survives a full reload (it was persisted, not just optimistic state).
    await page.reload();
    await expect(page.locator("#community-review").getByText(body)).toBeVisible();

    // The same discussion model accepts a source-bound selection from the MyST reader.
    const passage = page.locator(".myst-selectable-body p").first();
    const selectedText = (await passage.textContent())?.trim() ?? "";
    expect(selectedText.length).toBeGreaterThan(0);
    await passage.evaluate((element) => {
      const selection = globalThis.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Comment on passage" }).click();
    const composer = page.locator(".passage-composer");
    await expect(composer).toContainText(selectedText);

    const passageBody = `Passage question ${Date.now()}`;
    await composer.getByLabel("Your comment").fill(passageBody);
    const [passageResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/comments") && response.request().method() === "POST",
        { timeout: 30_000 },
      ),
      composer.getByRole("button", { name: "Post on this passage" }).click(),
    ]);
    expect(passageResponse.ok()).toBeTruthy();
    const discussion = page.locator("#community-review");
    await expect(discussion.getByText(passageBody)).toBeVisible();
    await expect(
      discussion.locator(".comment-passage").filter({ hasText: selectedText }),
    ).toBeVisible();
  });

  test("a contextual claim action preselects the discussion subject", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as submitter/ }).click();
    await expect(page).toHaveURL(/\/submit/);
    await page.goto(`${REVIEW}?commentOn=claim-001#community-review`);

    await expect(page.getByLabel("About")).toHaveValue("claim-001");

    await page
      .locator(".claim-card", { hasText: "claim-002" })
      .last()
      .getByRole("link", { name: "Comment on this claim" })
      .click();
    await expect(page).toHaveURL(/commentOn=claim-002/);
    await expect(page.getByLabel("About")).toHaveValue("claim-002");
  });
});
