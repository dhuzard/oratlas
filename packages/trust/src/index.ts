import {
  TRUST_CRITERIA,
  trustRecordSchema,
  type TrustCriterion,
  type TrustOrdinal,
  type TrustRecord,
} from "@oratlas/contracts";

export const TRUST_PROTOCOL_VERSION = "trust-poc-1.0";

/**
 * TRUST is a transparent, multidimensional assessment of a specific
 * claim–citation relation. It is NEVER the probability that a paper is true and
 * NEVER a single universal score for a whole paper (spec §11).
 */

export interface TrustValidationResult {
  ok: boolean;
  record?: TrustRecord;
  errors: string[];
}

export function validateTrustRecord(value: unknown): TrustValidationResult {
  const parsed = trustRecordSchema.safeParse(value);
  if (parsed.success) return { ok: true, record: parsed.data, errors: [] };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/**
 * Ordinal → numeric mapping used ONLY for the optional aggregate. The aggregate
 * is advisory; the criterion-level record is authoritative. Any displayed
 * aggregate must carry this method identifier.
 */
export const ORDINAL_MEAN_METHOD = "ordinal-mean-1.0";

const ORDINAL_VALUES: Record<TrustOrdinal, number | null> = {
  "very-low": 0,
  low: 0.25,
  moderate: 0.5,
  high: 0.75,
  "very-high": 1,
  "not-assessed": null,
  "not-applicable": null,
};

export interface AggregateResult {
  score: number | null;
  method: string;
  assessedCriteria: TrustCriterion[];
  skippedCriteria: TrustCriterion[];
}

/**
 * Compute an optional aggregate as the mean of assessed ordinal criteria.
 * Criteria rated `not-assessed`/`not-applicable` are excluded (not treated as
 * zero). Returns null when nothing was assessed.
 */
export function computeAggregate(record: TrustRecord): AggregateResult {
  const assessed: TrustCriterion[] = [];
  const skipped: TrustCriterion[] = [];
  const values: number[] = [];

  for (const criterion of TRUST_CRITERIA) {
    const entry = record.criteria[criterion];
    if (!entry) continue;
    const num = ORDINAL_VALUES[entry.rating];
    if (entry.status === "assessed" && num !== null) {
      assessed.push(criterion);
      values.push(num);
    } else {
      skipped.push(criterion);
    }
  }

  const score = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    score: score === null ? null : Math.round(score * 100) / 100,
    method: ORDINAL_MEAN_METHOD,
    assessedCriteria: assessed,
    skippedCriteria: skipped,
  };
}

/** Ordinal comparison helper for filtering (e.g. "at least moderate"). */
export function ordinalAtLeast(rating: TrustOrdinal, threshold: TrustOrdinal): boolean {
  const a = ORDINAL_VALUES[rating];
  const b = ORDINAL_VALUES[threshold];
  if (a === null || b === null) return false;
  return a >= b;
}

export { TRUST_CRITERIA };
export type { TrustCriterion, TrustOrdinal, TrustRecord };
