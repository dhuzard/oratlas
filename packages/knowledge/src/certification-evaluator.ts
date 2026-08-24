import type {
  CertificationProtocolDefinition,
  PublicationVersionPacket,
  certificationCriterionResultSchema,
} from "@oratlas/contracts";
import type { z } from "zod";

export interface CertificationEvaluationExecutionMetadata {
  provider: string;
  model: string;
  modelVersion?: string;
  promptVersion: string;
  attempts: number;
  startedAt: string;
  completedAt: string;
  structuredOutputSha256: string;
}

export interface CertificationEvaluation {
  criteria: Array<z.infer<typeof certificationCriterionResultSchema>>;
  limitations: string[];
  executionMetadata: CertificationEvaluationExecutionMetadata;
}

/** Provider- and framework-neutral evaluator boundary. */
export interface CertificationEvaluator {
  evaluate(input: {
    packet: PublicationVersionPacket;
    protocol: CertificationProtocolDefinition;
  }): Promise<CertificationEvaluation>;
}

