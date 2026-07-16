import { z } from "zod";

export const SYNTHESIS_REVIEW_SCHEMA_VERSION = "1.0.0" as const;
export const SYNTHESIS_SECTION_IDS = [
  "background",
  "state-of-knowledge",
  "agreements",
  "contradictions-and-open-questions",
  "data-and-code-availability",
  "limitations",
] as const;
export const SYNTHESIS_SECTION_TITLES = [
  "Background",
  "State of knowledge",
  "Agreements",
  "Contradictions and open questions",
  "Data and code availability",
  "Limitations",
] as const;

export const SYNTHESIS_REVIEW_LIMITS = {
  maxOutputBytes: 65_536,
  maxTitleCharacters: 300,
  maxSummaryCharacters: 2_000,
  maxParagraphCharacters: 4_000,
  maxParagraphsPerSection: 12,
  maxReferencesPerCitationSite: 50,
} as const;

const referenceIdSchema = z.string().regex(/^reference:sha256:[0-9a-f]{64}$/);
const boundedIdSchema = z.string().trim().min(1).max(200);
const hasDisallowedControl = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || code < 32;
  });
const plainProse = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !hasDisallowedControl(value), {
      message: "Prose must be one plain paragraph without control characters.",
    })
    .refine((value) => !/<[^>]*>|https?:\/\//i.test(value), {
      message: "Prose must not contain HTML or URLs.",
    });

export const synthesisReviewCitationSchema = z
  .object({
    referenceId: referenceIdSchema,
    nodeId: boundedIdSchema,
    nodeVersionId: boundedIdSchema,
  })
  .strict();
export type SynthesisReviewCitation = z.infer<typeof synthesisReviewCitationSchema>;

const citationsSchema = z
  .array(synthesisReviewCitationSchema)
  .max(SYNTHESIS_REVIEW_LIMITS.maxReferencesPerCitationSite)
  .superRefine((values, context) => {
    if (new Set(values.map((value) => value.referenceId)).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Reference ids must be unique." });
    }
  });

export const synthesisReviewParagraphSchema = z
  .object({
    text: plainProse(SYNTHESIS_REVIEW_LIMITS.maxParagraphCharacters),
    citations: citationsSchema,
  })
  .strict();
export type SynthesisReviewParagraph = z.infer<typeof synthesisReviewParagraphSchema>;

function sectionSchema<Id extends string, Title extends string>(id: Id, title: Title) {
  return z
    .object({
      id: z.literal(id),
      title: z.literal(title),
      paragraphs: z
        .array(synthesisReviewParagraphSchema)
        .min(1)
        .max(SYNTHESIS_REVIEW_LIMITS.maxParagraphsPerSection),
    })
    .strict();
}

const utf8Encoder = new TextEncoder();

/** Strict writer output. The tuple fixes all six sections and their order. */
export const synthesisReviewDocumentSchema = z
  .object({
    schemaVersion: z.literal(SYNTHESIS_REVIEW_SCHEMA_VERSION),
    title: plainProse(SYNTHESIS_REVIEW_LIMITS.maxTitleCharacters),
    summary: plainProse(SYNTHESIS_REVIEW_LIMITS.maxSummaryCharacters),
    citations: citationsSchema,
    sections: z.tuple([
      sectionSchema(SYNTHESIS_SECTION_IDS[0], SYNTHESIS_SECTION_TITLES[0]),
      sectionSchema(SYNTHESIS_SECTION_IDS[1], SYNTHESIS_SECTION_TITLES[1]),
      sectionSchema(SYNTHESIS_SECTION_IDS[2], SYNTHESIS_SECTION_TITLES[2]),
      sectionSchema(SYNTHESIS_SECTION_IDS[3], SYNTHESIS_SECTION_TITLES[3]),
      sectionSchema(SYNTHESIS_SECTION_IDS[4], SYNTHESIS_SECTION_TITLES[4]),
      sectionSchema(SYNTHESIS_SECTION_IDS[5], SYNTHESIS_SECTION_TITLES[5]),
    ]),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      utf8Encoder.encode(JSON.stringify(document)).byteLength >
      SYNTHESIS_REVIEW_LIMITS.maxOutputBytes
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Review exceeds the UTF-8 output cap.",
      });
    }
  });
export type SynthesisReviewDocument = z.infer<typeof synthesisReviewDocumentSchema>;
