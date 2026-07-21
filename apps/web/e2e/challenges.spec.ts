import { test, expect } from "@playwright/test";
import { getPrisma } from "@oratlas/db";

const REVIEW_SLUG = "hippocampal-replay-computational-review";
const REVIEW = `/reviews/${REVIEW_SLUG}`;
const prisma = getPrisma();

test.describe("Formal challenge register", () => {
  test("is visibly separate from assessments and open discussion", async ({ page }) => {
    await page.goto(REVIEW);
    const section = page.locator('[data-register="formal-challenge"]');
    await expect(section.getByRole("heading", { name: "Formal challenges" })).toBeVisible();
    await expect(section).toContainText("do not change claims, relations, assessments");
    await expect(section.getByRole("link", { name: /Sign in/ })).toBeVisible();
    await expect(page.locator('[data-register="open-discussion"]')).toHaveCount(1);
    await expect(page.getByText(/TRUST assessments/).first()).toBeVisible();

    const unauthorizedStatus = await page.evaluate(async () => {
      const response = await fetch("/api/reviews/example/versions/example/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return response.status;
    });
    expect(unauthorizedStatus).toBe(401);

    const crossOrigin = await page.request.post(
      "/api/reviews/example/versions/example/challenges",
      {
        headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
        data: {},
      },
    );
    expect(crossOrigin.status()).toBe(403);
  });

  test("files escaped text against an exact subject and persists its attributed ledger", async ({
    page,
  }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as submitter/ }).click();
    await expect(page).toHaveURL(/\/submit/);
    await page.goto(REVIEW);

    const section = page.locator('[data-register="formal-challenge"]');
    const body = `<img src=x onerror=alert(1)> exact-subject challenge ${Date.now()}`;
    await section.getByLabel("Immutable subject").selectOption({ index: 0 });
    await section.getByLabel("Grounds").selectOption("methodology");
    await section.getByLabel("Objection").fill(body);
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/challenges") && candidate.request().method() === "POST",
      ),
      section.getByRole("button", { name: "File challenge" }).click(),
    ]);
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };

    await expect(section.getByText(body)).toBeVisible();
    await expect(section.locator("img")).toHaveCount(0);
    const subjectLink = section.locator(`#challenge-${id}`).getByRole("link");
    const href = await subjectLink.getAttribute("href");
    expect(href).toMatch(/\/reviews\/.*\/versions\/.*#claim-subject-/);
    await page.reload();
    await expect(page.locator(`#challenge-${id}`).getByText(body)).toBeVisible();

    const challenge = await prisma.challenge.findUniqueOrThrow({
      where: { id },
      include: { transitions: true },
    });
    expect(challenge.challengerId).toBe(
      (await prisma.user.findUniqueOrThrow({ where: { githubLogin: "atlas-submitter" } })).id,
    );
    expect(challenge.transitions).toMatchObject([
      { fromStatus: null, toStatus: "open", revision: 0 },
    ]);
    expect(
      await prisma.auditEvent.count({
        where: { subjectType: "challenge", subjectId: id, action: "challenge.filed" },
      }),
    ).toBe(1);
  });
});
