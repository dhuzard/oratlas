# Stable scholarly deep links

Public scholarly objects use immutable identifiers in their paths or additive fragment anchors.
Clients must URL-encode every placeholder. Fragment identifiers are part of the public contract and
must not be renamed when presentation changes.

| Object                         | Stable URL pattern                                                            |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Review version                 | `/reviews/{reviewSlug}/versions/{reviewVersionId}`                            |
| Claim passport                 | `/claims/{reviewVersionId}/{localClaimId}`                                    |
| Citation in a review version   | `/reviews/{reviewSlug}/versions/{reviewVersionId}#citation-{localCitationId}` |
| Claim–citation relation        | `/reviews/{reviewSlug}/versions/{reviewVersionId}#relation-{relationId}`      |
| TRUST assessment on a relation | `/reviews/{reviewSlug}/versions/{reviewVersionId}#assessment-{assessmentId}`  |
| Knowledge node version         | `/nodes/{nodeId}/versions/{nodeVersionId}`                                    |
| Graph edge                     | `/graph?seed={nodeId}&edgeStatus=confirmed&depth=1&limit=50#edge-{edgeId}`    |
| Accepted synthesis version     | `/reviews/{reviewSlug}/syntheses/{synthesisVersionId}`                        |

The unversioned review path remains the discovery URL for the current public review or synthesis.
An accepted synthesis links back to its immutable version URL from its masthead. A graph-edge URL
must retain query parameters that include the edge in the bounded result page.

Challenges are intentionally absent from this inventory until ORA-E01 introduces their public data
model and URL. ORA-H02 does not pre-empt that governance and schema work.
