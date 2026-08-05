# Explicit-interest recommendation API

`GET /api/landscape` is a derived, reader-specific ranking overlay. It does not return a second
knowledge representation: every item is only a canonical graph node reference, an ordering score,
and an explanation. Resolve referenced records through `GET /api/graph`.

```sh
curl --get http://localhost:3000/api/landscape \
  --data-urlencode 'q=replication' \
  --data-urlencode 'interest=reproducibility' \
  --data-urlencode 'interest=disagreements'
```

Readers may explicitly declare graph identities they already know. The set is request/URL state,
not a server profile:

```sh
curl --get http://localhost:3000/api/landscape \
  --data-urlencode 'interest=methods-models' \
  --data-urlencode 'known=KNOWN_NODE_ID'
```

The `explicit-interest-recommendation@2.0.0` response contains:

- the normalized explicit query and interest state;
- ordered `nodeId` references and a required exact `nodeVersionId` for every selected occurrence;
- relative `rank`, `score`, and human-readable `reasons` that explain only the ordering;
- an `anchors` array containing only editor-confirmed exact edges between the recommendation and a
  node in the submitted known set; an empty array means no confirmed anchor was found;
- `omittedUnboundCount`, retained as a compatibility counter and zero for graph-native selection;
- limitations stating that the ordering is neither a truth score nor a quality score.

It never returns labels, details, record URLs, graph URLs, timelines, or drawing coordinates. Those
are rendering concerns. `focus` is GUI-only traversal state and returns `400` on this endpoint.
Unknown interests also return `400` rather than silently creating a hidden personalization category.

Selection starts from readable canonical claim versions, applies relation and assessment filters to
canonical edges, and never reconstructs evidence relationships from the relational presentation
projection. The ranking is intentionally bounded to three entry neighborhoods and twelve exact
node versions. Those bounds limit recommendation work; they do not limit canonical graph traversal.
The graph remains reader-agnostic and does not store interests or known-set state.

`reviewSlug` remains a compatibility input identifier only. The service resolves the slug to the
review's canonical node ID once, then discovers claim versions and relations exclusively through
canonical graph records; the legacy knowledge index is never built for Explore or recommendations.

## Atlas Discuss scope

`POST /api/discuss` requires the signed exact traversal scope rendered by Explore: every visible
`nodeId` + `nodeVersionId` pair and every visible canonical edge id. The API verifies the signature,
revalidates that each occurrence and edge is still public and connected to that exact set, and then
selects evidence only from those references. It never re-runs a search or recommendation query.
Empty, edited, missing, or stale scopes fail closed. The standalone `/discuss` page is therefore an
entry link to Explore, not an archive-wide question surface.
