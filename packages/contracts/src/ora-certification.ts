import { z } from "zod";
import {
  CERTIFICATION_CRITERION_STATUSES,
  CERTIFICATION_OUTCOMES,
  certificationCriterionResultSchema,
  certificationProtocolDefinitionSchema,
  type CertificationProtocolDefinition,
} from "./certification.js";
import { publicationContentCompletenessSchema } from "./publications.js";

export const ORA_CERTIFIER_SLUG = "ora" as const;
export const ORA_CERTIFIER_NAME = "ORA" as const;
export const ORA_SCIENTIFIC_MERIT_SERIES = "scientific-merit-pilot" as const;
export const ORA_SCIENTIFIC_MERIT_VERSION = "0.1.0" as const;
export const ORA_SCIENTIFIC_MERIT_TITLE = "ORA Scientific Merit Pilot" as const;
export const ORA_SCIENTIFIC_MERIT_PROMPT_VERSION = "ora-scientific-merit-pilot-0.1.0" as const;
export const ORA_SCIENTIFIC_MERIT_OUTCOME_RULE_VERSION =
  "ora-scientific-merit-outcome-0.1.0" as const;

const allowedStatuses = [...CERTIFICATION_CRITERION_STATUSES];
const evidenceRequiredForStatuses = ["pass", "concern", "fail"] as const;

/** Immutable public definition of the pilot. Changes require a new protocol version. */
export const ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION = certificationProtocolDefinitionSchema.parse(
  {
    assessmentModes: ["ai", "hybrid"],
    outcomes: [...CERTIFICATION_OUTCOMES],
    // Partial content is intentionally permitted. Completeness constrains the
    // assessment; it is not a global precondition for this pilot.
    requireCompleteSections: [],
    criteria: [
      {
        id: "c1",
        title: "Publication identity and provenance integrity",
        description:
          "The exact publication version, captures, structural provenance, immutable content representation, and source identity are identifiable.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c2",
        title: "Research question or objectives",
        description:
          "The scientific question, objective, or hypothesis is sufficiently explicit to understand what the publication seeks to establish.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c3",
        title: "Major claims identifiable and scoped",
        description:
          "Major scientific claims are sufficiently identifiable, bounded, and interpretable; conventional articles are not failed merely for lacking exhaustive claim annotations.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c4",
        title: "Evidence traceability and support",
        description:
          "Major conclusions can be traced to reported evidence without treating source assertions, citations, graph relations, or TRUST assessments as interchangeable.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c5",
        title: "Methods adequate for the reported claims",
        description:
          "Relevant methods are described sufficiently to understand how findings were generated and how the design connects to the claims, with publication-type-appropriate expectations.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c6",
        title: "Analytical or statistical reasoning",
        description:
          "Where analytical inference is used, its design, uncertainty, comparisons, units, and interpretation are sufficiently reported and internally coherent.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c7",
        title: "Limitations and uncertainty",
        description:
          "Major limitations, uncertainty, scope boundaries, or alternative interpretations are appropriately exposed without requiring a specifically titled section.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c8",
        title: "Reproducibility and transparency",
        description:
          "Materials supporting reproducibility and transparency are reasonably exposed where relevant, without treating open data or code as universally mandatory.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c9",
        title: "Ethical, conflict, and reporting disclosures",
        description:
          "Applicable ethical approvals, conflicts, reporting constraints, or governance disclosures are visible; missing coverage is not invented as absence.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
      {
        id: "c10",
        title: "Major inconsistencies or unresolved critical concerns",
        description:
          "Available packet evidence does not show a major internal inconsistency, unsupported central conclusion, or unresolved critical problem; an empty challenges section is not proof that none exist.",
        required: true,
        allowedStatuses,
        evidenceRequired: false,
        evidenceRequiredForStatuses,
      },
    ],
  },
) satisfies CertificationProtocolDefinition;

export const ORA_SCIENTIFIC_MERIT_CRITERION_IDS =
  ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.criteria.map((criterion) => criterion.id);

export const oraScientificMeritCriterionResultsSchema = z
  .array(certificationCriterionResultSchema)
  .length(ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.criteria.length)
  .superRefine((criteria, context) => {
    const expected = new Set(ORA_SCIENTIFIC_MERIT_CRITERION_IDS);
    const seen = new Set<string>();
    criteria.forEach((criterion, index) => {
      if (!expected.has(criterion.criterionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "criterionId"],
          message: "Criterion is not part of ORA Scientific Merit Pilot 0.1.0.",
        });
      }
      if (seen.has(criterion.criterionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "criterionId"],
          message: "Criterion ids must be unique.",
        });
      }
      seen.add(criterion.criterionId);
      if (
        ["pass", "concern", "fail"].includes(criterion.status) &&
        criterion.evidenceRefs.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "evidenceRefs"],
          message: "A substantive ORA assessment must cite packet evidence.",
        });
      }
    });
  });
export type OraScientificMeritCriterionResults = z.infer<
  typeof oraScientificMeritCriterionResultsSchema
>;

export const oraScientificMeritEvaluationSchema = z
  .object({
    criteria: oraScientificMeritCriterionResultsSchema,
    limitations: z.array(z.string().min(1).max(2_000)).max(50),
  })
  .strict();
export type OraScientificMeritEvaluation = z.infer<typeof oraScientificMeritEvaluationSchema>;

/**
 * Versioned, deterministic 0.1.0 outcome rule. The evaluator supplies no
 * outcome field, so model preference cannot override this decision matrix.
 */
export function deriveOraScientificMeritOutcome(
  rawCriteria: OraScientificMeritCriterionResults,
  rawCompleteness: z.input<typeof publicationContentCompletenessSchema>,
) {
  const criteria = oraScientificMeritCriterionResultsSchema.parse(rawCriteria);
  const completeness = publicationContentCompletenessSchema.parse(rawCompleteness);
  if (criteria.some((criterion) => criterion.status === "fail")) return "not-certified" as const;
  if (criteria.some((criterion) => criterion.status === "insufficient-evidence"))
    return "inconclusive" as const;

  // Defensive fail-closed behavior for an evaluator that claims all material
  // content criteria pass while no scientific content was captured.
  if (
    (completeness.returnedDocuments === 0 || completeness.coverage === "unsupported") &&
    ["c4", "c5", "c6"].some(
      (id) =>
        criteria.find((criterion) => criterion.criterionId === id)?.status !== "not-applicable",
    )
  )
    return "inconclusive" as const;

  if (criteria.some((criterion) => criterion.status === "concern"))
    return "certified-with-conditions" as const;
  return "certified" as const;
}
