import type {
  CertificationCriterionResult,
  CertificationProtocolDefinition,
  PublicationVersionPacket,
} from "@oratlas/contracts";

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
  criteria: CertificationCriterionResult[];
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
