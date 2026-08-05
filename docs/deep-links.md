# Stable scholarly deep links

Public scholarly objects use immutable identifiers in their paths or additive fragment anchors.
Clients must URL-encode every placeholder. Fragment identifiers are part of the public contract and
must not be renamed when presentation changes.

| Object                         | Stable URL pattern                                                            |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Graph traversal entry          | `/explore?q={topic}`                                                          |
| Explicit-interest landscape    | `/explore?interest={interest}`                                                |
| Focused landscape node         | `/explore?interest={interest}&focus={nodeId}`                                 |
| Reader-held known set          | `/explore?interest={interest}&known={nodeId}`                                 |
| Review version                 | `/reviews/{reviewSlug}/versions/{reviewVersionId}`                            |
| Claim passport                 | `/claims/{reviewVersionId}/{localClaimId}`                                    |
| Citation in a review version   | `/reviews/{reviewSlug}/versions/{reviewVersionId}#citation-{localCitationId}` |
| Claim–citation relation        | `/reviews/{reviewSlug}/versions/{reviewVersionId}#relation-{relationId}`      |
| TRUST assessment on a relation | `/reviews/{reviewSlug}/versions/{reviewVersionId}#assessment-{assessmentId}`  |
| Knowledge node version         | `/nodes/{nodeId}/versions/{nodeVersionId}`                                    |
| Graph edge                     | `/graph?seed={nodeId}&edgeStatus=confirmed&depth=1&limit=50#edge-{edgeId}`    |
| Accepted synthesis version     | `/reviews/{reviewSlug}/syntheses/{synthesisVersionId}`                        |
| Formal challenge on a review   | `/reviews/{reviewSlug}/versions/{reviewVersionId}#challenge-{challengeId}`    |
| Formal challenge on a node     | `/nodes/{nodeId}#challenge-{challengeId}`                                     |

The unversioned review path remains the discovery URL for the current public review or synthesis.
An accepted synthesis links back to its immutable version URL from its masthead. A graph-edge URL
must retain query parameters that include the edge in the bounded result page.

Explore accepts repeated `interest` and `known` parameters. The legacy `view`, `sort`, and `page`
parameters no longer select row-oriented result views. `known` contains explicit canonical
graph node identifiers selected by the reader; it is URL-held state and is never inferred or
persisted in the shared graph. Topic, interests, filters, focus, and known nodes are additive URL state
and should be retained when constructing a more specific Explore link. Removing `focus` returns to
the same overview without discarding the other parameters. The accepted interest values,
focus-node format, and known-set bounds are versioned in the
[landscape API contract](knowledge-landscape-api.md).

Formal challenge anchors identify immutable public challenge records within their review-version
or knowledge-node context. They must not be reused for a different challenge after moderation or a
lifecycle transition.
