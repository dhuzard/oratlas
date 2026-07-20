import {
  TRUST_CRITERIA,
  trustCriterionAssessmentSchema,
  type TrustCriterion,
} from "@oratlas/contracts";
import { type TrustCriterionProfileRow } from "@oratlas/ui";

type CriterionValues = Partial<Record<TrustCriterion, unknown>>;

export function trustCriterionProfile(criteria: CriterionValues): TrustCriterionProfileRow[] {
  return TRUST_CRITERIA.map((criterion) => profileRow(criterion, criteria[criterion]));
}

export function trustCriterionProfileFromJson(
  criteriaJson: Record<TrustCriterion, string | null>,
): TrustCriterionProfileRow[] {
  return TRUST_CRITERIA.map((criterion) => {
    const encoded = criteriaJson[criterion];
    if (encoded === null) return profileRow(criterion, undefined);
    try {
      return profileRow(criterion, JSON.parse(encoded));
    } catch {
      return invalidRow(criterion);
    }
  });
}

function profileRow(criterion: TrustCriterion, value: unknown): TrustCriterionProfileRow {
  if (value === undefined) {
    return { criterion, rating: "not-supplied", status: "not-supplied" };
  }
  const parsed = trustCriterionAssessmentSchema.safeParse(value);
  if (!parsed.success) return invalidRow(criterion);
  return {
    criterion,
    rating: parsed.data.rating,
    status: parsed.data.status ?? "assessed",
    rationale: parsed.data.rationale,
  };
}

function invalidRow(criterion: TrustCriterion): TrustCriterionProfileRow {
  return { criterion, rating: "unavailable", status: "invalid" };
}
