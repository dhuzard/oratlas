import { expect, test } from "@playwright/test";
import { getPrisma } from "@oratlas/db";

const secondAssessmentId = "e2e-d03-independent-aggregate-free";
const prisma = getPrisma();

test("two aggregate-free TRUST assessments render complete independent profiles", async ({
  page,
}) => {
  await prisma.trustAssessment.deleteMany({ where: { id: secondAssessmentId } });
  const original = await prisma.trustAssessment.findFirstOrThrow({
    where: {
      aggregateScore: null,
      relation: {
        claim: {
          reviewVersion: { review: { slug: "cortical-oscillations-attention-review" } },
        },
      },
    },
  });

  await prisma.trustAssessment.create({
    data: {
      id: secondAssessmentId,
      claimEvidenceRelationId: original.claimEvidenceRelationId,
      protocolVersion: "trust-independent-2.0",
      assessorType: "human",
      assessorId: "independent-profile-reviewer",
      assessedAt: new Date("2026-07-20T00:00:00.000Z"),
      entailment: JSON.stringify({ rating: "not-assessed", status: "not-assessed" }),
      limitationsJson: JSON.stringify(["Independent criterion-profile fixture."]),
      aggregateScore: null,
      aggregateMethod: null,
      reviewStatus: "unverified-import",
      sourceRecordJson: JSON.stringify({
        protocolVersion: "trust-independent-2.0",
        assessorType: "human",
        assessorId: "independent-profile-reviewer",
        criteria: { entailment: { rating: "not-assessed", status: "not-assessed" } },
        aggregateScore: null,
        aggregateMethod: null,
      }),
      sourceReviewStatus: "human-reviewed",
      sourceAssessorType: "human",
      sourceAssessorId: "independent-profile-reviewer",
      sourceAssessedAt: new Date("2026-07-20T00:00:00.000Z"),
      sourceAggregateScore: null,
      sourceAggregateMethod: null,
      sourceRecordHash: "d".repeat(64),
      sourceLineageKey: "e2e-d03-independent-profile",
    },
  });

  try {
    await page.goto("/reviews/cortical-oscillations-attention-review");

    const claim = page.locator(".claim-card").filter({
      hasText:
        "Waking place-cell sequences are not faithfully reactivated during human sleep replay.",
    });
    const assessmentList = claim.locator("details");
    await expect(assessmentList.locator("summary")).toHaveText("Formal TRUST assessments (2)");
    await assessmentList.locator("summary").click();

    const assessments = assessmentList.locator('section[aria-label^="Formal TRUST assessment "]');
    await expect(assessments).toHaveCount(2);
    for (const assessment of await assessments.all()) {
      const profile = assessment.getByRole("table", { name: "TRUST criteria" });
      await expect(profile.getByRole("row")).toHaveCount(11);
      await expect(profile.getByRole("columnheader", { name: "Rating" })).toBeVisible();
      await expect(profile.getByRole("columnheader", { name: "Status" })).toBeVisible();
      await expect(assessment.getByText(/aggregate/i)).toHaveCount(0);
      await expect(assessment.getByRole("progressbar")).toHaveCount(0);
    }

    const independent = assessmentList.getByRole("region", {
      name: `Formal TRUST assessment ${secondAssessmentId}`,
    });
    await expect(independent).toContainText("independent-profile-reviewer");
    await expect(independent).toContainText("trust-independent-2.0");
    await expect(independent.getByRole("cell", { name: "not assessed", exact: true })).toHaveCount(
      2,
    );
    await expect(independent.getByRole("cell", { name: "not supplied", exact: true })).toHaveCount(
      18,
    );
  } finally {
    await prisma.trustAssessment.deleteMany({ where: { id: secondAssessmentId } });
  }
});
