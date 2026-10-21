/** Declarative route keys and source specifiers; only the test capture loader imports handlers. */
export const SCHOLARLY_ROUTES = {
  "api/reviews/[slug]/comments": "@/app/api/reviews/[slug]/comments/route",
  "api/reviews/[slug]/versions/[versionId]/comments":
    "@/app/api/reviews/[slug]/versions/[versionId]/comments/route",
  "api/reviews/[slug]/versions/[versionId]/annotations":
    "@/app/api/reviews/[slug]/versions/[versionId]/annotations/route",
  "api/reviews/[slug]/versions/[versionId]/challenges":
    "@/app/api/reviews/[slug]/versions/[versionId]/challenges/route",
  "api/nodes/[id]/challenges": "@/app/api/nodes/[id]/challenges/route",
  "api/nodes/[id]/exports/challenges.json": "@/app/api/nodes/[id]/exports/challenges.json/route",
  "api/nodes/[id]/exports/challenges-ro-crate":
    "@/app/api/nodes/[id]/exports/challenges-ro-crate/route",
  "api/replications": "@/app/api/replications/route",
  "api/replications/[slug]": "@/app/api/replications/[slug]/route",
  "api/protocols/reviews/[versionId]": "@/app/api/protocols/reviews/[versionId]/route",
} as const;

/** SELECT only. Terminal challenge fixtures avoid the legacy active-key repair UPDATE path. */
export const SCHOLARLY_SELECT_TABLES = [
  "ReviewComment",
  "Challenge",
  "ChallengeTransition",
  "ChallengeResponse",
  "ReplicationBrief",
  "ReplicationBriefClaim",
  "ProtocolSnapshot",
  "ProtocolDriftProposal",
  // Node challenge queries traverse these public containers even for the intentional empty page.
  "NodeEdgeProposal",
  "NodeRelationTrustAssessment",
  "TrustAdjudication",
  "TrustAdjudicationReference",
] as const;
