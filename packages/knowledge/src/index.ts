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
  extractJsonObject,
  DISCUSSION_PROMPT_VERSION,
  type LlmProvider,
  type LlmJsonCompletionRequest,
  type LlmDiscussionResult,
} from "./discuss.js";
export { createAnthropicProvider, type AnthropicProviderOptions } from "./providers/anthropic.js";
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
export {
  SynthesisWriter,
  SynthesisWriterError,
  SYNTHESIS_WRITER_ERROR_CODES,
  SYNTHESIS_PROMPT_VERSION,
  SYNTHESIS_PIPELINE_VERSION,
  SYNTHESIS_SYSTEM_PROMPT,
  SYNTHESIS_PROMPT_HASH,
  SYNTHESIS_FALLBACK_PROVIDER,
  SYNTHESIS_FALLBACK_MODEL,
  assertCanonicalPreparedPacket,
  buildSynthesisCompletionRequest,
  composeDeterministicSynthesis,
  parseAndValidateSynthesisOutput,
  validateSynthesisGrounding,
  verifySynthesisDocument,
  synthesisSelectionIdentity,
  synthesisGenerationKey,
  type SynthesisWriterErrorCode,
  type SynthesisGroundingIssue,
  type SynthesisGroundingResult,
  type SynthesisRunStart,
  type SynthesisRunRecorder,
  type SynthesisGenerationResult,
} from "./synthesis-writer.js";
export {
  defineGroundingEvalFixture,
  evaluateGroundingFixtures,
  prepareGroundingEvalFixtures,
  GroundingEvalFixtureError,
  GROUNDING_EVAL_LIMITS,
  GROUNDING_EVAL_REPORT_VERSION,
  GROUNDING_EVAL_RUNNER_VERSION,
  GROUNDING_EVAL_OPERATIONAL_ERROR_CODES,
  type GroundingEvalFixture,
  type GroundingEvalRequestAssertions,
  type GroundingEvalCaseResult,
  type GroundingEvalReport,
  type GroundingEvalMode,
  type GroundingEvalExpectedOutcome,
  type GroundingEvalObservedOutcome,
  type GroundingEvalOperationalErrorCode,
  type GroundingEvalOptions,
} from "./grounding-evaluation.js";
