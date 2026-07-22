import { expect, test, type Page } from "@playwright/test";
import { getPrisma } from "@oratlas/db";
import {
  CLAIM_OUTCOME_CASES,
  compatibilityReportWithClaims,
  createArtifactOutcomeFixture,
  legacyCompatibilityReport,
  type ArtifactOutcomeFixture,
} from "./artifact-outcome-fixture";

const prisma = getPrisma();

interface OutcomeFixtures {
  notDeclared: ArtifactOutcomeFixture;
  invalid: ArtifactOutcomeFixture;
  loadedEmpty: ArtifactOutcomeFixture;
  loadedWithSkips: ArtifactOutcomeFixture;
  legacy: ArtifactOutcomeFixture;
}

let fixtures: OutcomeFixtures;

test.describe("honest optional-artifact outcomes", () => {
  test.beforeAll(async () => {
    fixtures = {
      notDeclared: await createArtifactOutcomeFixture({
        caseName: "not-declared",
        compatibilityReport: compatibilityReportWithClaims(CLAIM_OUTCOME_CASES.notDeclared),
      }),
      invalid: await createArtifactOutcomeFixture({
        caseName: "declared-invalid",
        compatibilityReport: compatibilityReportWithClaims(CLAIM_OUTCOME_CASES.invalid),
      }),
      loadedEmpty: await createArtifactOutcomeFixture({
        caseName: "loaded-empty",
        compatibilityReport: compatibilityReportWithClaims(CLAIM_OUTCOME_CASES.loadedEmpty),
      }),
      loadedWithSkips: await createArtifactOutcomeFixture({
        caseName: "loaded-with-skips",
        compatibilityReport: compatibilityReportWithClaims(CLAIM_OUTCOME_CASES.loadedWithSkips),
        claimCount: 3,
      }),
      legacy: await createArtifactOutcomeFixture({
        caseName: "legacy",
        compatibilityReport: legacyCompatibilityReport(),
      }),
    };
  });

  test.afterAll(async () => {
    if (fixtures) {
      for (const fixture of Object.values(fixtures)) await fixture.dispose();
    }
    await prisma.$disconnect();
  });

  test("distinguishes an artifact that was not declared", async ({ page }) => {
    const row = await claimsOutcomeRow(page, fixtures.notDeclared);
    await expect(row.getByText("Not declared", { exact: true })).toBeVisible();
    await expect(row).not.toContainText("Declared and loaded");
  });

  test("shows a declared artifact that failed validation with its reason", async ({ page }) => {
    const row = await claimsOutcomeRow(page, fixtures.invalid);
    await expect(row.getByText("Declared but invalid", { exact: true })).toBeVisible();
    await expect(row).toContainText("0 records loaded; 1 record skipped");
    await expect(row).toContainText(
      "knowledge/claims.jsonl: Line 1 failed claim schema validation.",
    );
  });

  test("distinguishes a valid declared artifact that loaded zero records", async ({ page }) => {
    const row = await claimsOutcomeRow(page, fixtures.loadedEmpty);
    await expect(row.getByText("Declared and loaded — empty", { exact: true })).toBeVisible();
    await expect(row).toContainText("0 records loaded");
  });

  test("shows loaded and skipped counts that agree with persisted rows", async ({ page }) => {
    const row = await claimsOutcomeRow(page, fixtures.loadedWithSkips);
    await expect(row.getByText("Loaded", { exact: true })).toBeVisible();
    await expect(row).toContainText("3 records loaded; 1 record skipped");
    await expect(page.locator(".claim-card")).toHaveCount(3);
  });

  test("labels legacy reports unknown instead of inferring an outcome", async ({ page }) => {
    const row = await claimsOutcomeRow(page, fixtures.legacy);
    await expect(
      row.getByText("Unknown — report predates per-artifact outcomes", { exact: true }),
    ).toBeVisible();
    await expect(row).not.toContainText("Not declared");
  });
});

async function claimsOutcomeRow(page: Page, fixture: ArtifactOutcomeFixture) {
  await page.goto(`/reviews/${fixture.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Artifact outcome:");
  const outcomes = page.locator("dl.artifact-outcomes");
  await expect(outcomes).toBeVisible();
  return outcomes.locator(":scope > div").filter({ hasText: /^Claims/ });
}
