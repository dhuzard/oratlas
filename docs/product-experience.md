# ORAtlas product experience

ORAtlas is a public archive for AI-generated scientific reviews. It complements the Allen
computational-review workflow rather than replacing it:

1. **Generate** — authors use
   [ComputationalReviewTemplate](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate)
   to scope, gather evidence, draft, criticize, verify, and publish a MyST review.
2. **Deposit** — ORAtlas inspects and captures an exact public GitHub commit or release, then an
   editor decides whether it enters the archive.
3. **Inspect** — readers discover the versioned record and move from its preserved article to exact
   claims, citations, evidence relations, and TRUST assessments.
4. **Respond** — attributed comments, formal challenges, assessment disagreements, and later
   versions remain separate records. They never rewrite the deposited source.
5. **Compare** — review-level coverage and claim-level records can be placed side by side without
   creating a universal score or ranking.

## Primary information architecture

| Surface          | User question                                                               | Responsibility                                            |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Reviews          | What AI reviews have been deposited?                                        | Review-first archive discovery                            |
| Explore evidence | How are reviews, claims, evidence, and research objects connected?          | Bounded graph traversal and grounded discussion           |
| Compare          | How do two deposits differ in claims, evidence coverage, and TRUST records? | Neutral side-by-side projection with exact record links   |
| Create & deposit | How do I generate a review and make it available here?                      | Allen workflow guide and ORAtlas handoff                  |
| Review reader    | What does this immutable version say, cite, assess, and dispute?            | Safe preserved reading plus contextual scientific actions |

Graph, nodes, coverage, synthesis, replication, and editorial tools remain available as specialist
surfaces. They do not compete with the four primary public journeys.

## Scientific semantics

- Archive acceptance is curation, not peer review or endorsement.
- A missing claim, citation, or TRUST record means the deposit does not expose it to ORAtlas; it is
  not a negative quality judgment.
- Repository-declared and agent-proposed TRUST stays visibly distinct from human-reviewed or
  adjudicated TRUST.
- Comparison counts describe coverage only. They are not confidence or quality scores.
- Several reviews citing the same work are not independent replications.
- Comments are open discussion. Formal challenges are immutable, attributable objections to exact
  subjects. Neither silently mutates the review.

## Current safe-rendering boundary

The reader renders captured Markdown/MyST structure from the immutable database snapshot and never
executes repository HTML, JavaScript, or MyST plugins. Structured claim annotations link that source
record to evidence, discussion, and challenges. Full multi-file MyST AST fidelity and direct
citation/mention comment anchors require a separately reviewed preservation and data-model
extension; the interface must not pretend mutable upstream Pages output is the archived record.
