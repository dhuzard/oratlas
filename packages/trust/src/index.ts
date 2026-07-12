import {
  TRUST_CRITERIA,
  trustRecordSchema,
  type AssessmentReviewStatus,
  type TrustCriterion,
  type TrustOrdinal,
  type TrustRecord,
  type TrustVerificationState,
} from "@oratlas/contracts";
import { createHash } from "node:crypto";

export const TRUST_PROTOCOL_VERSION = "trust-poc-1.0";
export const TRUST_SUBJECT_SCHEMA_VERSION = "oratlas-trust-subject-1";

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

export interface NormalizedImportedTrustRecord {
  record: TrustRecord;
  criterionColumns: Partial<Record<TrustCriterion, string>>;
  limitationsJson: string;
  evidenceJson: string | null;
  aggregateScore: number | null;
  aggregateMethod: string;
  reviewStatus: "unverified-import";
  sourceRecordJson: string;
  sourceReviewStatus: AssessmentReviewStatus;
  sourceAssessorType: string;
  sourceAssessorId: string | null;
  sourceAssessedAt: string | null;
  sourceEvidenceJson: string | null;
  sourceAggregateScore: number | null;
  sourceAggregateMethod: string | null;
  sourceRelationHumanReviewed: boolean | null;
}

/** Normalize a repository record without trusting its review assertions. */
export function normalizeImportedTrustRecord(
  input: TrustRecord,
  sourceRelationHumanReviewed: boolean | null,
): NormalizedImportedTrustRecord {
  const record = trustRecordSchema.parse(input);
  const aggregate = computeAggregate(record);
  const criterionColumns: Partial<Record<TrustCriterion, string>> = {};
  for (const criterion of TRUST_CRITERIA) {
    const value = record.criteria[criterion];
    if (value) criterionColumns[criterion] = canonicalJson(value);
  }
  const evidenceJson = record.evidence === undefined ? null : canonicalJson(record.evidence);
  return {
    record,
    criterionColumns,
    limitationsJson: canonicalJson(record.limitations ?? []),
    evidenceJson,
    aggregateScore: aggregate.score,
    aggregateMethod: aggregate.method,
    reviewStatus: "unverified-import",
    sourceRecordJson: canonicalJson({ ...record, sourceRelationHumanReviewed }),
    sourceReviewStatus: record.reviewStatus,
    sourceAssessorType: record.assessorType,
    sourceAssessorId: record.assessorId ?? null,
    sourceAssessedAt: record.assessedAt ?? null,
    sourceEvidenceJson: evidenceJson,
    sourceAggregateScore: record.aggregateScore ?? null,
    sourceAggregateMethod: record.aggregateMethod ?? null,
    sourceRelationHumanReviewed,
  };
}

/** Ordinal comparison helper for filtering (e.g. "at least moderate"). */
export function ordinalAtLeast(rating: TrustOrdinal, threshold: TrustOrdinal): boolean {
  const a = ORDINAL_VALUES[rating];
  const b = ORDINAL_VALUES[threshold];
  if (a === null || b === null) return false;
  return a >= b;
}

/**
 * Exact material reviewed by an Atlas editor. JSON text columns remain text in
 * this structure on purpose: malformed or whitespace-only mutations must also
 * invalidate a verification rather than being silently normalized away.
 */
export interface ReviewedTrustSubjectInput {
  assessment: {
    id: string;
    protocolVersion: string;
    assessorType: string;
    assessorId: string | null;
    assessedAt: string | null;
    criteriaJson: Record<TrustCriterion, string | null>;
    limitationsJson: string;
    evidenceJson: string | null;
    aggregateScore: number | null;
    aggregateMethod: string | null;
    reviewStatus: string;
    sourceRecordJson: string | null;
    sourceReviewStatus: string | null;
    sourceAssessorType: string | null;
    sourceAssessorId: string | null;
    sourceAssessedAt: string | null;
    sourceEvidenceJson: string | null;
    sourceAggregateScore: number | null;
    sourceAggregateMethod: string | null;
    sourceRelationHumanReviewed: boolean | null;
  };
  relation: {
    id: string;
    relationType: string;
    supportDirection: string | null;
    sourceLocation: string | null;
    extractionMethod: string | null;
    extractionConfidence: number | null;
  };
  claim: {
    id: string;
    reviewVersionId: string;
    localClaimId: string;
    text: string;
    normalizedText: string;
    section: string | null;
    anchor: string | null;
    claimType: string | null;
    qualification: string | null;
  };
  citation: {
    id: string;
    reviewVersionId: string;
    localCitationId: string;
    doi: string | null;
    pmid: string | null;
    openAlexId: string | null;
    title: string | null;
    authorsJson: string;
    year: number | null;
    source: string | null;
    url: string | null;
    rawCitationJson: string | null;
  };
}

type DateValue = Date | string | null;

/** Structural database parts accepted from Prisma in seed, service and reads. */
export interface DatabaseTrustSubjectParts {
  assessment: Omit<ReviewedTrustSubjectInput["assessment"], "assessedAt" | "sourceAssessedAt"> & {
    assessedAt: DateValue;
    sourceAssessedAt: DateValue;
  };
  relation: ReviewedTrustSubjectInput["relation"];
  claim: ReviewedTrustSubjectInput["claim"];
  citation: ReviewedTrustSubjectInput["citation"];
}

export interface DatabaseTrustAssessmentRow {
  id: string;
  protocolVersion: string;
  assessorType: string;
  assessorId: string | null;
  assessedAt: DateValue;
  identityIntegrity: string | null;
  entailment: string | null;
  sourceAccess: string | null;
  populationRelevance: string | null;
  interventionExposureRelevance: string | null;
  outcomeRelevance: string | null;
  methodologicalSafeguards: string | null;
  statisticalSafeguards: string | null;
  replicationConvergence: string | null;
  conflictDependency: string | null;
  limitationsJson: string;
  evidenceJson: string | null;
  aggregateScore: number | null;
  aggregateMethod: string | null;
  reviewStatus: string;
  sourceRecordJson: string | null;
  sourceReviewStatus: string | null;
  sourceAssessorType: string | null;
  sourceAssessorId: string | null;
  sourceAssessedAt: DateValue;
  sourceEvidenceJson: string | null;
  sourceAggregateScore: number | null;
  sourceAggregateMethod: string | null;
  sourceRelationHumanReviewed: boolean | null;
}

export interface DatabaseTrustSubjectRows {
  assessment: DatabaseTrustAssessmentRow;
  relation: ReviewedTrustSubjectInput["relation"];
  claim: ReviewedTrustSubjectInput["claim"];
  citation: ReviewedTrustSubjectInput["citation"];
}

function toIso(value: DateValue): string | null {
  if (value === null) return null;
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

/**
 * The only database-to-subject mapper. Keeping it in the TRUST package avoids
 * subtle seed/service/read drift in date or field normalization.
 */
export function trustSubjectInputFromDatabaseParts(
  parts: DatabaseTrustSubjectParts,
): ReviewedTrustSubjectInput {
  return {
    assessment: {
      ...parts.assessment,
      assessedAt: toIso(parts.assessment.assessedAt),
      sourceAssessedAt: toIso(parts.assessment.sourceAssessedAt),
    },
    // Select every field explicitly. Prisma include objects carry nested and
    // incidental properties that must never make hashes depend on query shape.
    relation: {
      id: parts.relation.id,
      relationType: parts.relation.relationType,
      supportDirection: parts.relation.supportDirection,
      sourceLocation: parts.relation.sourceLocation,
      extractionMethod: parts.relation.extractionMethod,
      extractionConfidence: parts.relation.extractionConfidence,
    },
    claim: {
      id: parts.claim.id,
      reviewVersionId: parts.claim.reviewVersionId,
      localClaimId: parts.claim.localClaimId,
      text: parts.claim.text,
      normalizedText: parts.claim.normalizedText,
      section: parts.claim.section,
      anchor: parts.claim.anchor,
      claimType: parts.claim.claimType,
      qualification: parts.claim.qualification,
    },
    citation: {
      id: parts.citation.id,
      reviewVersionId: parts.citation.reviewVersionId,
      localCitationId: parts.citation.localCitationId,
      doi: parts.citation.doi,
      pmid: parts.citation.pmid,
      openAlexId: parts.citation.openAlexId,
      title: parts.citation.title,
      authorsJson: parts.citation.authorsJson,
      year: parts.citation.year,
      source: parts.citation.source,
      url: parts.citation.url,
      rawCitationJson: parts.citation.rawCitationJson,
    },
  };
}

export function trustSubjectInputFromDatabaseRows(
  rows: DatabaseTrustSubjectRows,
): ReviewedTrustSubjectInput {
  const assessment = rows.assessment;
  return trustSubjectInputFromDatabaseParts({
    assessment: {
      id: assessment.id,
      protocolVersion: assessment.protocolVersion,
      assessorType: assessment.assessorType,
      assessorId: assessment.assessorId,
      assessedAt: assessment.assessedAt,
      criteriaJson: {
        identityIntegrity: assessment.identityIntegrity,
        entailment: assessment.entailment,
        sourceAccess: assessment.sourceAccess,
        populationRelevance: assessment.populationRelevance,
        interventionExposureRelevance: assessment.interventionExposureRelevance,
        outcomeRelevance: assessment.outcomeRelevance,
        methodologicalSafeguards: assessment.methodologicalSafeguards,
        statisticalSafeguards: assessment.statisticalSafeguards,
        replicationConvergence: assessment.replicationConvergence,
        conflictDependency: assessment.conflictDependency,
      },
      limitationsJson: assessment.limitationsJson,
      evidenceJson: assessment.evidenceJson,
      aggregateScore: assessment.aggregateScore,
      aggregateMethod: assessment.aggregateMethod,
      reviewStatus: assessment.reviewStatus,
      sourceRecordJson: assessment.sourceRecordJson,
      sourceReviewStatus: assessment.sourceReviewStatus,
      sourceAssessorType: assessment.sourceAssessorType,
      sourceAssessorId: assessment.sourceAssessorId,
      sourceAssessedAt: assessment.sourceAssessedAt,
      sourceEvidenceJson: assessment.sourceEvidenceJson,
      sourceAggregateScore: assessment.sourceAggregateScore,
      sourceAggregateMethod: assessment.sourceAggregateMethod,
      sourceRelationHumanReviewed: assessment.sourceRelationHumanReviewed,
    },
    relation: rows.relation,
    claim: rows.claim,
    citation: rows.citation,
  });
}

/** Produce the single canonical reviewed-subject representation used everywhere. */
export function createReviewedTrustSubject(input: ReviewedTrustSubjectInput) {
  return {
    schemaVersion: TRUST_SUBJECT_SCHEMA_VERSION,
    assessment: input.assessment,
    relation: input.relation,
    claim: input.claim,
    citation: input.citation,
  } as const;
}

/** RFC-8785-like deterministic JSON for plain JSON-compatible values. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot encode non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
}

export function reviewedTrustSubjectHash(input: ReviewedTrustSubjectInput): string {
  return createHash("sha256")
    .update(canonicalJson(createReviewedTrustSubject(input)))
    .digest("hex");
}

export type { TrustVerificationState };

export interface TrustVerificationMarker {
  status: string;
  assessmentHash: string;
}

export interface ResolvedTrustVerification {
  effectiveStatus: AssessmentReviewStatus;
  state: TrustVerificationState;
  currentHash: string;
}

/** A marker is public only while it matches the current canonical subject. */
export function resolveTrustVerification(
  subject: ReviewedTrustSubjectInput,
  marker: TrustVerificationMarker | null | undefined,
): ResolvedTrustVerification {
  const currentHash = reviewedTrustSubjectHash(subject);
  const legacy =
    subject.assessment.sourceRecordJson === null ||
    subject.assessment.reviewStatus !== "unverified-import";
  if (!marker) {
    return {
      effectiveStatus: "unverified-import",
      state: legacy ? "legacy-unknown" : "unverified-import",
      currentHash,
    };
  }
  if (
    marker.assessmentHash !== currentHash ||
    (marker.status !== "human-reviewed" && marker.status !== "adjudicated")
  ) {
    return { effectiveStatus: "unverified-import", state: "stale-verification", currentHash };
  }
  return {
    effectiveStatus: marker.status,
    state: "platform-verified",
    currentHash,
  };
}

export interface PublicTrustCandidate<T = unknown> {
  id: string;
  effectiveStatus: AssessmentReviewStatus;
  assessedAt: string | null;
  value: T;
}

const STATUS_PRECEDENCE: Record<AssessmentReviewStatus, number> = {
  adjudicated: 5,
  "human-reviewed": 4,
  "unverified-import": 3,
  "agent-proposed": 2,
  superseded: 1,
};

/** Stable choice when a relation carries multiple assessments. */
export function selectPreferredTrustAssessment<T>(
  candidates: PublicTrustCandidate<T>[],
): PublicTrustCandidate<T> | undefined {
  return [...candidates].sort((left, right) => {
    const status =
      STATUS_PRECEDENCE[right.effectiveStatus] - STATUS_PRECEDENCE[left.effectiveStatus];
    if (status !== 0) return status;
    const time = (right.assessedAt ?? "").localeCompare(left.assessedAt ?? "");
    if (time !== 0) return time;
    return left.id.localeCompare(right.id);
  })[0];
}

export { TRUST_CRITERIA };
export type { TrustCriterion, TrustOrdinal, TrustRecord };
