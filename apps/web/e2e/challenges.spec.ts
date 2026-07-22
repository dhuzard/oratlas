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

  test("files, records an author response, and resolves with attributable audit evidence", async ({
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

    const submitter = await prisma.user.findUniqueOrThrow({
      where: { githubLogin: "atlas-submitter" },
    });
    const person = await prisma.person.create({
      data: { displayName: "E2E author", githubLogin: submitter.githubLogin },
    });
    await prisma.reviewContributor.create({
      data: {
        reviewVersionId: challenge.reviewVersionId,
        personId: person.id,
        rolesJson: '["author"]',
        position: 999,
      },
    });
    const bareTransitionStatus = await page.evaluate(async (challengeId) => {
      const result = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 0, toStatus: "author-responded" }),
      });
      return result.status;
    }, id);
    expect(bareTransitionStatus).toBe(400);
    const responseBody = `<script>alert(2)</script> bounded contributor response ${Date.now()}`;
    const authorResponse = await page.evaluate(
      async ({ challengeId, responseBody }) => {
        const result = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: 0, body: responseBody }),
        });
        return { status: result.status, body: await result.text() };
      },
      { challengeId: id, responseBody },
    );
    expect(authorResponse.status, authorResponse.body).toBe(200);
    const { id: responseId } = JSON.parse(authorResponse.body) as { id: string };

    await page.context().clearCookies();
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as editor/ }).click();
    await expect(page).toHaveURL(/\/editorial/);
    const moderation = await page.evaluate(
      async ({ challengeId, responseId }) => {
        const removeChallenge = await fetch(
          `/api/challenges/${encodeURIComponent(challengeId)}/moderation`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedContentRevision: 0 }),
          },
        );
        const removeResponse = await fetch(
          `/api/challenge-responses/${encodeURIComponent(responseId)}/moderation`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedContentRevision: 0 }),
          },
        );
        return [removeChallenge.status, removeResponse.status];
      },
      { challengeId: id, responseId },
    );
    expect(moderation).toEqual([200, 200]);
    const resolution = await page.evaluate(async (challengeId) => {
      const result = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: 1,
          toStatus: "resolved",
          rationale: "The contributor response addresses the exact objection.",
        }),
      });
      return { status: result.status, body: await result.text() };
    }, id);
    expect(resolution.status, resolution.body).toBe(200);

    const completed = await prisma.challenge.findUniqueOrThrow({
      where: { id },
      include: { response: true, transitions: { orderBy: { revision: "asc" } } },
    });
    expect(completed).toMatchObject({
      body,
      contentStatus: "removed",
      status: "resolved",
      revision: 2,
      response: { body: responseBody, contentStatus: "removed" },
    });
    expect(completed.transitions).toMatchObject([
      { fromStatus: null, toStatus: "open", actorId: submitter.id, revision: 0 },
      {
        fromStatus: "open",
        toStatus: "author-responded",
        actorId: submitter.id,
        responseContentHash: completed.response?.contentHash,
        revision: 1,
      },
      {
        fromStatus: "author-responded",
        toStatus: "resolved",
        actorRoleSnapshot: "EDITOR",
        revision: 2,
      },
    ]);
    expect(
      await prisma.auditEvent.count({
        where: { subjectType: "challenge", subjectId: id, action: "challenge.transitioned" },
      }),
    ).toBe(2);
    await page.goto(REVIEW);
    const tombstone = page.locator(`#challenge-${id}`);
    await expect(tombstone).toContainText("resolved");
    await expect(tombstone).toContainText("[challenge text removed]");
    await expect(tombstone).toContainText("[response text removed]");
    await expect(tombstone).not.toContainText(body);
    await expect(tombstone).not.toContainText(responseBody);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: { in: ["challenge.content-removed", "challenge.response-removed"] },
          OR: [{ subjectId: id }, { subjectId: responseId }],
        },
      }),
    ).toBe(2);
  });
});
