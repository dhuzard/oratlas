import { createHash } from "node:crypto";
import { z } from "zod";
import { NODE_RELATION_TYPES, nodeRelationTypeSchema } from "@oratlas/contracts";
import { extractJsonObject, type LlmProvider } from "./discuss.js";
import { canonicalJson } from "./packet.js";

export const GRAPH_CURATION_PROMPT_VERSION = "atlas-graph-curation-1.0";

const graphCurationNodeSchema = z
  .object({
    nodeId: z.string().min(1).max(200),
    versionId: z.string().min(1).max(200),
    kind: z.enum(["claim", "figure", "dataset", "code"]),
    repository: z.string().url(),
    commitSha: z.string().min(40).max(64),
    title: z.string().min(1).max(500),
    abstract: z.string().max(10_000).optional(),
    text: z.string().max(30_000).optional(),
    payload: z.unknown(),
  })
  .strict();

const graphCurationPacketSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    source: graphCurationNodeSchema,
    target: graphCurationNodeSchema,
    allowedRelations: z.tuple([
      z.literal("supports"),
      z.literal("contradicts"),
      z.literal("replicates"),
      z.literal("extends"),
      z.literal("uses-dataset"),
      z.literal("uses-code"),
      z.literal("derives-from"),
    ]),
    userInstruction: z.string().max(2_000).optional(),
  })
  .strict();

export type GraphCurationPacket = z.infer<typeof graphCurationPacketSchema>;

const evidenceSchema = z
  .object({
    sourceQuotes: z.array(z.string().min(8).max(1_000)).min(1).max(3),
    targetQuotes: z.array(z.string().min(8).max(1_000)).min(1).max(3),
    comparison: z.string().min(20).max(2_000),
    limitations: z.array(z.string().min(3).max(500)).max(6),
  })
  .strict();

const graphCurationDecisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("propose"),
      relationType: nodeRelationTypeSchema,
      rationale: z.string().min(20).max(4_000),
      evidence: evidenceSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal("abstain"),
      reason: z.string().min(20).max(2_000),
      missingEvidence: z.array(z.string().min(3).max(500)).max(8),
    })
    .strict(),
]);

export type GraphCurationDecision = z.infer<typeof graphCurationDecisionSchema>;

export interface PreparedGraphCurationPacket {
  packet: GraphCurationPacket;
  json: string;
  sha256: string;
}

export interface GraphCurationResult {
  provider: string;
  model: string;
  modelVersion?: string;
  promptVersion: typeof GRAPH_CURATION_PROMPT_VERSION;
  attempts: number;
  decision?: GraphCurationDecision;
  error?: string;
}

export function prepareGraphCurationPacket(
  input: Omit<GraphCurationPacket, "schemaVersion" | "allowedRelations">,
): PreparedGraphCurationPacket {
  const packet = graphCurationPacketSchema.parse({
    schemaVersion: "1.0.0",
    ...input,
    allowedRelations: NODE_RELATION_TYPES,
  });
  const json = canonicalJson(packet);
  return {
    packet,
    json,
    sha256: createHash("sha256").update(json, "utf8").digest("hex"),
  };
}

export async function curateGraphRelation(
  provider: LlmProvider,
  prepared: PreparedGraphCurationPacket,
  maxAttempts = 2,
): Promise<GraphCurationResult> {
  const prompt = buildGraphCurationPrompt(prepared.json);
  let lastError = "The model did not return a valid graph-curation decision.";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await provider.complete({
        promptVersion: GRAPH_CURATION_PROMPT_VERSION,
        system: prompt.system,
        user: prompt.user,
        maxTokens: 1_800,
        maxResponseBytes: 65_536,
      });
      const parsed = graphCurationDecisionSchema.parse(
        JSON.parse(extractJsonObject(raw)) as unknown,
      );
      if (parsed.decision === "propose") validateEvidenceQuotes(parsed, prepared.packet);
      return {
        provider: provider.name,
        model: provider.model,
        modelVersion: provider.modelVersion,
        promptVersion: GRAPH_CURATION_PROMPT_VERSION,
        attempts: attempt,
        decision: parsed,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid graph-curation output.";
    }
  }
  return {
    provider: provider.name,
    model: provider.model,
    modelVersion: provider.modelVersion,
    promptVersion: GRAPH_CURATION_PROMPT_VERSION,
    attempts: maxAttempts,
    error: lastError,
  };
}

export function buildGraphCurationPrompt(packetJson: string): { system: string; user: string } {
  return {
    system: [
      "You propose one reviewable semantic edge between two exact immutable ORAtlas node versions.",
      "Use ONLY the supplied node packet. Never use outside knowledge or infer missing content.",
      `Allowed relationType values: ${NODE_RELATION_TYPES.join(", ")}.`,
      "Return exactly one JSON object, with no chain-of-thought.",
      'Either {"decision":"abstain","reason":"...","missingEvidence":["..."]}',
      'or {"decision":"propose","relationType":"...","rationale":"...","evidence":{"sourceQuotes":["..."],"targetQuotes":["..."],"comparison":"...","limitations":["..."]}}.',
      "Every quote must be an exact verbatim substring from the corresponding node packet.",
      "Abstain when the relationship is ambiguous, merely topical, or unsupported by both exact versions.",
      "Do not produce confidence scores. This is a proposal for human editorial review, never a fact.",
    ].join("\n"),
    user: packetJson,
  };
}

function validateEvidenceQuotes(
  decision: Extract<GraphCurationDecision, { decision: "propose" }>,
  packet: GraphCurationPacket,
): void {
  const source = searchableNodeText(packet.source);
  const target = searchableNodeText(packet.target);
  for (const quote of decision.evidence.sourceQuotes) {
    if (!source.includes(quote))
      throw new Error("A source quote is not present in the source node.");
  }
  for (const quote of decision.evidence.targetQuotes) {
    if (!target.includes(quote))
      throw new Error("A target quote is not present in the target node.");
  }
}

function searchableNodeText(node: GraphCurationPacket["source"]): string {
  return [node.title, node.abstract ?? "", node.text ?? "", canonicalJson(node.payload)].join("\n");
}
