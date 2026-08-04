# Guided knowledge landscape API

`GET /api/landscape` gives agents the same bounded, graph-native exploration projection that
readers see in Explore. The endpoint does not infer a profile and does not rewrite or score the
scientific record.

```sh
curl --get http://localhost:3000/api/landscape \
  --data-urlencode 'q=replication' \
  --data-urlencode 'interest=reproducibility' \
  --data-urlencode 'interest=disagreements'
```

To request the same one-hop view as the GUI, pass a returned node ID as `focus`:

```sh
curl --get http://localhost:3000/api/landscape \
  --data-urlencode 'interest=disagreements' \
  --data-urlencode 'focus=claim:RETURNED_CLAIM_ID'
```

The response includes:

- `schemaVersion` and an independent navigation-algorithm version;
- normalized explicit query and interest state;
- the same review, claim, evidence, graph node, confirmed edge, explanation, and year objects used
  by the GUI;
- stable graph node IDs, exact readable node-version IDs, and links to both the preserved version
  and its graph neighborhood;
- machine-readable limitations stating that the ordering is not a truth or quality score;
- no more than six claims, ten citation-evidence records, three graph seeds, and twelve graph
  identities.

Graph recommendations use only the stored `Claim.knowledgeNodeId` bridge. ORAtlas does not infer
node identity from lexical similarity. The personalized projection includes confirmed public graph
edges only; proposed edges remain available through the specialist graph contract with their
separate status.

Unknown interests return `400` rather than silently creating a hidden personalization category. An
unknown focus ID returns the overview projection, preserving a deterministic and reversible result.
See `docs/openapi.yaml` for the complete contract.
