/** Additive, separately reset program; production imports belong in the opt-in runner. */
export const SYNTHESIS_ROUTE_MODULES = {
  "api/federation/notifications/[id]": "@/app/api/federation/notifications/[id]/route",
  "api/syntheses/[slug]": "@/app/api/syntheses/[slug]/route",
  "api/synthesis/contradictions": "@/app/api/synthesis/contradictions/route",
  "api/federation/inbox": "@/app/api/federation/inbox/route",
  "api/search": "@/app/api/search/route",
  "api/feeds/atom": "@/app/api/feeds/atom/route",
  "api/claims/[versionId]/[localClaimId]": "@/app/api/claims/[versionId]/[localClaimId]/route",
} as const;
export const SYNTHESIS_SELECT_TABLES = [
  "AgentRun",
  "SynthesisDraftMembership",
  "SynthesisDraftCitation",
  "SynthesisAttributionContributor",
  "SynthesisStalenessHead",
  "SynthesisStalenessEvaluation",
] as const;
export const SYNTHESIS_FIXTURE_COUNTS = {
  KnowledgeNode: 2,
  KnowledgeNodeVersion: 2,
  AgentRun: 1,
  Review: 1,
  SynthesisDraft: 1,
  ReviewVersion: 1,
  SynthesisDraftMembership: 1,
  SynthesisDraftCitation: 1,
  SynthesisAttributionContributor: 2,
  SynthesisGenerationRequestClaim: 1,
  AuditEvent: 2,
  FederationNotification: 1,
  Claim: 4,
  Citation: 4,
  ClaimEvidenceRelation: 4,
} as const;
export const SYNTHESIS_SLUG = "synthesis-c368583d7cdfc3a55a55";
export const SYNTHESIS_VERSION = "cmvi69rl000097k5d9nezdvby";

/** Fixed integration descriptor; the parent owns reset/grants and reviewed golden dispatch. */
export const SYNTHESIS_PROGRAM = {
  name: "synthesis",
  specFile: "scripts/private-workspace-g1/synthesis-probe.g1.spec.ts",
  outputVariable: "G1_SYNTHESIS_OUT",
  fixtureFile: "scripts/private-workspace-g1/fixtures/synthesis-fixtures.sql",
  captureLabel: "synthesis-probe",
  stateSidecarSuffix: ".state.json",
  fixtureCounts: SYNTHESIS_FIXTURE_COUNTS,
  additionalSelectTables: SYNTHESIS_SELECT_TABLES,
} as const;
