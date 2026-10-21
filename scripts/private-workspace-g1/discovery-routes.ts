/**
 * Declarative public GET inventory. Actual literal imports belong in the G1
 * `.g1.spec.ts` runner; a root script never imports application internals.
 * `bindDiscoveryRoutes` requires every reviewed route and refuses extra loaders.
 */
export const DISCOVERY_ROUTE_MODULES = {
  "api/graph": "@/app/api/graph/route",
  "api/search": "@/app/api/search/route",
  "api/nodes": "@/app/api/nodes/route",
  "api/nodes/[id]": "@/app/api/nodes/[id]/route",
  "api/nodes/[id]/versions": "@/app/api/nodes/[id]/versions/route",
  "api/nodes/[id]/versions/[versionId]": "@/app/api/nodes/[id]/versions/[versionId]/route",
  "api/nodes/[id]/edges": "@/app/api/nodes/[id]/edges/route",
  "api/claims/[versionId]/[localClaimId]": "@/app/api/claims/[versionId]/[localClaimId]/route",
  "api/landscape": "@/app/api/landscape/route",
  "api/reviews/[slug]": "@/app/api/reviews/[slug]/route",
  "api/reviews/[slug]/versions/[versionId]": "@/app/api/reviews/[slug]/versions/[versionId]/route",
  "api/reviews/[slug]/diff": "@/app/api/reviews/[slug]/diff/route",
  "api/reviews/[slug]/versions/[versionId]/export/[format]":
    "@/app/api/reviews/[slug]/versions/[versionId]/export/[format]/route",
  "api/publications/[id]": "@/app/api/publications/[id]/route",
  "api/publications/[id]/relations": "@/app/api/publications/[id]/relations/route",
  "api/publication-versions/[id]": "@/app/api/publication-versions/[id]/route",
  "api/publication-versions/[id]/content": "@/app/api/publication-versions/[id]/content/route",
  "api/publication-versions/[id]/contributors":
    "@/app/api/publication-versions/[id]/contributors/route",
  "api/publication-versions/[id]/production-provenance":
    "@/app/api/publication-versions/[id]/production-provenance/route",
  "api/publication-claim-occurrences/[id]": "@/app/api/publication-claim-occurrences/[id]/route",
} as const;

export type DiscoveryRoute = keyof typeof DISCOVERY_ROUTE_MODULES;
export type DiscoveryRouteLoaders = Readonly<
  Record<DiscoveryRoute, () => Promise<Record<string, unknown>>>
>;

export function bindDiscoveryRoutes(loaders: DiscoveryRouteLoaders): DiscoveryRouteLoaders {
  const expected = Object.keys(DISCOVERY_ROUTE_MODULES).sort();
  if (JSON.stringify(Object.keys(loaders).sort()) !== JSON.stringify(expected)) {
    throw new Error("Discovery loaders must match the reviewed GET inventory exactly.");
  }
  return loaders;
}

/** Each inventoried file currently exports GET only; tests fail on a new untested method. */
export const DISCOVERY_METHODS = ["GET"] as const;
export const DISCOVERY_OUTSIDE_BATCH = [
  "Other route files and all mutation methods are outside this batch.",
  "Populated protocol, TRUST adjudication, execution-passport and challenge subrecords are not seeded here.",
  "Public serving/pages, private rows, background channels, revocation and deployed caching remain separate evidence.",
] as const;

/** Measured read closure beyond the baseline role; never add write privileges for GET coverage. */
export const DISCOVERY_ADDITIONAL_SELECT_GRANTS = [
  { table: "CertificationResult", reason: "publication version certification-result count" },
  { table: "Challenge", reason: "review scholarly exports challenge read (empty fixture)" },
  {
    table: "ClaimUpdateProposal",
    reason: "claim passport update-proposal projection (empty fixture)",
  },
  { table: "ExecutionPassport", reason: "claim passport execution provenance (empty fixture)" },
  {
    table: "ExecutionPassportClaim",
    reason: "claim-scoped execution-passport membership predicate (empty fixture)",
  },
  {
    table: "Identifier",
    reason: "review and exact-version declared identifier reads (empty fixture)",
  },
  { table: "NodeEdgeProposal", reason: "confirmed node relation TRUST predicate (empty fixture)" },
  {
    table: "NodeIdentityProposal",
    reason: "node detail reviewed identity relationships (empty fixture)",
  },
  {
    table: "NodeRelationTrustAssessment",
    reason: "node detail relation TRUST context (empty fixture)",
  },
  { table: "ProtocolSnapshot", reason: "claim passport protocol provenance (empty fixture)" },
  { table: "PublicationRelation", reason: "explicit reviewed publication relation (one fixture)" },
  { table: "TrustAdjudication", reason: "review/export disagreement-queue read (empty fixture)" },
] as const;

/** Additional synthetic rows after public-fixtures.sql; merge with the reset inventory. */
export const DISCOVERY_FIXTURE_COUNT_DELTAS = {
  Claim: 1,
  NodeEdge: 1,
  Publication: 1,
  PublicationVersion: 1,
  PublicationCapture: 2,
  PublicationVersionContributor: 1,
  PublicationProductionAssertion: 1,
  PublicationClaimOccurrence: 1,
  PublicationRelation: 1,
} as const;
