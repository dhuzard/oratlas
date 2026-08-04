import "server-only";
import { canonicalJson } from "@oratlas/contracts";
import {
  INGESTION_EXTRACTION_PROMPT_VERSION,
  extractIngestionCandidates,
  prepareIngestionExtractionPacket,
  type IngestionExtractionDecision,
} from "@oratlas/knowledge";
import { prisma } from "./db";
import {
  hashInspectionToken,
  parseAndVerifyCapture,
  type InspectionCapturePayload,
} from "./inspection-captures";
import { resolveLlmProvider } from "./llm-credentials";

export class AiIngestionExtractionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "bad-request"
      | "forbidden"
      | "not-found"
      | "conflict"
      | "upstream-error",
  ) {
    super(message);
    this.name = "AiIngestionExtractionError";
  }
}

export interface AiIngestionExtractionOutcome {
  status: "extracted" | "abstained";
  agentRunId: string;
  packetHash: string;
  capturePayloadHash: string;
  sentFiles: string[];
  decision: IngestionExtractionDecision;
}

const MAX_PACKET_CHARACTERS = 120_000;
const MAX_FILE_CHARACTERS = 20_000;
const MAX_FILES = 12;

export async function extractInspectionCandidatesWithAi(input: {
  actorId: string;
  inspectionToken: string;
  instruction?: string;
}): Promise<AiIngestionExtractionOutcome> {
  const capture = await loadCapture(input.inspectionToken, input.actorId);
  const payload = parseAndVerifyCapture(capture.payloadJson, capture.payloadHash);
  const files = selectTextFiles(payload);
  if (files.length === 0) {
    throw new AiIngestionExtractionError(
      "The immutable inspection contains no eligible bounded text files for AI extraction.",
      "bad-request",
    );
  }
  const resolved = await resolveLlmProvider();
  if (!resolved) {
    throw new AiIngestionExtractionError(
      "Connect an Anthropic or OpenAI provider before requesting AI extraction.",
      "conflict",
    );
  }
  const selectedSource = payload.report.selectedSource;
  if (!selectedSource) {
    throw new AiIngestionExtractionError(
      "The inspection is not pinned to an immutable source.",
      "conflict",
    );
  }

  const prepared = prepareIngestionExtractionPacket({
    repository: {
      url: payload.report.repo.canonicalUrl,
      commitSha: selectedSource.commitSha,
    },
    files,
    existing: {
      claimCount: payload.extraction.knowledge.claims.length,
      citationCount: payload.extraction.knowledge.citations.length,
      nodeCount: payload.extraction.nodeExtraction.nodes.filter(
        (record) => record.status === "ok" && Boolean(record.node),
      ).length,
      declaredClaimTexts: payload.extraction.knowledge.claims
        .slice(0, 100)
        .map((claim) => claim.text.slice(0, 1_000)),
    },
    userInstruction: input.instruction?.trim() || undefined,
  });
  const run = await prisma.agentRun.create({
    data: {
      agentType: "ingestion-claim-evidence-extraction",
      modelProvider: resolved.provider.name,
      modelName: resolved.provider.model,
      modelVersion: resolved.provider.modelVersion,
      promptVersion: INGESTION_EXTRACTION_PROMPT_VERSION,
      packetHash: prepared.sha256,
      inputHash: prepared.sha256,
      inputReferencesJson: prepared.json,
      status: "running",
      startedAt: new Date(),
    },
  });

  const result = await extractIngestionCandidates(resolved.provider, prepared);
  if (!result.decision) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: (result.error ?? "Invalid provider output.").slice(0, 1_000),
      },
    });
    throw new AiIngestionExtractionError(
      "The provider did not return a valid extraction grounded in exact captured quotes.",
      "upstream-error",
    );
  }

  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: "succeeded",
      completedAt: new Date(),
      outputJson: canonicalJson({
        capturePayloadHash: capture.payloadHash,
        decision: result.decision,
      }),
    },
  });
  return {
    status: result.decision.decision === "extract" ? "extracted" : "abstained",
    agentRunId: run.id,
    packetHash: prepared.sha256,
    capturePayloadHash: capture.payloadHash,
    sentFiles: files.map((file) => file.path),
    decision: result.decision,
  };
}

async function loadCapture(token: string, actorId: string) {
  const capture = await prisma.inspectionCapture.findUnique({
    where: { tokenHash: hashInspectionToken(token) },
  });
  if (!capture) {
    throw new AiIngestionExtractionError("Inspection capability not found.", "not-found");
  }
  if (capture.inspectedByUserId !== actorId) {
    throw new AiIngestionExtractionError(
      "This inspection capability belongs to another user.",
      "forbidden",
    );
  }
  if (capture.consumedAt) {
    throw new AiIngestionExtractionError(
      "This inspection capability has already been consumed by a submission.",
      "conflict",
    );
  }
  if (capture.expiresAt.getTime() <= Date.now()) {
    throw new AiIngestionExtractionError("Inspection capability has expired.", "conflict");
  }
  return capture;
}

function selectTextFiles(payload: InspectionCapturePayload): Array<{ path: string; content: string }> {
  const candidates = Object.entries(payload.report.files)
    .flatMap(([path, file]) =>
      file.content !== undefined && !file.truncated && eligiblePath(path)
        ? [{ path, content: file.content }]
        : [],
    )
    .sort((left, right) => filePriority(left.path) - filePriority(right.path) || left.path.localeCompare(right.path));

  const selected: Array<{ path: string; content: string }> = [];
  let remaining = MAX_PACKET_CHARACTERS;
  for (const file of candidates) {
    if (selected.length >= MAX_FILES || remaining <= 0) break;
    const content = file.content.slice(0, Math.min(MAX_FILE_CHARACTERS, remaining));
    if (content.trim().length < 20) continue;
    selected.push({ path: file.path, content });
    remaining -= content.length;
  }
  return selected;
}

function eligiblePath(path: string): boolean {
  const lower = path.toLowerCase();
  const basename = lower.split("/").at(-1) ?? lower;
  if (
    basename.startsWith(".env") ||
    /(?:secret|credential|api[-_]?key|private[-_]?key|access[-_]?token)/i.test(path) ||
    /(?:package-lock|pnpm-lock|yarn\.lock|\.min\.)/.test(lower)
  ) {
    return false;
  }
  return (
    /\.(?:md|mdx|txt|rst|json|jsonl|ya?ml|csv|tsv|bib|xml)$/i.test(path) ||
    /^(?:readme|license|citation|codemeta)(?:\.|$)/i.test(basename)
  );
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();
  if (/readme|manuscript|article|review|paper/.test(lower)) return 0;
  if (/claim|citation|evidence|result|discussion/.test(lower)) return 1;
  if (/method|data|code|figure/.test(lower)) return 2;
  return 3;
}
