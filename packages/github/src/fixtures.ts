import { type FakeRepoFixture } from "./testing.js";

const TEMPLATE_COMMIT = "b".repeat(40);

export const MYST_YML = `version: 1
project:
  title: "Hippocampal Replay and Memory Consolidation: A Computational Review"
  keywords:
    - hippocampus
    - replay
  license: CC-BY-4.0
  github: https://github.com/example-lab/hippocampal-replay-review
  bibliography:
    - content/references.bib
  toc:
    - file: content/00_frontmatter.md
    - file: content/evidence_database.md
    - file: content/provenance.md
site:
  template: book-theme
`;

export const CITATION_CFF = `cff-version: 1.2.0
title: "Hippocampal Replay and Memory Consolidation: A Computational Review"
message: "If you use this review, please cite it."
authors:
  - given-names: Ada
    family-names: Rivera
    orcid: "https://orcid.org/0000-0002-1825-0097"
  - given-names: Kenji
    family-names: Watanabe
    orcid: "https://orcid.org/0000-0001-5109-3700"
license: CC-BY-4.0
repository-code: "https://github.com/example-lab/hippocampal-replay-review"
abstract: "An AI-assisted critical review of hippocampal replay and memory consolidation."
keywords:
  - hippocampus
  - replay
  - memory consolidation
`;

export const ZENODO_JSON = JSON.stringify(
  {
    title: "Hippocampal Replay and Memory Consolidation: A Computational Review",
    license: "CC-BY-4.0",
    upload_type: "publication",
    publication_type: "article",
    creators: [{ name: "Rivera, Ada", orcid: "0000-0002-1825-0097" }, { name: "Watanabe, Kenji" }],
  },
  null,
  2,
);

export const REVIEW_MANIFEST = JSON.stringify(
  {
    schemaVersion: "1.0.0",
    review: {
      title: "Hippocampal Replay and Memory Consolidation: A Computational Review",
      abstract: "An AI-assisted critical review of hippocampal replay and memory consolidation.",
      reviewType: "computational-literature-review",
      keywords: ["hippocampus", "replay", "memory consolidation"],
      license: "CC-BY-4.0",
    },
    repository: {
      url: "https://github.com/example-lab/hippocampal-replay-review",
      releaseTag: "v1.2.0",
    },
    publication: {
      reviewUrl: "https://example-lab.github.io/hippocampal-replay-review/",
      versionDoi: "10.5555/oratlas.example.replay.v1-2-0",
      conceptDoi: "10.5555/oratlas.example.replay.concept",
      zenodoRecordId: "9990001",
    },
    artifacts: {
      claims: "knowledge/claims.jsonl",
      citations: "knowledge/citations.jsonl",
      relations: "knowledge/relations.jsonl",
      trustAssessments: "knowledge/trust.jsonl",
      provenance: "provenance.json",
    },
  },
  null,
  2,
);

export const CLAIMS_JSONL = [
  JSON.stringify({
    id: "claim-001",
    text: "Sharp-wave ripple-associated replay during non-REM sleep supports consolidation of spatial memories.",
    section: "Results",
    anchor: "sec-replay-consolidation",
    claimType: "empirical",
  }),
  JSON.stringify({
    id: "claim-002",
    text: "Selective disruption of sharp-wave ripples impairs subsequent spatial memory performance.",
    section: "Results",
    claimType: "empirical",
  }),
].join("\n");

export const CITATIONS_JSONL = [
  JSON.stringify({
    id: "ref-wilson1994",
    doi: "10.5555/oratlas.example.wilson1994",
    title: "Reactivation of hippocampal ensemble memories during sleep",
    year: 1994,
  }),
  JSON.stringify({
    id: "ref-girardeau2009",
    doi: "10.5555/oratlas.example.girardeau2009",
    title: "Selective suppression of hippocampal ripples impairs spatial memory",
    year: 2009,
  }),
].join("\n");

export const RELATIONS_JSONL = [
  JSON.stringify({ claimId: "claim-001", citationId: "ref-wilson1994", relationType: "supports" }),
  JSON.stringify({
    claimId: "claim-002",
    citationId: "ref-girardeau2009",
    relationType: "supports",
  }),
].join("\n");

export const TRUST_JSONL = JSON.stringify({
  claimId: "claim-002",
  citationId: "ref-girardeau2009",
  protocolVersion: "trust-poc-1.0",
  assessorType: "agent",
  criteria: { entailment: { rating: "very-high", rationale: "Causal disruption design." } },
  reviewStatus: "agent-proposed",
});

export const NODE_COMMIT = "e".repeat(40);

const nodeEnvelope = {
  title: "Reference knowledge node",
  contributors: [{ displayName: "Ada Researcher", orcid: "0000-0002-1825-0097" }],
  license: "CC-BY-4.0",
  versionDoi: "10.5281/zenodo.1234567",
  conceptDoi: "10.5281/zenodo.1234566",
};

export const CLAIM_NODE_JSON = JSON.stringify({
  ...nodeEnvelope,
  id: "claim:primary-result",
  kind: "claim",
  provenance: {
    sourcePath: "nodes/primary-claim.json",
    repositoryUrl: "https://github.com/example-lab/node-publications",
    commitSha: NODE_COMMIT,
  },
  payload: {
    statement: "The intervention changed the measured outcome.",
    qualifiers: ["In the declared study population"],
  },
});

export const FIGURE_NODE_JSON = JSON.stringify({
  ...nodeEnvelope,
  id: "figure:main",
  kind: "figure",
  provenance: {
    sourcePath: "nodes/main-figure.json",
    repositoryUrl: "https://github.com/example-lab/node-publications",
    commitSha: NODE_COMMIT,
  },
  payload: {
    artifactPath: "figures/main-result.png",
    caption: "Measured outcome by experimental condition.",
    altText: "A point plot comparing two experimental conditions.",
  },
});

export const DATASET_NODE_JSON = JSON.stringify({
  ...nodeEnvelope,
  id: "dataset:observations",
  kind: "dataset",
  provenance: {
    sourcePath: "nodes/source-dataset.json",
    repositoryUrl: "https://github.com/example-lab/node-publications",
    commitSha: NODE_COMMIT,
  },
  payload: {
    artifactPath: "data/observations.csv",
    format: "text/csv",
    sizeBytes: 0,
    doi: "10.5555/oratlas.example.dataset.v1",
  },
});

export const CODE_NODE_JSON = JSON.stringify({
  ...nodeEnvelope,
  id: "code:analysis",
  kind: "code",
  provenance: {
    sourcePath: "nodes/analysis-code.json",
    repositoryUrl: "https://github.com/example-lab/node-publications",
    commitSha: NODE_COMMIT,
  },
  payload: {
    entryPoints: ["src/analyse.py"],
    language: "Python",
    releaseRef: "v1.0.0",
  },
});

export const NODE_EDGES_JSONL = JSON.stringify({
  sourceNodeId: "claim:primary-result",
  targetNodeId: "dataset:observations",
  relationType: "uses-dataset",
  provenance: "asserted-by-author",
  status: "proposed",
});

export const NODE_MANIFEST = JSON.stringify(
  {
    schemaVersion: "1.0.0",
    nodes: {
      format: "json",
      files: [
        "nodes/primary-claim.json",
        "nodes/main-figure.json",
        "nodes/source-dataset.json",
        "nodes/analysis-code.json",
      ],
    },
    edges: { format: "jsonl", path: "nodes/edges.jsonl" },
  },
  null,
  2,
);

/** Repository fixture publishing all four first-class node kinds. */
export const nodePublicationFixture: FakeRepoFixture = {
  owner: "example-lab",
  name: "node-publications",
  commitSha: NODE_COMMIT,
  repo: {
    id: 787878,
    full_name: "example-lab/node-publications",
    private: false,
    fork: false,
    default_branch: "main",
    description: "First-class knowledge node publications.",
    topics: ["open-science", "knowledge-graph"],
    license: { spdx_id: "CC-BY-4.0" },
  },
  files: {
    "node-manifest.json": NODE_MANIFEST,
    "nodes/primary-claim.json": CLAIM_NODE_JSON,
    "nodes/main-figure.json": FIGURE_NODE_JSON,
    "nodes/source-dataset.json": DATASET_NODE_JSON,
    "nodes/analysis-code.json": CODE_NODE_JSON,
    "nodes/edges.jsonl": NODE_EDGES_JSONL,
  },
  // Artifact paths are visible in the tree but intentionally have no content:
  // inspection must validate their existence without fetching their bytes.
  extraTreePaths: ["figures/main-result.png", "data/observations.csv", "src/analyse.py"],
};

/** A fully template-compatible review repository fixture. */
export const templateCompatibleFixture: FakeRepoFixture = {
  owner: "example-lab",
  name: "hippocampal-replay-review",
  commitSha: TEMPLATE_COMMIT,
  repo: {
    id: 424242,
    full_name: "example-lab/hippocampal-replay-review",
    private: false,
    fork: false,
    default_branch: "main",
    description: "Computational literature review on hippocampal replay.",
    homepage: "https://example-lab.github.io/hippocampal-replay-review/",
    topics: ["neuroscience", "computational-review", "myst"],
    license: { spdx_id: "CC-BY-4.0" },
    stargazers_count: 3,
    archived: false,
    created_at: "2026-01-01T00:00:00Z",
    pushed_at: "2026-06-01T00:00:00Z",
  },
  tags: [{ name: "v1.2.0", commitSha: TEMPLATE_COMMIT }],
  releases: [
    {
      tag_name: "v1.2.0",
      name: "v1.2.0",
      html_url: "https://github.com/example-lab/hippocampal-replay-review/releases/tag/v1.2.0",
      published_at: "2026-06-02T00:00:00Z",
      draft: false,
      prerelease: false,
      body: "Deposited to Zenodo: https://doi.org/10.5555/oratlas.example.replay.v1-2-0",
    },
  ],
  pages: { html_url: "https://example-lab.github.io/hippocampal-replay-review/" },
  files: {
    "review-manifest.json": REVIEW_MANIFEST,
    "myst.yml": MYST_YML,
    "CITATION.cff": CITATION_CFF,
    ".zenodo.json": ZENODO_JSON,
    "content/references.bib": "@article{wilson1994, title={Reactivation}, year={1994}}",
    "content/provenance.md": "# Provenance\nPipeline run log.",
    "provenance.json": JSON.stringify({ pipeline: "expert-review", version: "29" }),
    "knowledge/claims.jsonl": CLAIMS_JSONL,
    "knowledge/citations.jsonl": CITATIONS_JSONL,
    "knowledge/relations.jsonl": RELATIONS_JSONL,
    "knowledge/trust.jsonl": TRUST_JSONL,
    "README.md": "# Hippocampal Replay Review\nA computational review.",
  },
};

/** A minimal, non-review repository fixture (unsupported). */
export const plainRepoFixture: FakeRepoFixture = {
  owner: "someone",
  name: "random-cli-tool",
  commitSha: "c".repeat(40),
  repo: {
    id: 999,
    full_name: "someone/random-cli-tool",
    private: false,
    fork: false,
    default_branch: "main",
    description: "A small command line tool.",
    topics: ["cli"],
    license: { spdx_id: "MIT" },
  },
  files: {
    "README.md": "# random-cli-tool\nA CLI tool, not a review.",
    "package.json": JSON.stringify({ name: "random-cli-tool", version: "1.0.0" }),
  },
};

/** A partially-compatible repository: has content + bibliography but no manifest/DOI/release. */
export const partiallyCompatibleFixture: FakeRepoFixture = {
  owner: "example-lab",
  name: "attention-oscillations-review",
  commitSha: "d".repeat(40),
  repo: {
    id: 555,
    full_name: "example-lab/attention-oscillations-review",
    private: false,
    fork: false,
    default_branch: "main",
    description: "Repository-only computational review on attention and oscillations.",
    topics: ["neuroscience", "computational-review"],
    license: { spdx_id: "MIT" },
  },
  pages: { html_url: "https://example-lab.github.io/attention-oscillations-review/" },
  files: {
    "myst.yml":
      "version: 1\nproject:\n  title: Attention and Oscillations\n  bibliography:\n    - content/references.bib\n",
    "CITATION.cff": `cff-version: 1.2.0\ntitle: "Cortical Oscillations and Selective Attention"\nauthors:\n  - given-names: Lena\n    family-names: Fischer\n    orcid: "https://orcid.org/0000-0003-4515-1234"\nlicense: MIT\nrepository-code: "https://github.com/example-lab/attention-oscillations-review"\n`,
    "content/references.bib": "@article{fries2001, title={Modulation}, year={2001}}",
    "content/01_introduction.md": "# Introduction\nA review of attention and oscillations.",
    "README.md": "# Attention Oscillations Review",
  },
};

export { TEMPLATE_COMMIT };
