import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CLAIM_EVIDENCE_RELATION_TYPES,
  CLAIM_TYPES,
  claimEvidenceRelationTypeSchema,
  claimTypeSchema,
} from "@oratlas/contracts";
import { extractJsonObject, type LlmProvider } from "./discuss.js";
import { canonicalJson } from "./packet.js";

export const INGESTION_EXTRACTION_PROMPT_VERSION = "atlas-ingestion-extraction-1.0";

const sourceFileSchema = z
  .object({
    path: z.string().min(1).max(512),
    content: z.string().min(1).max(20_000),
  })
  .strict();

const ingestionExtractionPacketSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    repository: z
      .object({
        url: z.string().url(),
        commitSha: z.string().min(40).max(64),
      })
      .strict(),
    files: z.array(sourceFileSchema).min(1).max(12),
    existing: z
      .object({
        claimCount: z.number().int().min(0),
        citationCount: z.number().int().min(0),
        nodeCount: z.number().int().min(0),
        declaredClaimTexts: z.array(z.string().max(1_000)).max(100),
      })
      .strict(),
    userInstruction: z.string().max(2_000).optional(),
  })
  .strict();

export type IngestionExtractionPacket = z.infer<typeof ingestionExtractionPacketSchema>;

const sourceGroundingSchema = z
  .object({
    sourcePath: z.string().min(1).max(512),
    sourceQuote: z.string().min(8).max(2_000),
  })
  .strict();

const extractedClaimSchema = z
  .object({
    temporaryId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    text: z.string().min(10).max(2_000),
    claimType: claimTypeSchema,
    qualification: z.string().min(3).max(1_000).optional(),
    source: sourceGroundingSchema,
  })
  .strict();

const extractedEvidenceSchema = z
  .object({
    temporaryId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    title: z.string().min(3).max(1_000),
    kind: z.enum(["citation", "figure", "dataset", "code"]),
    doi: z.string().min(6).max(200).optional(),
    url: z.string().url().max(2_000).optional(),
    source: sourceGroundingSchema,
  })
  .strict();

const extractedRelationSchema = z
  .object({
    claimId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    evidenceId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    relationType: claimEvidenceRelationTypeSchema,
    rationale: z.string().min(10).max(2_000),
  })
  .strict();

const ingestionExtractionDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("extract"),
      claims: z.array(extractedClaimSchema).min(1).max(12),
      evidence: z.array(extractedEvidenceSchema).max(20),
      relations: z.array(extractedRelationSchema).max(30),
      limitations: z.array(z.string().min(3).max(500)).max(10),
    })
    .strict(),
  z
    .object({
      decision: z.literal("abstain"),
      reason: z.string().min(20).max(2_000),
      missingEvidence: z.array(z.string().min(3).max(500)).max(10),
    })
    .strict(),
]);

export type IngestionExtractionDecision = z.infer<typeof ingestionExtractionDecisionSchema>;

export interface PreparedIngestionExtractionPacket {
  packet: IngestionExtractionPacket;
  json: string;
  sha256: string;
}

export interface IngestionExtractionResult {
  provider: string;
  model: string;
  modelVersion?: string;
  promptVersion: typeof INGESTION_EXTRACTION_PROMPT_VERSION;
  attempts: number;
  decision?: IngestionExtractionDecision;
  error?: string;
}

export function prepareIngestionExtractionPacket(
  input: Omit<IngestionExtractionPacket, "schemaVersion">,
): PreparedIngestionExtractionPacket {
  const packet = ingestionExtractionPacketSchema.parse({ schemaVersion: "1.0.0", ...input });
  const json = canonicalJson(packet);
  return {
    packet,
    json,
    sha256: createHash("sha256").update(json, "utf8").digest("hex"),
  };
}

export async function extractIngestionCandidates(
  provider: LlmProvider,
  prepared: PreparedIngestionExtractionPacket,
  maxAttempts = 2,
): Promise<IngestionExtractionResult> {
  const prompt = buildIngestionExtractionPrompt(prepared.json);
  let lastError = "The model did not return a valid source-grounded extraction.";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await provider.complete({
        promptVersion: INGESTION_EXTRACTION_PROMPT_VERSION,
        system: prompt.system,
        user: prompt.user,
        maxTokens: 3_000,
        maxResponseBytes: 131_072,
      });
      const parsed = ingestionExtractionDecisionSchema.parse(
        JSON.parse(extractJsonObject(raw)) as unknown,
      );
      if (parsed.decision === "extract") validateExtraction(parsed, prepared.packet);
      return {
        provider: provider.name,
        model: provider.model,
        modelVersion: provider.modelVersion,
        promptVersion: INGESTION_EXTRACTION_PROMPT_VERSION,
        attempts: attempt,
        decision: parsed,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid extraction output.";
    }
  }
  return {
    provider: provider.name,
    model: provider.model,
    modelVersion: provider.modelVersion,
    promptVersion: INGESTION_EXTRACTION_PROMPT_VERSION,
    attempts: maxAttempts,
    error: lastError,
  };
}

export function buildIngestionExtractionPrompt(packetJson: string): {
  system: string;
  user: string;
} {
  return {
    system: [
      "You annotate a fixed, non-executed repository inspection for ORAtlas ingestion.",
      "Use ONLY the supplied file bytes. Never browse, infer unavailable paper content, or execute code.",
      "Return exactly one JSON object and no chain-of-thought.",
      'Either {"decision":"abstain","reason":"...","missingEvidence":["..."]}',
      'or {"decision":"extract","claims":[...],"evidence":[...],"relations":[...],"limitations":[...]}.',
      `claimType must be one of: ${CLAIM_TYPES.join(", ")}.`,
      `relationType must be one of: ${CLAIM_EVIDENCE_RELATION_TYPES.join(", ")}.`,
      "Every claim and evidence candidate must name a supplied sourcePath and quote an exact verbatim substring from that file.",
      "Use temporary identifiers only within this response; every relation must reference an extracted claim and evidence identifier.",
      "Do not repeat a claim already listed in existing.declaredClaimTexts.",
      "Extract atomic scientific claims and explicit evidence objects only. Do not convert headings, aspirations, marketing statements, or unsupported interpretation into claims.",
      "Abstain when the captured files do not contain enough explicit material. These are AI proposals, never source-authored records.",
    ].join("\n"),
    user: packetJson,
  };
}

function validateExtraction(
  decision: Extract<IngestionExtractionDecision, { decision: "extract" }>,
  packet: IngestionExtractionPacket,
): void {
  const fileByPath = new Map(packet.files.map((file) => [file.path, file.content]));
  const claimIds = uniqueIds(
    decision.claims.map((claim) => claim.temporaryId),
    "claim",
  );
  const evidenceIds = uniqueIds(
    decision.evidence.map((evidence) => evidence.temporaryId),
    "evidence",
  );
  for (const record of [...decision.claims, ...decision.evidence]) {
    const content = fileByPath.get(record.source.sourcePath);
    if (!content) throw new Error("An extraction references a file outside the packet.");
    if (!content.includes(record.source.sourceQuote)) {
      throw new Error("An extraction quote is not present verbatim in its source file.");
    }
  }
  for (const relation of decision.relations) {
    if (!claimIds.has(relation.claimId) || !evidenceIds.has(relation.evidenceId)) {
      throw new Error("An extraction relation references an unknown temporary identifier.");
    }
  }
  const declared = new Set(packet.existing.declaredClaimTexts.map(normalizeText));
  if (decision.claims.some((claim) => declared.has(normalizeText(claim.text)))) {
    throw new Error("The extraction repeats an already-declared claim.");
  }
}

function uniqueIds(ids: string[], label: string): Set<string> {
  const set = new Set(ids);
  if (set.size !== ids.length) throw new Error(`Duplicate ${label} temporary identifiers.`);
  return set;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
