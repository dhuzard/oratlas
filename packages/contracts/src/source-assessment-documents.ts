import { z } from "zod";
import { commitShaSchema } from "./identifiers.js";

export const sourceAssessmentDocumentKindSchema = z.enum(["trust", "fair"]);
export type SourceAssessmentDocumentKind = z.infer<typeof sourceAssessmentDocumentKindSchema>;

export const sourceAssessmentDocumentSchema = z
  .object({
    kind: sourceAssessmentDocumentKindSchema,
    path: z.enum(["TRUST.md", "FAIR.md"]),
    status: z.enum(["absent", "unavailable", "preserved"]),
    size: z.number().int().nonnegative().optional(),
    /** SHA-256 of the preserved UTF-8 bytes. Present only when status is preserved. */
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    provenance: z.object({
      source: z.literal("repository-file"),
      commitSha: commitShaSchema,
      extractorVersion: z.string().min(1),
    }),
  })
  .superRefine((document, context) => {
    const expectedPath = document.kind === "trust" ? "TRUST.md" : "FAIR.md";
    if (document.path !== expectedPath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: `${document.kind} documents must use exact root path ${expectedPath}.`,
      });
    }
    if (document.status === "preserved" && (!document.contentHash || document.size === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Preserved documents require a size and content hash.",
      });
    }
    if (document.status !== "preserved" && document.contentHash !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentHash"],
        message: "Only preserved documents may declare a content hash.",
      });
    }
  });
export type SourceAssessmentDocument = z.infer<typeof sourceAssessmentDocumentSchema>;

/** Preservation-only report. It carries no parsed Markdown fields or inferred ratings. */
export const sourceAssessmentDocumentsReportSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    documents: z.array(sourceAssessmentDocumentSchema).length(2),
  })
  .superRefine((report, context) => {
    if (new Set(report.documents.map((document) => document.kind)).size !== 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documents"],
        message: "The report must contain exactly one TRUST.md and one FAIR.md descriptor.",
      });
    }
  });
export type SourceAssessmentDocumentsReport = z.infer<typeof sourceAssessmentDocumentsReportSchema>;
