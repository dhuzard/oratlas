export * from "./text.js";
export * from "./types.js";
export { InProcessSearchProvider, type SearchProvider, type SearchResult } from "./search.js";
export {
  buildEvidencePacket,
  canonicalJson,
  hashEvidencePacket,
  prepareEvidencePacket,
  type BuildPacketOptions,
  type PreparedEvidencePacket,
} from "./packet.js";
export {
  discussDeterministic,
  discussWithLlm,
  buildDiscussionPrompt,
  DISCUSSION_PROMPT_VERSION,
  type LlmProvider,
  type LlmDiscussionResult,
} from "./discuss.js";
export {
  createAnthropicProvider,
  extractJsonObject,
  type AnthropicProviderOptions,
} from "./providers/anthropic.js";
export {
  proposeCrossReviewLinks,
  type LinkProposalDraft,
  type LinkProposerOptions,
} from "./links.js";
export {
  synthesize,
  evidenceFamilies,
  circularCitations,
  differingScopeFields,
  workKey,
  SCOPE_FIELDS,
  type SynthesisCitation,
  type SynthesisStatement,
  type SynthesisResult,
  type StatementSynthesis,
  type IndependenceSummary,
  type ContradictionEntry,
  type ClaimScope,
  type ArchivedReviewDoi,
} from "./synthesis.js";
export {
  rankReplicationGaps,
  REPLICATION_TRIAGE_METHOD,
  REPLICATION_TRIAGE_DISCLAIMER,
  type ReplicationGapCandidate,
  type ReplicationGapSignalCode,
  type RankedReplicationGap,
} from "./replication.js";
export {
  canonicalNodeAlias,
  normalizeClaimIdentity,
  proposeNodeIdentities,
  type NormalizedClaimIdentity,
  type ProposeNodeIdentitiesOptions,
} from "./node-identity.js";
export * from "./node-edge-lifecycle.js";
export {
  buildSubgraphEvidencePacket,
  buildPreparedSubgraphEvidencePacket,
  canonicalizeEvidenceTopic,
  normalizeEvidenceIdentifier,
  fingerprintSubgraphEvidenceSelection,
  SubgraphEvidenceBuildError,
  SUBGRAPH_EVIDENCE_ERROR_CODES,
  type PreparedSubgraphEvidencePacket,
  type SubgraphEvidenceErrorCode,
} from "./subgraph-evidence.js";
