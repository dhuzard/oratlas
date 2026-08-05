# Canonical graph traversal API

`GET /api/graph` is the reader-agnostic representation of public Atlas knowledge. It returns exact
node versions and authoritative typed edges, never rendering links or reader-specific ordering.

```sh
curl --get http://localhost:3000/api/graph \
  --data-urlencode 'seed=RETURNED_NODE_ID' \
  --data-urlencode 'version=OPTIONAL_EXACT_VERSION_ID' \
  --data-urlencode 'direction=both' \
  --data-urlencode 'status=authoritative' \
  --data-urlencode 'limit=25'
```

Each node-version record identifies one exact source union member:

- a repository snapshot and commit;
- a review version;
- a claim occurrence; or
- a citation occurrence attached to a canonical work identity.

The response includes canonical content, provenance, payload, aliases, and source/repository
identity. It contains no `href`, graph link, card detail, drawing coordinate, interest, known-set,
or recommendation score.

Traversal is one exact adjacency page at a time. Follow `page.nextCursor` until absent, then expand
any returned `nodeId`/`nodeVersionId` pair with another request. This replaces server-side depth and
cumulative frontier caps: a high-degree node is page-limited, not silently truncated. Cursors are
signed and bound to the exact seed version and filters.

`status=authoritative` includes both source-native review assertions and editor-confirmed graph
relations. `source-assertion` and `confirmed` select either class. Proposals, rejected edges, and
superseded edges are lifecycle records outside the canonical knowledge traversal. Source assertions
carry the public, fail-closed TRUST projections attached to their exact compatibility relation;
confirmed relations carry their exact public relation assessments. A review version reaches each
contained exact claim through `asserts`; claims then reach cited work versions through their typed
evidence relation.

Topic and full-text discovery remain entry-point services. They return stable node references; they
do not redefine or bound the graph reached from those references.
