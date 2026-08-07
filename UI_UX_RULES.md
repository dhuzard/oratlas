# ORAtlas UI/UX rules

This one-page product contract applies to every public ORAtlas screen and workflow.

> **ORAtlas is a GitHub-native public archive and interaction layer for AI-generated scientific
> reviews.** It must let a reader inspect a preserved review, move to a claim and its evidence,
> discuss or challenge it, and derive new synthesis without overwriting the original record.

## 1. Make the operating model obvious

A first-time visitor should understand these points within ten seconds:

- Reviews originate in **public GitHub repositories** built with, forked from, or structurally
  compatible with the official
  [AllenNeuralDynamics Computational Review Template](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate).
- ORAtlas captures an **exact release, tag, or commit**. It does not accept a manuscript upload or
  treat a mutable branch as the archived record.
- GitHub sign-in is required to submit a review and to make attributable contributions.
- Acceptance is an **editorial archive decision**, not peer review, scientific correctness, or
  consensus.

The primary actions should be explicit: **Generate an AI review**, **Submit a GitHub review**, and
**Explore claims and evidence**.

### Generate and submit a review in five steps

1. Create a repository from the AllenNeuralDynamics template.
2. Configure the title and scope, then follow the template Quick Start to run the review pipeline.
3. Inspect the generated review, evidence packages, figures, and provenance; resolve failed gates
   rather than publishing partial output as complete.
4. Push the complete repository and publish an immutable tag or GitHub release. A Zenodo DOI is
   recommended for preservation but is not required by ORAtlas.
5. Sign in to ORAtlas, paste the public repository URL, choose the exact source version, review the
   extracted metadata and validation report, and submit it. An editor then accepts it, requests
   changes, or rejects it.

## 2. Preserve the review first; use the graph to navigate it

- The complete preserved review must remain easy to read. Graphs and chat must not replace or bury
  the article.
- Figures and plots must be readable, expandable, captioned, and linked to their exact source and
  provenance. Do not reduce scientific figures to decorative thumbnails or raw JSON.
- The default path is **review → claim passport → linked evidence → assessment or disagreement →
  preserved source context**. Every graph item must link back to an exact immutable record.
- Always show the repository, selected release/tag/commit, version, AI/run provenance, and editorial
  status close to the review title.
- Graph views must explain why each node appears and disclose result counts, bounds, truncation, and
  honest empty states. Demo content must be unmistakably labelled.

## 3. Make participation anchored, attributable, and consequential

- Open comments may address the whole review or an exact claim. Formal challenges may target an
  exact claim, claim–evidence relation, or assessment criterion.
- Support attributed **questions, concerns, suggestions, endorsements, and replies**. One reply
  level is sufficient for the POC; avoid unreadable, indefinitely nested threads.
- Clearly distinguish **open discussion**, **formal challenge**, **TRUST assessment**, and
  **editorial decision**. They have different evidential and governance meanings.
- A comment or challenge must display the immutable review version and subject to which it applies.
  Historical-version discussions remain readable but read-only.
- A suggestion never edits an accepted review in place. It may produce an attributable update
  proposal or a new GitHub review version. The UI must then show the resolution, replacement
  version, diff, and lineage back to the original discussion.
- Moderation may hide abusive content, but it must preserve an auditable tombstone rather than
  silently deleting the record.

## 4. Let the knowledge graph evolve without losing governance

- Reviews, immutable review versions, claims, evidence, figures, datasets, code, and typed
  relationships are canonical graph entities with stable identities and immutable versions.
- Comments, challenges, and update or link proposals are attributable records anchored to exact
  graph subjects. **A comment is not automatically a scientific graph edge.**
- Humans and LLMs may propose a relationship. Only an explicit editor-confirmed proposal becomes a
  public canonical edge. Never invent an edge merely to force every record into a connected graph;
  an editor-approved new root or isolated concept is valid.
- Every node and edge must expose its provenance, exact version, status (`proposed` or `confirmed`),
  and change history. Interactive changes are append-only revisions, not hidden mutation.
- Semantic similarity may suggest a cross-review link, but it must not silently merge claim
  identities, evidence works, or conflicting interpretations.

## 5. Make Explore and Atlas Discuss one grounded workflow

- Explore starts from an explicit question, topic, or interest and offers a small number of
  explanatory starter paths. Complete indexes and specialist controls remain available through
  progressive disclosure.
- The selected graph path and source records must be visible before or beside **Atlas Discuss**.
  Discuss compresses an inspectable path; it does not replace inspection.
- Cross-review synthesis may combine claims only through explicit canonical identities, confirmed
  relations, or clearly labelled reviewable proposals. Shared underlying datasets or sources must
  be grouped so repeated citation does not create false consensus.
- Preserve genuine disagreements, scope differences, missing evidence, and uncertainty. Do not
  average them into a single unsupported answer.
- Every generated statement must cite exact node versions and source reviews, and the UI should
  highlight the supporting path. Model/provider, prompt or task, run time, evidence packet, and
  generation status must remain inspectable.
- An LLM may propose graph links or draft a synthesis. It may not rewrite a preserved review,
  confirm an edge, or present generated text as canonical knowledge by itself.
- A synthesis that is saved or published becomes a **separate, versioned derivative record** with
  full source lineage, software-generation provenance, staleness detection, and an accountable
  editorial decision.

## 6. End-to-end release gate

A feature is not “functional” merely because a route or button exists. A release must verify these
journeys with real, non-demo accepted records:

1. Home → Allen template guidance → clear submission instructions.
2. GitHub sign-in → repository inspection → exact-version capture → validation → editorial status →
   public immutable review.
3. Full review and figures → claim passport → evidence → assessment/disagreement → provenance.
4. Claim-level comment → reply → formal challenge or update proposal → resolution or new version →
   visible diff and lineage.
5. Explore at least two reviews → grounded multi-review answer → exact source highlighting → draft
   or published synthesis, with no mutation of the source reviews.

Fail the release when a core action is a placeholder, demo content is presented as real, the graph
shows unrelated records, an accepted review cannot be read in full, or an LLM statement cannot be
resolved to exact source versions.

## Language rules

Use **submit repository**, **accepted into the archive**, **AI-generated synthesis**, **proposed
relation**, and **editor-confirmed relation**. Avoid **upload paper**, **peer-reviewed**, **truth
score**, or **consensus** unless the underlying record explicitly supports that wording.
