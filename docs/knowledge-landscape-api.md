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

The `explicit-interest-recommendation@2.0.0` response contains:

- the normalized explicit query and interest state;
- ordered `nodeId` references and an exact `nodeVersionId` when the ranking selected one exact
  occurrence;
- relative `rank`, `score`, and human-readable `reasons` that explain only the ordering;
- `omittedUnboundCount`, which exposes compatibility rows that could not yet resolve to canonical
  graph identities instead of inventing identifiers;
- limitations stating that the ordering is neither a truth score nor a quality score.

It never returns labels, details, record URLs, graph URLs, timelines, or drawing coordinates. Those
are rendering concerns. `focus` is GUI-only traversal state and returns `400` on this endpoint.
Unknown interests also return `400` rather than silently creating a hidden personalization category.

The ranking is intentionally bounded to the current six-claim, ten-evidence, twelve-neighbor
recommendation window. Those bounds limit recommendation work; they do not limit canonical graph
traversal. The graph remains reader-agnostic and does not store interests or known-set state.

## Atlas Discuss scope

`POST /api/discuss` continues to accept the explicit Explore scope and resolves it internally to a
closed evidence packet. Discuss is a bounded, grounded lens over selected graph records; it is not
the canonical representation and does not broaden an empty or irrelevant packet.
