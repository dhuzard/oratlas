/**
 * Seed data (spec §20).
 *
 * IMPORTANT: every identifier here is synthetic. DOIs use the reserved
 * documentation-style `10.5555/` prefix and are flagged `isExample`, so the UI
 * never renders them as resolvable outbound links. The ComputationalReviewTemplate
 * repository is included as a *structural demonstration*, not as a submitted
 * scientific review.
 */
import {
  type AssessmentReviewStatus,
  type KnowledgeNode,
  type NodeEdge,
  type TrustOrdinal,
} from "@oratlas/contracts";

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
  scope?: {
    population?: string;
    model?: string;
    intervention?: string;
    outcome?: string;
    method?: string;
  };
}

export interface SeedCitation {
  localId: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  source?: string;
  isExample?: boolean;
  datasetIds?: string[];
  derivedFromDois?: string[];
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
  assessedAt?: string;
  reviewStatus: AssessmentReviewStatus;
  criteria: Record<
    string,
    {
      rating: TrustOrdinal;
      status?: "assessed" | "not-assessed" | "not-applicable";
      rationale?: string;
    }
  >;
  limitations?: string[];
  evidence?: Record<string, unknown>;
  aggregateScore?: number | null;
  aggregateMethod?: string | null;
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

export interface SeedKnowledgeNode {
  repositoryKey: "replay-lab" | "replication-lab";
  node: KnowledgeNode;
  isExample: boolean;
  legacyClaim?: { reviewSlug: string; localClaimId: string };
}

export interface SeedNodeEdge {
  sourceRepositoryKey: SeedKnowledgeNode["repositoryKey"];
  targetRepositoryKey: SeedKnowledgeNode["repositoryKey"];
  edge: NodeEdge;
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
      scope: { population: "rodent hippocampus", method: "electrophysiology" },
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
      title:
        "Selective suppression of hippocampal ripples impairs spatial memory (example citation)",
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
        // Explicit-null source aggregate exercises provenance preservation;
        // Atlas computes the public value from criteria.
        aggregateScore: null,
        aggregateMethod: null,
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
    {
      localId: "claim-003",
      text: "Waking place-cell sequences are not faithfully reactivated during human sleep replay.",
      section: "Discussion",
      anchor: "sec-replay-scope",
      claimType: "empirical",
      qualification: "Human evidence is indirect; direct place-cell recordings are scarce.",
      scope: { population: "human cortex", method: "intracranial EEG" },
    },
  ],
  citations: [
    {
      localId: "ref-fries2001",
      doi: "10.5555/oratlas.example.fries2001",
      title:
        "Modulation of oscillatory neuronal synchronization by selective attention (example citation)",
      authors: ["Fries P", "Reynolds JH", "Rorie AE", "Desimone R"],
      year: 2001,
      source: "Example Science",
      isExample: true,
    },
    {
      // Same work as the replay review's ref-wilson1994 (shared DOI): lets the
      // synthesis engine detect a cross-review opposing pair over one work.
      localId: "ref-wilson1994-shared",
      doi: "10.5555/oratlas.example.wilson1994",
      title: "Reactivation of hippocampal ensemble memories during sleep (example citation)",
      authors: ["Wilson MA", "McNaughton BL"],
      year: 1994,
      source: "Example Science",
      isExample: true,
    },
  ],
  relations: [
    {
      claimLocalId: "claim-003",
      citationLocalId: "ref-wilson1994-shared",
      relationType: "contradicts",
      supportDirection: "negative",
      humanReviewed: false,
    },
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
          entailment: {
            rating: "high",
            rationale: "Reports the attention–synchrony relationship directly.",
          },
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
    commitSha: sha("deadc0deca11ab1e0000"),
    branch: "main",
    releaseTag: "v1.0.0",
    releaseUrl:
      "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate/releases/tag/v1.0.0",
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

/** Repository and exact snapshot for a second, independent node-publishing lab. */
export const replicationLabRepository = {
  key: "replication-lab" as const,
  owner: "independent-replication-lab",
  name: "replay-node-publications",
  canonicalUrl: "https://github.com/independent-replication-lab/replay-node-publications",
  defaultBranch: "main",
  description: "Independent replication knowledge nodes for the Atlas seed graph.",
  topics: ["neuroscience", "hippocampal-replay", "replication", "knowledge-graph"],
  commitSha: sha("cc44dd55ee66ff778899"),
};

const replayNodeContributor = {
  displayName: "Dr. Ada Rivera",
  givenName: "Ada",
  familyName: "Rivera",
  orcid: "0000-0002-1825-0097",
  githubLogin: "arivera-example",
  roles: ["author"],
};

const replicationNodeContributor = {
  displayName: "Dr. Noor Okafor",
  givenName: "Noor",
  familyName: "Okafor",
  githubLogin: "nokafor-example",
  roles: ["author", "replicator"],
};

/** Six first-class nodes across two laboratories, covering every node kind. */
export const seedKnowledgeNodes: SeedKnowledgeNode[] = [
  {
    repositoryKey: "replay-lab",
    isExample: false,
    legacyClaim: { reviewSlug: reviewWithDoi.slug, localClaimId: "claim-001" },
    node: {
      id: "replay-consolidation-claim",
      kind: "claim",
      title: "Replay supports systems memory consolidation",
      abstract: "A bounded claim about the association between sleep replay and consolidation.",
      text: "Hippocampal replay during sleep supports systems-level memory consolidation.",
      contributors: [replayNodeContributor],
      license: "CC-BY-4.0",
      provenance: {
        sourcePath: "nodes/replay-consolidation-claim.json",
        repositoryUrl: reviewWithDoi.repository.canonicalUrl,
        commitSha: reviewWithDoi.snapshot.commitSha,
        declaredAt: NOW,
      },
      payload: {
        statement: "Hippocampal replay during sleep supports systems-level memory consolidation.",
        qualifiers: ["Evidence is strongest in rodent electrophysiology."],
      },
    },
  },
  {
    repositoryKey: "replay-lab",
    isExample: true,
    node: {
      id: "replay-sequences-dataset",
      kind: "dataset",
      title: "Annotated replay sequence dataset",
      abstract: "Synthetic seed metadata for annotated sleep replay events.",
      contributors: [replayNodeContributor],
      license: "CC-BY-4.0",
      provenance: {
        sourcePath: "nodes/replay-sequences-dataset.json",
        repositoryUrl: reviewWithDoi.repository.canonicalUrl,
        commitSha: reviewWithDoi.snapshot.commitSha,
        declaredAt: NOW,
      },
      versionDoi: "10.5555/oratlas.node.replay-dataset.v1",
      conceptDoi: "10.5555/oratlas.node.replay-dataset.concept",
      payload: {
        artifactPath: "data/replay-sequences.csv",
        format: "text/csv",
        sizeBytes: 42_240,
        doi: "10.5555/oratlas.node.replay-dataset.v1",
      },
    },
  },
  {
    repositoryKey: "replay-lab",
    isExample: false,
    node: {
      id: "replay-analysis-code",
      kind: "code",
      title: "Replay sequence analysis pipeline",
      contributors: [replayNodeContributor],
      license: "MIT",
      provenance: {
        sourcePath: "nodes/replay-analysis-code.json",
        repositoryUrl: reviewWithDoi.repository.canonicalUrl,
        commitSha: reviewWithDoi.snapshot.commitSha,
        declaredAt: NOW,
      },
      payload: {
        entryPoints: ["src/analyze_replay.py"],
        language: "Python",
        releaseRef: "v1.2.0",
      },
    },
  },
  {
    repositoryKey: "replication-lab",
    isExample: false,
    node: {
      id: "independent-replay-replication",
      kind: "claim",
      title: "Independent replay replication",
      abstract: "An independent laboratory reports the same directional replay association.",
      contributors: [replicationNodeContributor],
      license: "CC-BY-4.0",
      provenance: {
        sourcePath: "nodes/independent-replay-replication.json",
        repositoryUrl: replicationLabRepository.canonicalUrl,
        commitSha: replicationLabRepository.commitSha,
        declaredAt: NOW,
      },
      payload: {
        statement: "An independent cohort reproduces the replay–consolidation association.",
        qualifiers: ["The protocol differs in event-detection threshold."],
      },
    },
  },
  {
    repositoryKey: "replication-lab",
    isExample: false,
    node: {
      id: "replay-boundary-claim",
      kind: "claim",
      title: "Replay is not sufficient for consolidation",
      text: "Replay frequency alone does not predict consolidation under the independent protocol.",
      contributors: [replicationNodeContributor],
      license: "CC-BY-4.0",
      provenance: {
        sourcePath: "nodes/replay-boundary-claim.json",
        repositoryUrl: replicationLabRepository.canonicalUrl,
        commitSha: replicationLabRepository.commitSha,
        declaredAt: NOW,
      },
      payload: {
        statement: "Replay frequency alone is not sufficient to predict memory consolidation.",
        qualifiers: ["This contradicts a frequency-only interpretation, not all replay models."],
      },
    },
  },
  {
    repositoryKey: "replication-lab",
    isExample: false,
    node: {
      id: "replication-summary-figure",
      kind: "figure",
      title: "Cross-lab replay effect comparison",
      contributors: [replicationNodeContributor],
      license: "CC-BY-4.0",
      provenance: {
        sourcePath: "nodes/replication-summary-figure.json",
        repositoryUrl: replicationLabRepository.canonicalUrl,
        commitSha: replicationLabRepository.commitSha,
        declaredAt: NOW,
      },
      payload: {
        artifactPath: "figures/cross-lab-effect-comparison.svg",
        caption: "Effect estimates from the original and independent replay cohorts.",
        altText: "Two interval estimates comparing replay and later memory across laboratories.",
      },
    },
  },
];

/** Typed graph edges; confirmed fixtures represent editor-confirmed public relations. */
export const seedNodeEdges: SeedNodeEdge[] = [
  {
    sourceRepositoryKey: "replication-lab",
    targetRepositoryKey: "replay-lab",
    edge: {
      sourceNodeId: "independent-replay-replication",
      targetNodeId: "replay-consolidation-claim",
      relationType: "replicates",
      provenance: "confirmed-by-editor",
      status: "confirmed",
      rationale: "The independent protocol tests the same directional association.",
      assertedAt: NOW,
    },
  },
  {
    sourceRepositoryKey: "replication-lab",
    targetRepositoryKey: "replay-lab",
    edge: {
      sourceNodeId: "replay-boundary-claim",
      targetNodeId: "replay-consolidation-claim",
      relationType: "contradicts",
      provenance: "confirmed-by-editor",
      status: "confirmed",
      rationale: "The independent result rejects a frequency-only interpretation.",
      assertedAt: NOW,
    },
  },
  {
    sourceRepositoryKey: "replay-lab",
    targetRepositoryKey: "replay-lab",
    edge: {
      sourceNodeId: "replay-consolidation-claim",
      targetNodeId: "replay-sequences-dataset",
      relationType: "uses-dataset",
      provenance: "confirmed-by-editor",
      status: "confirmed",
      assertedAt: NOW,
    },
  },
  {
    sourceRepositoryKey: "replay-lab",
    targetRepositoryKey: "replay-lab",
    edge: {
      sourceNodeId: "replay-consolidation-claim",
      targetNodeId: "replay-analysis-code",
      relationType: "uses-code",
      provenance: "confirmed-by-editor",
      status: "confirmed",
      assertedAt: NOW,
    },
  },
  {
    sourceRepositoryKey: "replication-lab",
    targetRepositoryKey: "replication-lab",
    edge: {
      sourceNodeId: "replication-summary-figure",
      targetNodeId: "independent-replay-replication",
      relationType: "derives-from",
      provenance: "confirmed-by-editor",
      status: "confirmed",
      assertedAt: NOW,
    },
  },
];

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
    treeSha: sha("66cc77dd88ee99ff00aa"),
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

export interface SeedComment {
  reviewSlug: string;
  authorLogin: string;
  kind: string;
  body: string;
  claimLocalId?: string;
  /** Index into the same review's comment list identifying the parent. */
  replyTo?: number;
}

/**
 * Sample scholarly exchange on the seeded reviews. Demonstrates typed
 * commentary (question / concern / suggestion / endorsement), claim anchoring,
 * and one-level threads with an editor reply.
 */
export const seedComments: SeedComment[] = [
  {
    reviewSlug: "hippocampal-replay-computational-review",
    authorLogin: "atlas-submitter",
    kind: "question",
    claimLocalId: "claim-001",
    body: "Does the replay-consolidation link hold under closed-loop disruption, or only in correlational recordings? The distinction matters for the causal reading of this claim.",
  },
  {
    reviewSlug: "hippocampal-replay-computational-review",
    authorLogin: "atlas-editor",
    kind: "comment",
    body: "Good question — Girardeau et al. (2009) is the closed-loop disruption result cited under the evidence for this claim; worth reading alongside the correlational work.",
    replyTo: 0,
  },
  {
    reviewSlug: "hippocampal-replay-computational-review",
    authorLogin: "atlas-submitter",
    kind: "endorsement",
    body: "Clear separation of version DOI from concept DOI and explicit provenance on every extracted field — this is the kind of transparency reviews should aim for.",
  },
  {
    reviewSlug: "cortical-oscillations-attention-review",
    authorLogin: "atlas-submitter",
    kind: "concern",
    claimLocalId: "claim-001",
    body: "The evidence base here leans on a single lab's recordings. A note on replication scope would help readers calibrate how far this generalizes.",
  },
];

export const seedUsers = [
  {
    githubLogin: "atlas-editor",
    githubUserId: "mock:atlas-editor",
    displayName: "Atlas Editor (demo)",
    role: "EDITOR",
    profileUrl: "https://github.com/atlas-editor",
  },
  {
    githubLogin: "atlas-submitter",
    githubUserId: "mock:atlas-submitter",
    displayName: "Atlas Submitter (demo)",
    role: "USER",
    profileUrl: "https://github.com/atlas-submitter",
  },
];

export { prov };
