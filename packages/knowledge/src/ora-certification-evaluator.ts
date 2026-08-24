import { createHash } from "node:crypto";
import {
  ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
  ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
  canonicalJson,
  oraScientificMeritEvaluationSchema,
  publicationVersionPacketSchema,
  type CertificationEvidenceReference,
  type CertificationProtocolDefinition,
  type OraScientificMeritEvaluation,
  type PublicationVersionPacket,
} from "@oratlas/contracts";
import { extractJsonObject, type LlmProvider } from "./discuss.js";
import type { CertificationEvaluation, CertificationEvaluator } from "./certification-evaluator.js";

export const ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT = `You are evaluating one exact frozen ORAtlas PublicationVersion packet under ORA Scientific Merit Pilot 0.1.0.

Hard constraints:
- Judge only the supplied frozen packet. Do not browse, fetch URLs, call tools, or execute code.
- Return JSON only with exactly {"criteria": [...], "limitations": [...]} and no final outcome or score.
- Return exactly criteria c1 through c10 once each. Status must be pass, concern, fail, not-applicable, or insufficient-evidence.
- Cite only exact IDs that exist in the packet using the allowed evidence-reference objects. Never invent an ID or use a mutable URL as evidence.
- Every pass, concern, or fail must cite at least one exact packet evidence reference. Insufficient-evidence and not-applicable may have none.
- Missing information is not failure. Distinguish absence from unavailable, partial, or truncated coverage and use insufficient-evidence when omitted material prevents judgment.
- Partial content does not automatically fail. Empty or unsupported content normally makes c4, c5, or c6 insufficient when those questions apply and cannot be assessed elsewhere.
- Use not-applicable only for genuine irrelevance.
- Source claims, citations, canonical graph relations, and TRUST assessments are distinct. A citation does not automatically support a claim.
- Human, AI-assisted, and agentic production modes do not determine scientific quality and must not be rewarded or penalized as such.
- An empty challenges array is not proof that no challenges or concerns exist.
- Identify exact, material limitations; do not use universal truth, validity, endorsement, or definitive peer-review language.

Assess the criteria exactly as defined in the supplied protocol.`;

const MAX_ATTEMPTS = 2;
const MAX_TOKENS = 4_000;
const MAX_RESPONSE_BYTES = 131_072;

export class OraScientificMeritEvaluator implements CertificationEvaluator {
  constructor(private readonly provider: LlmProvider) {}

  async evaluate(input: {
    packet: PublicationVersionPacket;
    protocol: CertificationProtocolDefinition;
  }): Promise<CertificationEvaluation> {
    const packet = publicationVersionPacketSchema.parse(input.packet);
    assertExactPilotProtocol(input.protocol);
    const startedAt = new Date();
    let lastError = "ORA evaluator did not return a valid result.";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const raw = extractJsonObject(
          await this.provider.complete({
            promptVersion: ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
            system: ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT,
            user: canonicalJson({ protocol: input.protocol, packet }),
            maxTokens: MAX_TOKENS,
            maxResponseBytes: MAX_RESPONSE_BYTES,
          }),
        );
        const parsed = oraScientificMeritEvaluationSchema.parse(JSON.parse(raw));
        validateOraEvidence(parsed, packet);
        const completedAt = new Date();
        const structuredOutput = canonicalJson(parsed);
        return {
          ...parsed,
          limitations: addPacketLimitations(parsed.limitations, packet),
          executionMetadata: {
            provider: this.provider.name,
            model: this.provider.model,
            modelVersion: this.provider.modelVersion,
            promptVersion: ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
            attempts: attempt,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            structuredOutputSha256: sha256(structuredOutput),
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`ORA scientific-merit evaluation failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }
}

function assertExactPilotProtocol(protocol: CertificationProtocolDefinition) {
  if (canonicalJson(protocol) !== canonicalJson(ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION)) {
    throw new Error("Evaluator protocol does not match ORA Scientific Merit Pilot 0.1.0.");
  }
}

function validateOraEvidence(
  evaluation: OraScientificMeritEvaluation,
  packet: PublicationVersionPacket,
) {
  const allowed = new Map<string, Set<string>>([
    ["publication-content-document", new Set(packet.content.map((item) => item.id))],
    ["publication-occurrence", new Set(packet.occurrences.map((item) => item.id))],
    ["capture", new Set(packet.captures.map((item) => item.id))],
    ["canonical-node-version", new Set(packet.occurrences.flatMap((item) => item.canonicalBinding ? [item.canonicalBinding.knowledgeNodeVersionId] : []))],
    ["canonical-relation", new Set(packet.relations.map((item) => item.id))],
    ["production-provenance", new Set(packet.productionProvenance.map((item) => item.id))],
    ["trust-assessment", new Set(collectIds(packet, new Set(["trustAssessmentId", "assessmentId"])))],
  ]);
  for (const criterion of evaluation.criteria) {
    for (const reference of criterion.evidenceRefs) {
      if (reference.type === "external-immutable-resource") {
        throw new Error("ORA Pilot evidence must be an exact identifier in the frozen packet.");
      }
      if (!allowed.get(reference.type)?.has(reference.id)) {
        throw new Error(`ORA evaluator cited an unknown packet reference: ${reference.type}:${reference.id}.`);
      }
    }
  }
}

function addPacketLimitations(limitations: string[], packet: PublicationVersionPacket): string[] {
  const values = new Set(limitations);
  values.add("Pilot machine assessment; it is not definitive peer review or a statement of universal scientific truth.");
  if (packet.completeness.content.coverage !== "complete") {
    values.add(`Scientific content coverage was ${packet.completeness.content.coverage}; unavailable material was not treated as absent.`);
  }
  if (packet.version.structuralProvenance !== "source-byte") {
    values.add("Declared source bytes were unavailable; assessment used the captured published structure.");
  }
  if (collectIds(packet, new Set(["trustAssessmentId", "assessmentId"])).length === 0) {
    values.add("No TRUST assessment identifiers were available in the frozen packet.");
  }
  values.add("The packet challenges section is not a complete challenge registry, including when empty.");
  return [...values];
}

function collectIds(value: unknown, keys: Set<string>): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) for (const item of value) found.push(...collectIds(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === "string") found.push(item);
      found.push(...collectIds(item, keys));
    }
  }
  return found;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Compile-time guard against accidentally widening ORA evidence beyond the
// existing generic evidence contract.
void (undefined as CertificationEvidenceReference | undefined);

