import { type IndependenceSummary } from "./synthesis.js";

export const REPLICATION_TRIAGE_METHOD = "oratlas-replication-triage-1.0";
export const REPLICATION_TRIAGE_DISCLAIMER =
  "Deterministic editorial triage from declared scope, citation independence, and contradiction signals; not a scientific truth score, outcome prediction, or ranking of people.";

export type ReplicationGapSignalCode =
  | "genuine-contradiction"
  | "scope-undeclared-contradiction"
  | "scope-difference"
  | "opposing-evidence"
  | "no-independent-support"
  | "single-independent-family"
  | "duplicated-evidence-family"
  | "circular-citation"
  | "scope-undeclared";

export interface ReplicationGapCandidate {
  claimId: string;
  scopeDeclared: boolean;
  independence: IndependenceSummary;
  contradictions: {
    genuine: number;
    scopeDifference: number;
    undeterminedScope: number;
  };
}

export interface RankedReplicationGap extends ReplicationGapCandidate {
  triageBand:
    "contradiction-attention" | "independence-attention" | "scope-attention" | "routine-attention";
  signals: Array<{ code: ReplicationGapSignalCode; explanation: string }>;
  triagePosition: number;
  method: typeof REPLICATION_TRIAGE_METHOD;
  disclaimer: typeof REPLICATION_TRIAGE_DISCLAIMER;
}

/**
 * Categorize and order evidence gaps without producing a scalar quality or truth score.
 * Every comparison is a documented lexicographic rule over bounded synthesis facts.
 */
export function rankReplicationGaps(candidates: ReplicationGapCandidate[]): RankedReplicationGap[] {
  if (new Set(candidates.map((candidate) => candidate.claimId)).size !== candidates.length) {
    throw new Error("Replication triage claim ids must be unique.");
  }
  const categorized = candidates.map((candidate) => categorize(candidate));
  categorized.sort(compareCandidates);
  return categorized.map((candidate, index) => ({ ...candidate, triagePosition: index + 1 }));
}

function categorize(
  candidate: ReplicationGapCandidate,
): Omit<RankedReplicationGap, "triagePosition"> {
  const signals: RankedReplicationGap["signals"] = [];
  const summary = candidate.independence;
  if (candidate.contradictions.genuine > 0) {
    signals.push({
      code: "genuine-contradiction",
      explanation: `${candidate.contradictions.genuine} scope-matched contradiction pair(s) use shared evidence families in opposing directions.`,
    });
  }
  if (candidate.contradictions.undeterminedScope > 0) {
    signals.push({
      code: "scope-undeclared-contradiction",
      explanation: `${candidate.contradictions.undeterminedScope} opposing pair(s) cannot be scope-classified because scope is undeclared.`,
    });
  }
  if (candidate.contradictions.scopeDifference > 0) {
    signals.push({
      code: "scope-difference",
      explanation: `${candidate.contradictions.scopeDifference} opposing pair(s) declare different comparison scopes and may answer different questions.`,
    });
  }
  if (summary.independentOpposingFamilies > 0) {
    signals.push({
      code: "opposing-evidence",
      explanation: `${summary.independentOpposingFamilies} independent opposing evidence family/families are declared.`,
    });
  }
  if (summary.independentSupportingFamilies === 0) {
    signals.push({
      code: "no-independent-support",
      explanation: "No non-circular independent supporting evidence family is declared.",
    });
  } else if (summary.independentSupportingFamilies === 1) {
    signals.push({
      code: "single-independent-family",
      explanation: "Supporting works collapse to one declared evidence family.",
    });
  }
  if (summary.supportingWorks > summary.independentSupportingFamilies) {
    signals.push({
      code: "duplicated-evidence-family",
      explanation: `${summary.supportingWorks} supporting works collapse to ${summary.independentSupportingFamilies} independent family/families.`,
    });
  }
  if (summary.circularCitationIds.length > 0) {
    signals.push({
      code: "circular-citation",
      explanation: `${summary.circularCitationIds.length} supporting or opposing citation(s) point back into the Atlas corpus and are excluded from independence counts.`,
    });
  }
  if (!candidate.scopeDeclared) {
    signals.push({
      code: "scope-undeclared",
      explanation: "The claim does not declare a structured comparison scope.",
    });
  }

  const hasContradictionAttention =
    candidate.contradictions.genuine > 0 ||
    candidate.contradictions.undeterminedScope > 0 ||
    summary.independentOpposingFamilies > 0;
  const hasIndependenceAttention =
    summary.independentSupportingFamilies <= 1 ||
    summary.supportingWorks > summary.independentSupportingFamilies ||
    summary.circularCitationIds.length > 0;
  const triageBand = hasContradictionAttention
    ? "contradiction-attention"
    : hasIndependenceAttention
      ? "independence-attention"
      : !candidate.scopeDeclared || candidate.contradictions.scopeDifference > 0
        ? "scope-attention"
        : "routine-attention";

  return {
    ...candidate,
    triageBand,
    signals,
    method: REPLICATION_TRIAGE_METHOD,
    disclaimer: REPLICATION_TRIAGE_DISCLAIMER,
  };
}

function compareCandidates(
  left: Omit<RankedReplicationGap, "triagePosition">,
  right: Omit<RankedReplicationGap, "triagePosition">,
): number {
  const bandOrder: Record<RankedReplicationGap["triageBand"], number> = {
    "contradiction-attention": 0,
    "independence-attention": 1,
    "scope-attention": 2,
    "routine-attention": 3,
  };
  return (
    bandOrder[left.triageBand] - bandOrder[right.triageBand] ||
    right.contradictions.genuine - left.contradictions.genuine ||
    right.contradictions.undeterminedScope - left.contradictions.undeterminedScope ||
    right.independence.independentOpposingFamilies -
      left.independence.independentOpposingFamilies ||
    Number(left.independence.independentSupportingFamilies > 0) -
      Number(right.independence.independentSupportingFamilies > 0) ||
    left.independence.independentSupportingFamilies -
      right.independence.independentSupportingFamilies ||
    duplicationCount(right) - duplicationCount(left) ||
    right.independence.circularCitationIds.length - left.independence.circularCitationIds.length ||
    compareText(left.claimId, right.claimId)
  );
}

function duplicationCount(candidate: ReplicationGapCandidate): number {
  return Math.max(
    0,
    candidate.independence.supportingWorks - candidate.independence.independentSupportingFamilies,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
