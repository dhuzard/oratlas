import {
  claimDomAnchor,
  globalCitationId,
  globalClaimId,
  type CanonicalWorkAlias,
} from "@oratlas/contracts";
import { type KnowledgeIndexData } from "./types.js";

const replayClaim1 = globalClaimId("rv1", "c-replay-1");
const replayClaim2 = globalClaimId("rv1", "c-replay-2");
const attentionClaim1 = globalClaimId("rv2", "c-attn-1");
const replaySharedCitation = globalCitationId("rv1", "ref-shared");
const replayContradictionCitation = globalCitationId("rv1", "ref-contra");
const attentionSharedCitation = globalCitationId("rv2", "ref-shared");
const sharedWorkAliases: CanonicalWorkAlias[] = ["doi:10.5555/oratlas.example.shared"];

/** Two accepted reviews with overlapping evidence, for knowledge-layer tests. */
export const sampleIndex: KnowledgeIndexData = {
  reviews: [
    {
      reviewSlug: "replay-review",
      reviewId: "r1",
      reviewVersionId: "rv1",
      title: "Hippocampal Replay and Memory Consolidation",
      abstract: "Replay during sleep supports memory consolidation.",
      keywords: ["hippocampus", "replay", "memory"],
      domains: ["Neuroscience"],
      authors: ["Ada Rivera", "Kenji Watanabe"],
      acceptedAt: "2026-06-15T00:00:00Z",
      updatedAt: "2026-06-15T00:00:00Z",
      publicationYear: 2026,
      commitSha: "a".repeat(40),
      versionDoi: "10.5555/oratlas.example.replay",
      hasDoi: true,
      hasTrustData: true,
      hasEvidenceData: true,
      hasHumanReviewedTrust: true,
      compatibilityLevel: "compatible",
      status: "published",
    },
    {
      reviewSlug: "attention-review",
      reviewId: "r2",
      reviewVersionId: "rv2",
      title: "Cortical Oscillations and Selective Attention",
      abstract: "Gamma synchrony increases with attention.",
      keywords: ["attention", "gamma", "memory"],
      domains: ["Neuroscience"],
      authors: ["Lena Fischer"],
      acceptedAt: "2026-06-10T00:00:00Z",
      updatedAt: "2026-06-10T00:00:00Z",
      publicationYear: 2026,
      commitSha: "b".repeat(40),
      hasDoi: false,
      hasTrustData: true,
      hasEvidenceData: true,
      hasHumanReviewedTrust: false,
      compatibilityLevel: "partially-compatible",
      status: "published",
    },
  ],
  claims: [
    {
      claimId: replayClaim1,
      localClaimId: "c-replay-1",
      reviewSlug: "replay-review",
      reviewId: "r1",
      reviewVersionId: "rv1",
      reviewTitle: "Hippocampal Replay and Memory Consolidation",
      text: "Sharp-wave ripple replay during sleep supports consolidation of spatial memory.",
      section: "Results",
      anchor: claimDomAnchor("rv1", "c-replay-1"),
      sourceAnchor: "sec-replay",
      claimType: "empirical",
      commitSha: "a".repeat(40),
      versionDoi: "10.5555/oratlas.example.replay",
      relations: [
        {
          citationId: replaySharedCitation,
          relationType: "supports",
          trust: {
            reviewStatus: "human-reviewed",
            verificationState: "platform-verified",
            aggregateScore: 0.82,
            aggregateMethod: "ordinal-mean-1.0",
            notableCriteria: ["entailment"],
          },
        },
      ],
    },
    {
      claimId: replayClaim2,
      localClaimId: "c-replay-2",
      reviewSlug: "replay-review",
      reviewId: "r1",
      reviewVersionId: "rv1",
      reviewTitle: "Hippocampal Replay and Memory Consolidation",
      text: "Replay is strictly veridical reverse-order replay of the most recent trajectory.",
      section: "Discussion",
      anchor: claimDomAnchor("rv1", "c-replay-2"),
      claimType: "mechanistic",
      commitSha: "a".repeat(40),
      relations: [{ citationId: replayContradictionCitation, relationType: "contradicts" }],
    },
    {
      claimId: attentionClaim1,
      localClaimId: "c-attn-1",
      reviewSlug: "attention-review",
      reviewId: "r2",
      reviewVersionId: "rv2",
      reviewTitle: "Cortical Oscillations and Selective Attention",
      text: "Coordinated neural activity supports memory-related cognitive performance.",
      section: "Results",
      anchor: claimDomAnchor("rv2", "c-attn-1"),
      claimType: "empirical",
      commitSha: "b".repeat(40),
      relations: [
        {
          citationId: attentionSharedCitation,
          relationType: "supports",
          trust: {
            reviewStatus: "unverified-import",
            verificationState: "unverified-import",
            notableCriteria: ["entailment"],
          },
        },
      ],
    },
  ],
  citations: [
    {
      citationId: replaySharedCitation,
      localCitationId: "ref-shared",
      reviewVersionId: "rv1",
      workId: sharedWorkAliases[0]!,
      canonicalWorkAliases: sharedWorkAliases,
      doi: "10.5555/oratlas.example.shared",
      title: "A shared source",
      year: 2000,
    },
    {
      citationId: replayContradictionCitation,
      localCitationId: "ref-contra",
      reviewVersionId: "rv1",
      workId: "doi:10.5555/oratlas.example.contra",
      canonicalWorkAliases: ["doi:10.5555/oratlas.example.contra"],
      doi: "10.5555/oratlas.example.contra",
      title: "A contradicting source",
      year: 2010,
    },
    {
      citationId: attentionSharedCitation,
      localCitationId: "ref-shared",
      reviewVersionId: "rv2",
      workId: sharedWorkAliases[0]!,
      canonicalWorkAliases: sharedWorkAliases,
      doi: "https://doi.org/10.5555/ORATLAS.EXAMPLE.SHARED",
      title: "A shared source",
      year: 2000,
    },
  ],
  identifierConflicts: [],
};
