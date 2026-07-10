/**
 * Seed data (spec §20).
 *
 * IMPORTANT: every identifier here is synthetic. DOIs use the reserved
 * documentation-style `10.5555/` prefix and are flagged `isExample`, so the UI
 * never renders them as resolvable outbound links. The ComputationalReviewTemplate
 * repository is included as a *structural demonstration*, not as a submitted
 * scientific review.
 */

export const EXTRACTOR_VERSION = "extractor-0.1.0";
export const TRUST_PROTOCOL_VERSION = "trust-poc-1.0";
const NOW = "2026-07-01T12:00:00.000Z";

function prov(source: string, file?: string, pointer?: string, confidence = 1) {
  return {
    source,
    file,
    pointer,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: NOW,
    confidence,
    warnings: [] as string[],
  };
}

export interface SeedClaim {
  localId: string;
  text: string;
  section?: string;
  anchor?: string;
  claimType?: string;
  qualification?: string;
}

export interface SeedCitation {
  localId: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  source?: string;
  isExample?: boolean;
}

export interface SeedRelation {
  claimLocalId: string;
  citationLocalId: string;
  relationType: string;
  supportDirection?: string;
  humanReviewed?: boolean;
  trust?: SeedTrust;
}

export interface SeedTrust {
  assessorType: "agent" | "human";
  assessorId?: string;
  reviewStatus: string;
  criteria: Record<string, { rating: string; status?: string; rationale?: string }>;
  limitations?: string[];
  aggregateScore?: number;
  aggregateMethod?: string;
}

export interface SeedReview {
  slug: string;
  title: string;
  abstract: string;
  reviewType: string;
  licenseSpdx: string;
  status: string;
  publishedReviewUrl?: string;
  repository: {
    owner: string;
    name: string;
    canonicalUrl: string;
    defaultBranch: string;
    description: string;
    topics: string[];
    homepageUrl?: string;
    pagesUrl?: string;
  };
  snapshot: {
    commitSha: string;
    branch: string;
    releaseTag?: string;
    releaseUrl?: string;
  };
  version: {
    semanticVersion: string;
    versionDoi?: string;
    conceptDoi?: string;
    zenodoRecordId?: string;
    releaseTag?: string;
    isExample: boolean;
  };
  contributors: Array<{
    displayName: string;
    givenName?: string;
    familyName?: string;
    orcid?: string;
    githubLogin?: string;
    roles: string[];
  }>;
  keywords: string[];
  domains: string[];
  claims: SeedClaim[];
  citations: SeedCitation[];
  relations: SeedRelation[];
  metadataProvenanceNote: string;
  compatibilityLevel: string;
}

const sha = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

/** Accepted review WITH a GitHub release and a (synthetic) Zenodo DOI. */
export const reviewWithDoi: SeedReview = {
  slug: "hippocampal-replay-computational-review",
  title: "Hippocampal Replay and Memory Consolidation: A Computational Review",
  abstract:
    "An AI-assisted critical review synthesizing computational and experimental evidence on hippocampal replay during sleep and its proposed role in systems-level memory consolidation. The review catalogues supporting and contradicting evidence across rodent electrophysiology and network-model studies.",
  reviewType: "computational-literature-review",
  licenseSpdx: "CC-BY-4.0",
  status: "published",
  publishedReviewUrl: "https://example-lab.github.io/hippocampal-replay-review/",
  repository: {
    owner: "example-lab",
    name: "hippocampal-replay-review",
    canonicalUrl: "https://github.com/example-lab/hippocampal-replay-review",
    defaultBranch: "main",
    description: "Computational literature review on hippocampal replay (example repository).",
    topics: ["neuroscience", "hippocampus", "computational-review", "myst"],
    homepageUrl: "https://example-lab.github.io/hippocampal-replay-review/",
    pagesUrl: "https://example-lab.github.io/hippocampal-replay-review/",
  },
  snapshot: {
    commitSha: sha("aa11bb22cc33dd44ee55"),
    branch: "main",
    releaseTag: "v1.2.0",
    releaseUrl: "https://github.com/example-lab/hippocampal-replay-review/releases/tag/v1.2.0",
  },
  version: {
    semanticVersion: "1.2.0",
    // Reserved example DOI prefix (10.5555 = documentation). Never resolves.
    versionDoi: "10.5555/oratlas.example.replay.v1-2-0",
    conceptDoi: "10.5555/oratlas.example.replay.concept",
    zenodoRecordId: "9990001",
    releaseTag: "v1.2.0",
    isExample: true,
  },
  contributors: [
    {
      displayName: "Dr. Ada Rivera",
      givenName: "Ada",
      familyName: "Rivera",
      orcid: "0000-0002-1825-0097",
      githubLogin: "arivera-example",
      roles: ["author", "maintainer"],
    },
    {
      displayName: "Dr. Kenji Watanabe",
      givenName: "Kenji",
      familyName: "Watanabe",
      orcid: "0000-0001-5109-3700",
      roles: ["author"],
    },
  ],
  keywords: ["hippocampus", "replay", "memory consolidation", "sharp-wave ripples"],
  domains: ["Neuroscience", "Computational Biology"],
  claims: [
    {
      localId: "claim-001",
      text: "Sharp-wave ripple-associated replay during non-REM sleep supports the consolidation of recently acquired spatial memories.",
      section: "Results",
      anchor: "sec-replay-consolidation",
      claimType: "empirical",
      qualification: "Primarily evidenced in rodent models; human evidence is indirect.",
    },
    {
      localId: "claim-002",
      text: "Selective disruption of sharp-wave ripples impairs subsequent spatial memory performance.",
      section: "Results",
      anchor: "sec-swr-disruption",
      claimType: "empirical",
    },
    {
      localId: "claim-003",
      text: "Replay content is strictly a veridical reverse-order replay of the most recent trajectory.",
      section: "Discussion",
      anchor: "sec-replay-content",
      claimType: "mechanistic",
      qualification: "Contested: several studies report forward and non-local replay.",
    },
  ],
  citations: [
    {
      localId: "ref-wilson1994",
      doi: "10.5555/oratlas.example.wilson1994",
      title: "Reactivation of hippocampal ensemble memories during sleep (example citation)",
      authors: ["Wilson MA", "McNaughton BL"],
      year: 1994,
      source: "Example Journal of Neuroscience",
      isExample: true,
    },
    {
      localId: "ref-girardeau2009",
      doi: "10.5555/oratlas.example.girardeau2009",
      title: "Selective suppression of hippocampal ripples impairs spatial memory (example citation)",
      authors: ["Girardeau G", "Benchenane K", "Wiener SI"],
      year: 2009,
      source: "Example Nature Neuroscience",
      isExample: true,
    },
    {
      localId: "ref-gupta2010",
      doi: "10.5555/oratlas.example.gupta2010",
      title: "Hippocampal replay is not a simple function of experience (example citation)",
      authors: ["Gupta AS", "van der Meer MAA", "Touretzky DS"],
      year: 2010,
      source: "Example Neuron",
      isExample: true,
    },
  ],
  relations: [
    {
      claimLocalId: "claim-001",
      citationLocalId: "ref-wilson1994",
      relationType: "supports",
      supportDirection: "positive",
      humanReviewed: false,
      trust: {
        assessorType: "agent",
        assessorId: "atlas-trust-agent",
        reviewStatus: "agent-proposed",
        criteria: {
          entailment: {
            rating: "high",
            rationale: "The cited study reports memory-correlated reactivation directly.",
          },
          sourceAccess: { rating: "high", rationale: "Open-access full text available." },
          populationRelevance: {
            rating: "moderate",
            rationale: "Rodent population; relevance to humans is inferential.",
          },
          replicationConvergence: {
            rating: "moderate",
            rationale: "Multiple later studies converge, but many share methods.",
          },
        },
        limitations: [
          "Rodent-only evidence.",
          "Correlational reactivation, not causal for this specific citation.",
        ],
        aggregateScore: 0.68,
        aggregateMethod: "ordinal-mean-1.0",
      },
    },
    {
      claimLocalId: "claim-002",
      citationLocalId: "ref-girardeau2009",
      relationType: "supports",
      supportDirection: "positive",
      humanReviewed: true,
      trust: {
        assessorType: "human",
        assessorId: "editor:atlas-demo",
        reviewStatus: "human-reviewed",
        criteria: {
          entailment: {
            rating: "very-high",
            rationale: "Causal disruption design directly tests the claim.",
          },
          methodologicalSafeguards: {
            rating: "high",
            rationale: "Closed-loop stimulation with appropriate controls.",
          },
          statisticalSafeguards: {
            rating: "moderate",
            rationale: "Adequate but modest sample sizes.",
          },
          sourceAccess: { rating: "high" },
        },
        limitations: ["Single laboratory; independent replication still limited."],
        aggregateScore: 0.82,
        aggregateMethod: "ordinal-mean-1.0",
      },
    },
    {
      claimLocalId: "claim-003",
      citationLocalId: "ref-gupta2010",
      relationType: "contradicts",
      supportDirection: "negative",
      humanReviewed: false,
      trust: {
        assessorType: "agent",
        assessorId: "atlas-trust-agent",
        reviewStatus: "agent-proposed",
        criteria: {
          entailment: {
            rating: "high",
            rationale: "Reports forward and non-local replay, contradicting strict reverse replay.",
          },
          outcomeRelevance: { rating: "high" },
        },
        limitations: ["Interpretation of 'strict' reverse replay varies across the literature."],
        aggregateScore: 0.7,
        aggregateMethod: "ordinal-mean-1.0",
      },
    },
  ],
  metadataProvenanceNote: "review-manifest + CITATION.cff",
  compatibilityLevel: "compatible",
};

/** Accepted repository-only review (no DOI, no release DOI). */
export const repositoryOnlyReview: SeedReview = {
  slug: "cortical-oscillations-attention-review",
  title: "Cortical Oscillations and Selective Attention: A Repository-Only Computational Review",
  abstract:
    "A computational literature review examining the relationship between cortical gamma-band oscillations and selective attention. Published as a GitHub repository without a deposited Zenodo release; readers are pointed to the exact reviewed commit.",
  reviewType: "computational-literature-review",
  licenseSpdx: "MIT",
  status: "published",
  publishedReviewUrl: "https://example-lab.github.io/attention-oscillations-review/",
  repository: {
    owner: "example-lab",
    name: "attention-oscillations-review",
    canonicalUrl: "https://github.com/example-lab/attention-oscillations-review",
    defaultBranch: "main",
    description: "Repository-only computational review on attention and oscillations (example).",
    topics: ["neuroscience", "attention", "oscillations", "computational-review"],
    pagesUrl: "https://example-lab.github.io/attention-oscillations-review/",
  },
  snapshot: {
    commitSha: sha("ff99ee88dd77cc66bb55"),
    branch: "main",
  },
  version: {
    semanticVersion: "0.9.0",
    isExample: true,
  },
  contributors: [
    {
      displayName: "Dr. Lena Fischer",
      givenName: "Lena",
      familyName: "Fischer",
      orcid: "0000-0003-4515-1234",
      githubLogin: "lfischer-example",
      roles: ["author", "maintainer"],
    },
  ],
  keywords: ["gamma oscillations", "selective attention", "synchrony"],
  domains: ["Neuroscience"],
  claims: [
    {
      localId: "claim-001",
      text: "Gamma-band synchronization between visual areas increases with attentional selection of a stimulus.",
      section: "Results",
      anchor: "sec-gamma-attention",
      claimType: "empirical",
    },
    {
      localId: "claim-002",
      text: "Attentional modulation of gamma synchrony is a direct causal driver of improved behavioral performance.",
      section: "Discussion",
      anchor: "sec-causality",
      claimType: "mechanistic",
      qualification: "Causality is inferred; direct causal manipulations remain scarce.",
    },
  ],
  citations: [
    {
      localId: "ref-fries2001",
      doi: "10.5555/oratlas.example.fries2001",
      title: "Modulation of oscillatory neuronal synchronization by selective attention (example citation)",
      authors: ["Fries P", "Reynolds JH", "Rorie AE", "Desimone R"],
      year: 2001,
      source: "Example Science",
      isExample: true,
    },
  ],
  relations: [
    {
      claimLocalId: "claim-001",
      citationLocalId: "ref-fries2001",
      relationType: "supports",
      supportDirection: "positive",
      humanReviewed: false,
      trust: {
        assessorType: "agent",
        assessorId: "atlas-trust-agent",
        reviewStatus: "agent-proposed",
        criteria: {
          entailment: { rating: "high", rationale: "Reports the attention–synchrony relationship directly." },
          populationRelevance: { rating: "high", rationale: "Non-human primate visual cortex." },
          replicationConvergence: { rating: "moderate" },
        },
        limitations: ["Correlational; does not establish causal direction."],
        aggregateScore: 0.66,
        aggregateMethod: "ordinal-mean-1.0",
      },
    },
    {
      claimLocalId: "claim-002",
      citationLocalId: "ref-fries2001",
      relationType: "partially-supports",
      supportDirection: "mixed",
      humanReviewed: false,
      trust: {
        assessorType: "agent",
        assessorId: "atlas-trust-agent",
        reviewStatus: "agent-proposed",
        criteria: {
          entailment: {
            rating: "low",
            rationale: "The citation is correlational and cannot establish the causal claim.",
          },
        },
        limitations: ["Claim overstates causality relative to the cited evidence."],
        aggregateScore: 0.3,
        aggregateMethod: "ordinal-mean-1.0",
      },
    },
  ],
  metadataProvenanceNote: "CITATION.cff + repository metadata",
  compatibilityLevel: "partially-compatible",
};

/** Structural demonstration: the reference template itself. */
export const templateDemoReview: SeedReview = {
  slug: "computational-review-template-demo",
  title: "ComputationalReviewTemplate (Structural Demonstration)",
  abstract:
    "The AllenNeuralDynamics ComputationalReviewTemplate, included as a structural demonstration of a verified-template repository. This is NOT a submitted scientific review; it illustrates how the archive recognizes template-compatible repositories.",
  reviewType: "computational-literature-review",
  licenseSpdx: "MIT",
  status: "published",
  publishedReviewUrl: "https://allenneuraldynamics.github.io/ComputationalReviewTemplate/",
  repository: {
    owner: "AllenNeuralDynamics",
    name: "ComputationalReviewTemplate",
    canonicalUrl: "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate",
    defaultBranch: "main",
    description: "Template for AI-assisted critical computational literature reviews.",
    topics: ["myst", "literature-review", "reproducible-research"],
    pagesUrl: "https://allenneuraldynamics.github.io/ComputationalReviewTemplate/",
  },
  snapshot: {
    commitSha: sha("template00commit00demo"),
    branch: "main",
    releaseTag: "v1.0.0",
    releaseUrl: "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate/releases/tag/v1.0.0",
  },
  version: {
    semanticVersion: "1.0.0",
    // The template's real Zenodo DOI is documented in its README; we do not
    // assert it as a submitted review's DOI here, so it stays flagged example.
    releaseTag: "v1.0.0",
    isExample: true,
  },
  contributors: [
    {
      displayName: "Allen Institute for Neural Dynamics",
      githubLogin: "AllenNeuralDynamics",
      roles: ["maintainer"],
    },
  ],
  keywords: ["template", "myst", "critical review"],
  domains: ["Neuroscience", "Research Infrastructure"],
  claims: [],
  citations: [],
  relations: [],
  metadataProvenanceNote: "myst.yml + repository metadata",
  compatibilityLevel: "verified-template",
};

export const seedReviews = [reviewWithDoi, repositoryOnlyReview, templateDemoReview];

/** A pending submission awaiting editorial review. */
export const pendingSubmission = {
  repository: {
    owner: "example-lab",
    name: "spike-sorting-methods-review",
    canonicalUrl: "https://github.com/example-lab/spike-sorting-methods-review",
    defaultBranch: "main",
    description: "Draft computational review of spike-sorting methods (example).",
    topics: ["neuroscience", "spike-sorting", "methods"],
  },
  snapshot: {
    commitSha: sha("55bb66cc77dd88ee99ff"),
    branch: "main",
  },
  title: "A Computational Review of Spike-Sorting Methods",
  abstract:
    "Pending submission: a comparative computational review of automated spike-sorting pipelines. Awaiting editorial review.",
  status: "pending-editorial-review",
};

/**
 * One cross-review link proposal: claim-001 of the replay review shares an
 * evidence theme with claim-001 of the attention review (both empirical
 * synchrony/consolidation claims). Deterministic normalized-text overlap.
 */
export const linkProposal = {
  sourceReviewSlug: reviewWithDoi.slug,
  sourceClaimLocalId: "claim-001",
  targetReviewSlug: repositoryOnlyReview.slug,
  targetClaimLocalId: "claim-001",
  proposedRelation: "semantically-similar-claims",
  rationale:
    "Both are empirical claims linking coordinated neural activity (ripple replay / gamma synchrony) to a cognitive outcome; normalized token overlap exceeded the proposal threshold.",
  features: { sharedCitations: [], normalizedTokenOverlap: 0.21, method: "lexical-jaccard" },
  agentProvenance: `${EXTRACTOR_VERSION}:link-proposer`,
  status: "proposed",
};

export const seedUsers = [
  {
    githubLogin: "atlas-editor",
    githubUserId: "100001",
    displayName: "Atlas Editor (demo)",
    role: "EDITOR",
    profileUrl: "https://github.com/atlas-editor",
  },
  {
    githubLogin: "atlas-submitter",
    githubUserId: "100002",
    displayName: "Atlas Submitter (demo)",
    role: "USER",
    profileUrl: "https://github.com/atlas-submitter",
  },
];

export { prov };
