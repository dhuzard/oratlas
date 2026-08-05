import { z } from "zod";
import { claimEvidenceRelationTypeSchema } from "./enums.js";
import { commitShaSchema } from "./identifiers.js";

export const INGESTION_EXTRACTION_PACKET_VERSION = "1.0.0" as const;
export const INGESTION_EXTRACTION_PROPOSAL_VERSION = "1.0.0" as const;

export const extractionSourceFileSchema = z
  .object({
    path: z.string().min(1).max(512),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteLength: z.number().int().positive().max(50_000),
    content: z.string().min(1).max(50_000),
  })
  .strict();

export const ingestionExtractionPacketSchema = z
  .object({
    schemaVersion: z.literal(INGESTION_EXTRACTION_PACKET_VERSION),
    repositoryUrl: z.string().url(),
    commitSha: commitShaSchema,
    treeSha: commitShaSchema,
    files: z.array(extractionSourceFileSchema).min(1).max(12),
    warnings: z.array(z.string().min(1).max(500)).max(50),
  })
  .strict();
export type IngestionExtractionPacket = z.infer<typeof ingestionExtractionPacketSchema>;

export const extractionSourceSpanSchema = z
  .object({
    path: z.string().min(1).max(512),
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().positive(),
    excerptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const extractionClaimProposalSchema = z
  .object({
    proposalId: z.string().min(1).max(120),
    text: z.string().trim().min(1).max(5_000),
    claimType: z.string().trim().min(1).max(40).optional(),
    source: extractionSourceSpanSchema,
  })
  .strict();

export const extractionCitationProposalSchema = z
  .object({
    proposalId: z.string().min(1).max(120),
    rawCitationText: z.string().trim().min(1).max(5_000),
    source: extractionSourceSpanSchema,
    resolvedWorkId: z.string().min(1).max(200).optional(),
  })
  .strict();

export const extractionRelationProposalSchema = z
  .object({
    claimProposalId: z.string().min(1).max(120),
    citationProposalId: z.string().min(1).max(120),
    relationType: claimEvidenceRelationTypeSchema,
  })
  .strict();

export const ingestionExtractionProposalSchema = z
  .object({
    schemaVersion: z.literal(INGESTION_EXTRACTION_PROPOSAL_VERSION),
    claims: z.array(extractionClaimProposalSchema).max(100),
    citations: z.array(extractionCitationProposalSchema).max(200),
    relations: z.array(extractionRelationProposalSchema).max(400),
    warnings: z.array(z.string().min(1).max(1_000)).max(100),
  })
  .strict();
export type IngestionExtractionProposal = z.infer<typeof ingestionExtractionProposalSchema>;

export const ingestionExtractionBundleSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    packetHash: z.string().regex(/^[0-9a-f]{64}$/),
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(200),
    promptVersion: z.string().min(1).max(120),
    generatedAt: z.string().datetime(),
    proposal: ingestionExtractionProposalSchema,
    reviewStatus: z.literal("human-review-required"),
  })
  .strict();
export type IngestionExtractionBundle = z.infer<typeof ingestionExtractionBundleSchema>;
