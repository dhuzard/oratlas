export const POC_CORPUS_ROLES = ["structural-control", "ai-review", "data-release"] as const;
export type PocCorpusRole = (typeof POC_CORPUS_ROLES)[number];

export interface PocEvaluation {
  corpusRole: PocCorpusRole;
  sourceCoverage: string;
  limitations: string[];
  suggestedFixes: string[];
}

const CORPUS_ROLES = new Set<string>(POC_CORPUS_ROLES);

function isPocCorpusRole(value: unknown): value is PocCorpusRole {
  return typeof value === "string" && CORPUS_ROLES.has(value);
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 1_000 ? normalized : undefined;
}

function boundedList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return undefined;
  const entries = value.map(boundedText);
  return entries.every((entry): entry is string => entry !== undefined) ? entries : undefined;
}

/** Fail closed on malformed repository metadata before rendering a POC assessment. */
export function parsePocEvaluation(value: unknown): PocEvaluation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const corpusRole = record.corpusRole;
  const sourceCoverage = boundedText(record.sourceCoverage);
  const limitations = boundedList(record.limitations);
  const suggestedFixes = boundedList(record.suggestedFixes);
  if (!isPocCorpusRole(corpusRole) || !sourceCoverage || !limitations || !suggestedFixes) {
    return undefined;
  }
  return {
    corpusRole,
    sourceCoverage,
    limitations,
    suggestedFixes,
  };
}
