import {
  TRUST_CRITERIA,
  EXPLICIT_TRUST_ORDINALS,
  nodeRelationTrustRecordSchema,
  trustDisagreementInputSchema,
  trustDisagreementReportSchema,
  trustAssessmentRecordSchema,
  trustRecordSchema,
  type AssessmentReviewStatus,
  type NodeRelationTrustRecord,
  type TrustAssessmentRecord,
  type TrustCriterion,
  type TrustDisagreementInput,
  type TrustDisagreementReport,
  type TrustOrdinal,
  type TrustRecord,
  type TrustVerificationState,
} from "@oratlas/contracts";
import { createHash } from "node:crypto";

export const TRUST_PROTOCOL_VERSION = "trust-poc-1.0";
export const TRUST_SUBJECT_SCHEMA_VERSION = "oratlas-trust-subject-1";
export const TRUST_NODE_RELATION_SUBJECT_SCHEMA_VERSION = "oratlas-trust-node-relation-subject-1";

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

export interface TrustAssessmentValidationResult {
  ok: boolean;
  record?: TrustAssessmentRecord;
  errors: string[];
}

/** Validate the legacy claim-citation or relation-scoped node artifact form. */
export function validateTrustAssessmentRecord(value: unknown): TrustAssessmentValidationResult {
  const parsed = trustAssessmentRecordSchema.safeParse(value);
  if (parsed.success) return { ok: true, record: parsed.data, errors: [] };
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
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
export function computeAggregate(record: TrustAssessmentRecord): AggregateResult {
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
  record: TrustRecord & { conflictOfInterest: { status: "none-declared" | "conflict-declared" | "not-provided" } };
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

export type NormalizedImportedNodeRelationTrustRecord = Omit<
  NormalizedImportedTrustRecord,
  "record"
> & {
  record: NodeRelationTrustRecord & {
    conflictOfInterest: { status: "none-declared" | "conflict-declared" | "not-provided" };
  };
};

/** Normalize a repository record without trusting its review assertions. */
export function normalizeImportedTrustRecord(
  input: TrustRecord,
  sourceRelationHumanReviewed: boolean | null,
): NormalizedImportedTrustRecord {
  const parsed = trustRecordSchema.parse(input);
  const record = {
    ...parsed,
    conflictOfInterest: parsed.conflictOfInterest ?? { status: "not-provided" as const },
  };
  return normalizeImportedRecord(record, sourceRelationHumanReviewed, true);
}

/**
 * Normalize a repository assertion about a claim-to-node evidence relation.
 * Source review claims are retained as provenance but can never promote the
 * imported public state.
 */
export function normalizeImportedNodeRelationTrustRecord(
  input: NodeRelationTrustRecord,
): NormalizedImportedNodeRelationTrustRecord {
  const parsed = nodeRelationTrustRecordSchema.parse(input);
  const record = {
    ...parsed,
    conflictOfInterest: parsed.conflictOfInterest ?? { status: "not-provided" as const },
  };
  return normalizeImportedRecord(record, null, false);
}

function normalizeImportedRecord<T extends TrustAssessmentRecord>(
  record: T,
  sourceRelationHumanReviewed: boolean | null,
  includeLegacyRelationAssertion: boolean,
): Omit<NormalizedImportedTrustRecord, "record"> & { record: T } {
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
    sourceRecordJson: canonicalJson(
      includeLegacyRelationAssertion ? { ...record, sourceRelationHumanReviewed } : record,
    ),
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

export type CrossAssessmentOperation = "selection" | "aggregation" | "comparison" | "disagreement";

/**
 * TRUST is the fixed protocol family; its version is an opaque exact string.
 * No caller may compare, select, aggregate, or adjudicate across versions
 * unless an explicit editorial crosswalk is introduced in the future.
 */
export function assertSingleAssessmentProtocol(
  operation: CrossAssessmentOperation,
  assessments: readonly { protocolVersion: string }[],
): string | undefined {
  const protocolVersion = assessments[0]?.protocolVersion;
  if (assessments.some((assessment) => assessment.protocolVersion !== protocolVersion)) {
    throw new Error(`${operation} requires one exact TRUST protocol version.`);
  }
  return protocolVersion;
}

/**
 * Compare every TRUST criterion across one exact protocol version. Differing
 * explicit assessed ordinals are disagreements; absent and non-assessed values
 * remain coverage gaps and never become synthetic ratings.
 */
export function detectTrustCriterionDisagreements(
  input: TrustDisagreementInput,
): TrustDisagreementReport {
  const parsed = trustDisagreementInputSchema.parse(input);
  const assessments = [...parsed.assessments].sort((left, right) =>
    compareTrustCodeUnits(left.assessmentId, right.assessmentId),
  );
  const protocolVersion = assertSingleAssessmentProtocol("disagreement", assessments) ?? null;
  const disagreements: TrustDisagreementReport["disagreements"] = [];
  const coverageGaps: TrustDisagreementReport["coverageGaps"] = [];

  for (const criterion of TRUST_CRITERIA) {
    const ratingAssessmentIds = new Map<string, string[]>();
    const gaps: TrustDisagreementReport["coverageGaps"][number]["gaps"] = [];

    for (const assessment of assessments) {
      const value = assessment.criteria.find((candidate) => candidate.criterion === criterion);
      if (!value) {
        gaps.push({ assessmentId: assessment.assessmentId, reason: "missing" });
      } else if (value.status === "assessed") {
        const ids = ratingAssessmentIds.get(value.rating) ?? [];
        ids.push(assessment.assessmentId);
        ratingAssessmentIds.set(value.rating, ids);
      } else {
        gaps.push({ assessmentId: assessment.assessmentId, reason: value.status });
      }
    }

    if (ratingAssessmentIds.size > 1) {
      disagreements.push({
        criterion,
        ratings: EXPLICIT_TRUST_ORDINALS.flatMap((rating) => {
          const assessmentIds = ratingAssessmentIds.get(rating);
          return assessmentIds ? [{ rating, assessmentIds }] : [];
        }),
      });
    }
    if (gaps.length > 0) coverageGaps.push({ criterion, gaps });
  }

  return trustDisagreementReportSchema.parse({
    protocolVersion,
    assessmentIds: assessments.map(({ assessmentId }) => assessmentId),
    disagreements,
    coverageGaps,
  });
}

export interface ProtocolTrustOrdinal {
  protocolVersion: string;
  rating: TrustOrdinal;
}

/** Protocol-aware ordinal comparison helper (e.g. "at least moderate"). */
export function ordinalAtLeast(
  rating: ProtocolTrustOrdinal,
  threshold: ProtocolTrustOrdinal,
): boolean {
  assertSingleAssessmentProtocol("comparison", [rating, threshold]);
  const a = ORDINAL_VALUES[rating.rating];
  const b = ORDINAL_VALUES[threshold.rating];
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
    conflictOfInterestStatus?: string;
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

/** Exact immutable claim-to-evidence node relation reviewed by an Atlas editor. */
export type ReviewedNodeRelationAssessmentInput = Omit<
  ReviewedTrustSubjectInput["assessment"],
  "sourceRelationHumanReviewed"
>;

export interface ReviewedNodeRelationTrustSubjectInput {
  assessment: ReviewedNodeRelationAssessmentInput;
  importedRecord: NodeRelationTrustRecord;
  proposal: {
    id: string;
    originKey: string;
    sourceStableKey: string;
    targetStableKey: string;
    relationType: string;
    sourceNodeVersionId: string;
    targetNodeId: string;
    targetNodeVersionId: string;
    origin: string;
    rationale: string | null;
    evidenceJson: string;
    sourceSubmissionId: string | null;
    inspectionCaptureId: string | null;
    status: string;
    revision: number;
    reviewedById: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
    confirmedEdgeId: string | null;
  };
  confirmedEdge: {
    id: string;
    sourceNodeVersionId: string;
    targetNodeId: string;
    relationType: string;
    status: string;
    provenance: string;
    rationale: string | null;
    assertedAt: string | null;
    confirmedTargetNodeVersionId: string | null;
    confirmedById: string | null;
    confirmedAt: string | null;
    revision: number;
    confirmerRole: string | null;
  } | null;
  claimNode: ReviewedNodeVersionInput & { kind: "claim" };
  evidenceNode: ReviewedNodeVersionInput & { kind: "dataset" | "code" | "figure" };
}

export interface ReviewedNodeVersionInput {
  version: {
    id: string;
    knowledgeNodeId: string;
    snapshotId: string;
    sourceSubmissionId: string | null;
    inspectionCaptureId: string | null;
    capturePayloadHash: string | null;
    title: string;
    abstract: string | null;
    text: string | null;
    contributorsJson: string;
    license: string;
    payloadJson: string;
    provenanceJson: string;
    versionDoi: string | null;
    conceptDoi: string | null;
    isExample: boolean;
  };
  node: {
    id: string;
    repositoryId: string;
    localNodeId: string;
    kind: string;
  };
  repository: {
    id: string;
    githubRepositoryId: string | null;
    canonicalUrl: string;
  };
  snapshot: {
    id: string;
    repositoryId: string;
    commitSha: string;
    sourceTreeSha: string | null;
    sourceKind: string | null;
    inspectionStatus: string;
    contentHash: string;
  };
  inspectionCapture: {
    id: string;
    payloadHash: string;
    githubRepositoryId: string;
    commitSha: string;
  } | null;
  sourceSubmission: {
    id: string;
    repositoryId: string;
    snapshotId: string | null;
    inspectionCaptureId: string | null;
    submittedPayloadHash: string | null;
    acceptedNodeSelectionHash: string | null;
  } | null;
}

export interface DatabaseNodeRelationTrustSubjectRows {
  assessment: ReviewedNodeRelationAssessmentInput;
  proposal: ReviewedNodeRelationTrustSubjectInput["proposal"];
  confirmedEdge: ReviewedNodeRelationTrustSubjectInput["confirmedEdge"];
  claimNode: ReviewedNodeRelationTrustSubjectInput["claimNode"];
  evidenceNode: ReviewedNodeRelationTrustSubjectInput["evidenceNode"];
}

/** Validate and map one exact persisted node-relation assessment subject. */
export function nodeRelationTrustSubjectInputFromDatabaseRows(
  rows: DatabaseNodeRelationTrustSubjectRows,
): ReviewedNodeRelationTrustSubjectInput {
  let sourceValue: unknown;
  try {
    sourceValue = JSON.parse(rows.assessment.sourceRecordJson ?? "null");
  } catch {
    throw new TypeError("Node-relation TRUST source record is not valid JSON.");
  }
  const importedRecord = nodeRelationTrustRecordSchema.parse(sourceValue);
  const subject = importedRecord.subject;
  if (
    !rows.claimNode.repository.githubRepositoryId ||
    !rows.evidenceNode.repository.githubRepositoryId
  ) {
    throw new TypeError("Node-relation TRUST requires immutable repository GitHub identities.");
  }
  const expectedSourceStableKey = canonicalJson({
    githubRepositoryId: rows.claimNode.repository.githubRepositoryId,
    localNodeId: rows.claimNode.node.localNodeId,
    commitSha: rows.claimNode.snapshot.commitSha.toLowerCase(),
  });
  const expectedTargetStableKey = canonicalJson({
    githubRepositoryId: rows.evidenceNode.repository.githubRepositoryId,
    localNodeId: rows.evidenceNode.node.localNodeId,
    commitSha: rows.evidenceNode.snapshot.commitSha.toLowerCase(),
  });
  if (
    rows.proposal.origin !== "asserted-by-author" ||
    rows.proposal.sourceNodeVersionId !== rows.claimNode.version.id ||
    rows.proposal.targetNodeVersionId !== rows.evidenceNode.version.id ||
    rows.proposal.targetNodeId !== rows.evidenceNode.node.id ||
    rows.claimNode.version.knowledgeNodeId !== rows.claimNode.node.id ||
    rows.evidenceNode.version.knowledgeNodeId !== rows.evidenceNode.node.id ||
    rows.claimNode.node.localNodeId !== subject.claimNodeId ||
    rows.evidenceNode.node.localNodeId !== subject.evidenceNodeId ||
    rows.claimNode.node.kind !== "claim" ||
    rows.evidenceNode.node.kind !== subject.evidenceKind ||
    rows.proposal.relationType !== subject.relationType ||
    rows.proposal.sourceStableKey !== expectedSourceStableKey ||
    rows.proposal.targetStableKey !== expectedTargetStableKey
  ) {
    throw new TypeError("Imported TRUST record does not match its exact persisted node relation.");
  }
  const targetRepository = subject.evidenceRepository;
  if (
    targetRepository &&
    (rows.evidenceNode.repository.githubRepositoryId !== targetRepository.githubRepositoryId ||
      rows.evidenceNode.snapshot.commitSha !== targetRepository.commitSha)
  ) {
    throw new TypeError("Imported TRUST cross-repository target identity does not match.");
  }
  if (
    !targetRepository &&
    (rows.claimNode.repository.id !== rows.evidenceNode.repository.id ||
      rows.claimNode.snapshot.id !== rows.evidenceNode.snapshot.id ||
      rows.claimNode.snapshot.commitSha !== rows.evidenceNode.snapshot.commitSha)
  ) {
    throw new TypeError("A local TRUST relation cannot resolve to another repository.");
  }
  return { ...rows, importedRecord };
}

export function isAuthoritativeNodeRelationTrustSubject(
  input: ReviewedNodeRelationTrustSubjectInput,
): boolean {
  const edge = input.confirmedEdge;
  return Boolean(
    input.proposal.status === "confirmed" &&
    edge &&
    input.proposal.confirmedEdgeId === edge.id &&
    edge.status === "confirmed" &&
    edge.provenance === "confirmed-by-editor" &&
    edge.sourceNodeVersionId === input.claimNode.version.id &&
    edge.targetNodeId === input.evidenceNode.node.id &&
    edge.confirmedTargetNodeVersionId === input.evidenceNode.version.id &&
    edge.relationType === input.proposal.relationType &&
    edge.confirmedById &&
    edge.confirmedAt &&
    (edge.confirmerRole === "EDITOR" || edge.confirmerRole === "ADMIN") &&
    input.evidenceNode.version.knowledgeNodeId === edge.targetNodeId,
  );
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
  conflictOfInterestStatus?: string;
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
      conflictOfInterestStatus: assessment.conflictOfInterestStatus ?? "not-provided",
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
    assessment: {
      ...input.assessment,
      conflictOfInterestStatus: input.assessment.conflictOfInterestStatus ?? "not-provided",
    },
    relation: input.relation,
    claim: input.claim,
    citation: input.citation,
  } as const;
}

/**
 * Produce the canonical node-relation subject. Endpoint consistency is checked
 * here so callers cannot accidentally hash an assessment detached from its
 * relation or attach it to a bare evidence node.
 */
export function createReviewedNodeRelationTrustSubject(
  input: ReviewedNodeRelationTrustSubjectInput,
) {
  if (
    !input.claimNode.repository.githubRepositoryId ||
    !input.evidenceNode.repository.githubRepositoryId
  ) {
    throw new TypeError("TRUST node relations require immutable repository GitHub identities.");
  }
  const exactSourceStableKey = canonicalJson({
    githubRepositoryId: input.claimNode.repository.githubRepositoryId,
    localNodeId: input.claimNode.node.localNodeId,
    commitSha: input.claimNode.snapshot.commitSha.toLowerCase(),
  });
  const exactTargetStableKey = canonicalJson({
    githubRepositoryId: input.evidenceNode.repository.githubRepositoryId,
    localNodeId: input.evidenceNode.node.localNodeId,
    commitSha: input.evidenceNode.snapshot.commitSha.toLowerCase(),
  });
  if (
    input.proposal.sourceStableKey !== exactSourceStableKey ||
    input.proposal.targetStableKey !== exactTargetStableKey
  ) {
    throw new TypeError("TRUST node relation stable keys do not match their immutable endpoints.");
  }
  if (input.claimNode.kind !== "claim" || input.claimNode.node.kind !== "claim") {
    throw new TypeError("TRUST node relations must originate at a claim node version.");
  }
  if (!(["dataset", "code", "figure"] as const).includes(input.evidenceNode.kind)) {
    throw new TypeError("TRUST node relation evidence must be dataset, code, or figure.");
  }
  if (input.evidenceNode.node.kind !== input.evidenceNode.kind) {
    throw new TypeError("TRUST evidence node kind must match its stable node identity.");
  }
  if (
    input.proposal.sourceNodeVersionId !== input.claimNode.version.id ||
    input.proposal.targetNodeVersionId !== input.evidenceNode.version.id ||
    input.proposal.targetNodeId !== input.evidenceNode.node.id
  ) {
    throw new TypeError("TRUST node relation endpoints must match both immutable node versions.");
  }
  const imported = input.importedRecord.subject;
  if (
    imported.claimNodeId !== input.claimNode.node.localNodeId ||
    imported.evidenceNodeId !== input.evidenceNode.node.localNodeId ||
    imported.evidenceKind !== input.evidenceNode.kind ||
    imported.relationType !== input.proposal.relationType
  ) {
    throw new TypeError("TRUST imported subject must match the persisted proposal exactly.");
  }
  if (
    imported.evidenceRepository &&
    (imported.evidenceRepository.githubRepositoryId !==
      input.evidenceNode.repository.githubRepositoryId ||
      imported.evidenceRepository.commitSha !== input.evidenceNode.snapshot.commitSha)
  ) {
    throw new TypeError("TRUST imported cross-repository identity must match the evidence node.");
  }
  if (
    !imported.evidenceRepository &&
    (input.claimNode.repository.id !== input.evidenceNode.repository.id ||
      input.claimNode.snapshot.id !== input.evidenceNode.snapshot.id)
  ) {
    throw new TypeError("TRUST local evidence must use the claim's exact repository snapshot.");
  }
  const validRelation =
    input.proposal.relationType === "derives-from" ||
    (input.evidenceNode.kind === "dataset" && input.proposal.relationType === "uses-dataset") ||
    (input.evidenceNode.kind === "code" && input.proposal.relationType === "uses-code");
  if (!validRelation) {
    throw new TypeError(
      `TRUST ${input.evidenceNode.kind} evidence cannot use ${input.proposal.relationType}.`,
    );
  }
  return {
    schemaVersion: TRUST_NODE_RELATION_SUBJECT_SCHEMA_VERSION,
    assessment: {
      ...input.assessment,
      conflictOfInterestStatus: input.assessment.conflictOfInterestStatus ?? "not-provided",
    },
    importedRecord: input.importedRecord,
    proposal: input.proposal,
    confirmedEdge: input.confirmedEdge,
    claimNode: input.claimNode,
    evidenceNode: input.evidenceNode,
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

export function reviewedNodeRelationTrustSubjectHash(
  input: ReviewedNodeRelationTrustSubjectInput,
): string {
  return createHash("sha256")
    .update(canonicalJson(createReviewedNodeRelationTrustSubject(input)))
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
  return resolveVerificationForHash(
    currentHash,
    subject.assessment.sourceRecordJson === null ||
      subject.assessment.reviewStatus !== "unverified-import",
    marker,
  );
}

/** Node-relation counterpart using the same fail-closed marker semantics. */
export function resolveNodeRelationTrustVerification(
  subject: ReviewedNodeRelationTrustSubjectInput,
  marker: TrustVerificationMarker | null | undefined,
): ResolvedTrustVerification {
  const currentHash = reviewedNodeRelationTrustSubjectHash(subject);
  if (!isAuthoritativeNodeRelationTrustSubject(subject)) {
    return {
      effectiveStatus: "unverified-import",
      state: marker ? "stale-verification" : "unverified-import",
      currentHash,
    };
  }
  return resolveVerificationForHash(
    currentHash,
    subject.assessment.sourceRecordJson === null ||
      subject.assessment.reviewStatus !== "unverified-import",
    marker,
  );
}

function resolveVerificationForHash(
  currentHash: string,
  legacy: boolean,
  marker: TrustVerificationMarker | null | undefined,
): ResolvedTrustVerification {
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

export interface PublicTrustAssessment<T = unknown> {
  id: string;
  assessedAt: string | null;
  assessorType: string;
  assessorId: string | null;
  protocolVersion: string;
  value: T;
}

/** Locale-independent UTF-16 code-unit ordering for reproducible projections. */
export function compareTrustCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Stable display order for a complete assessment set. The ordering deliberately
 * excludes ratings, aggregate values, review status, and verification state so
 * that position can never imply that one assessment won.
 */
export function orderTrustAssessments<T>(
  assessments: readonly PublicTrustAssessment<T>[],
): PublicTrustAssessment<T>[] {
  return [...assessments].sort((left, right) => {
    const time = compareTrustCodeUnits(left.assessedAt ?? "", right.assessedAt ?? "");
    if (time !== 0) return time;
    const assessorType = compareTrustCodeUnits(left.assessorType, right.assessorType);
    if (assessorType !== 0) return assessorType;
    const assessorId = compareTrustCodeUnits(left.assessorId ?? "", right.assessorId ?? "");
    if (assessorId !== 0) return assessorId;
    const protocol = compareTrustCodeUnits(left.protocolVersion, right.protocolVersion);
    if (protocol !== 0) return protocol;
    return compareTrustCodeUnits(left.id, right.id);
  });
}

export interface AssessmentSourceIdentity {
  sourceRecordHash: string;
  sourceLineageKey: string;
}

/**
 * Identity used by database ingestion. Exact canonical source bytes are
 * idempotent; a changed record from the same subject/assessor/protocol lineage
 * is a new assessment that may point back to the preceding row.
 */
export function assessmentSourceIdentity(record: TrustAssessmentRecord): AssessmentSourceIdentity {
  const parsed = trustAssessmentRecordSchema.parse(record);
  const sourceRecordHash = createHash("sha256").update(canonicalJson(parsed)).digest("hex");
  const subject =
    "subjectType" in parsed
      ? parsed.subject
      : { claimId: parsed.claimId, citationId: parsed.citationId };
  const sourceLineageKey = createHash("sha256")
    .update(
      canonicalJson({
        subject,
        assessorType: parsed.assessorType,
        assessorId: parsed.assessorId ?? null,
        protocolVersion: parsed.protocolVersion,
      }),
    )
    .digest("hex");
  return { sourceRecordHash, sourceLineageKey };
}

export { TRUST_CRITERIA };
export type { TrustCriterion, TrustOrdinal, TrustRecord };
