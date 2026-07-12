import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  canonicalJson,
  claimRecordSchema,
  citationRecordSchema,
  compatibilityReportSchema,
  extractedMetadataSchema,
  inspectionReportSchema,
  relationRecordSchema,
  reviewManifestSchema,
  submissionValidationReportSchema,
  trustRecordSchema,
  type InspectionReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { type FullExtraction } from "@oratlas/extractor";
import { z } from "zod";
import { prisma } from "./db";

export const INSPECTION_CAPTURE_TTL_MS = 30 * 60 * 1000;

export interface InspectionCapturePayload {
  schemaVersion: "1.0.0";
  report: InspectionReport;
  extraction: FullExtraction;
  validation: SubmissionValidationReport;
}

export interface InspectionCaptureCapability {
  token: string;
  expiresAt: string;
  payloadHash: string;
}

const inspectionCapturePayloadSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    report: inspectionReportSchema,
    extraction: z
      .object({
        metadata: extractedMetadataSchema,
        manifestPresent: z.boolean(),
        manifest: reviewManifestSchema.optional(),
        knowledge: z
          .object({
            claims: z.array(claimRecordSchema),
            citations: z.array(citationRecordSchema),
            relations: z.array(relationRecordSchema),
            trust: z.array(trustRecordSchema),
            warnings: z.array(z.string()),
          })
          .strict(),
        compatibility: compatibilityReportSchema,
      })
      .strict(),
    validation: submissionValidationReportSchema,
  })
  .strict();

export async function createInspectionCapture(
  inspectedByUserId: string,
  report: InspectionReport,
  extraction: FullExtraction,
  validation: SubmissionValidationReport,
  now = new Date(),
): Promise<InspectionCaptureCapability> {
  if (report.status === "failed" || !report.selectedSource || !report.githubRepositoryId) {
    throw new Error("A successful immutable inspection with a GitHub repository id is required.");
  }
  const payload: InspectionCapturePayload = {
    schemaVersion: "1.0.0",
    report,
    extraction,
    validation,
  };
  const payloadJson = canonicalJson(payload);
  const payloadHash = sha256(payloadJson);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INSPECTION_CAPTURE_TTL_MS);
  await prisma.inspectionCapture.create({
    data: {
      tokenHash: sha256(token),
      payloadJson,
      payloadHash,
      githubRepositoryId: report.githubRepositoryId,
      canonicalUrlAtCapture: report.repo.canonicalUrl,
      inspectedByUserId,
      commitSha: report.selectedSource.commitSha,
      releaseTag: report.selectedSource.releaseTag,
      createdAt: now,
      expiresAt,
    },
  });
  return { token, expiresAt: expiresAt.toISOString(), payloadHash };
}

export function parseAndVerifyCapture(
  payloadJson: string,
  expectedHash: string,
): InspectionCapturePayload {
  if (sha256(payloadJson) !== expectedHash)
    throw new Error("Inspection capture integrity check failed.");
  const value: unknown = JSON.parse(payloadJson);
  if (canonicalJson(value) !== payloadJson) {
    throw new Error("Inspection capture is not canonical or uses an unsupported schema.");
  }
  const parsed = inspectionCapturePayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("Inspection capture does not match its runtime schema.");
  return parsed.data as InspectionCapturePayload;
}

export function hashInspectionToken(token: string): string {
  return sha256(token);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
