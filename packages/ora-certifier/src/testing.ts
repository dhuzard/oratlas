import { createHash } from "node:crypto";
import {
  ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
  ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
  canonicalJson,
  type CertificationEvidenceReference,
  type PublicationVersionPacket,
} from "@oratlas/contracts";
import type { CertificationEvaluator } from "@oratlas/knowledge";

export type OraTestScenario = "strong" | "concern" | "failure" | "incomplete";

/** Deterministic CI-only evaluator. It is deliberately absent from the production export. */
export function createDeterministicOraTestEvaluator(
  scenario: OraTestScenario,
): CertificationEvaluator {
  return {
    async evaluate({ packet, protocol }) {
      if (canonicalJson(protocol) !== canonicalJson(ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION))
        throw new Error("Unexpected test protocol.");
      const evidence = firstEvidence(packet);
      const criteria = protocol.criteria.map((criterion) => {
        let status: "pass" | "concern" | "fail" | "insufficient-evidence" = "pass";
        if (scenario === "concern" && criterion.id === "c7") status = "concern";
        if (scenario === "failure" && criterion.id === "c10") status = "fail";
        if (scenario === "incomplete" && ["c4", "c5", "c6"].includes(criterion.id))
          status = "insufficient-evidence";
        return {
          criterionId: criterion.id,
          status,
          rationale:
            status === "insufficient-evidence"
              ? "The synthetic frozen packet does not contain enough material to assess this criterion."
              : `Deterministic ${scenario} fixture assessment for ${criterion.id}.`,
          evidenceRefs: status === "insufficient-evidence" ? [] : [evidence],
        };
      });
      const limitations = [
        "Deterministic synthetic CI fixture; not a scientific assessment of a real publication.",
      ];
      return {
        criteria,
        limitations,
        executionMetadata: {
          provider: "deterministic-test",
          model: `ora-${scenario}-fixture`,
          modelVersion: "1",
          promptVersion: ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
          attempts: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.001Z",
          structuredOutputSha256: createHash("sha256")
            .update(canonicalJson({ criteria, limitations }))
            .digest("hex"),
        },
      };
    },
  };
}

function firstEvidence(packet: PublicationVersionPacket): CertificationEvidenceReference {
  if (packet.content[0]) return { type: "publication-content-document", id: packet.content[0].id };
  if (packet.occurrences[0])
    return { type: "publication-occurrence", id: packet.occurrences[0].id };
  if (packet.captures[0]) return { type: "capture", id: packet.captures[0].id };
  throw new Error("Synthetic fixture must contain at least one packet evidence object.");
}
