-- G1 synthetic PUBLIC discovery fixtures. Append after public-fixtures.sql, inside each reset.
-- No live producer, private content, scientific endorsement, canonical merge or membership grant.
-- Exact native MyST 0.3 manifest/0.2 claim bytes live in discovery.manifest.json/discovery.claims.jsonl.
-- These are synthetic protocol-shaped fixtures, not captured output of a producer execution.
-- Existing base-fixture rows are untouched; source occurrences remain distinct from graph nodes.
INSERT INTO "Publication" (
  "id", "stableKey", "publicationType", "recordSource", "identityEvidenceJson", "createdAt", "updatedAt"
) VALUES (
  'g1-discovery-publication',
  'g1-discovery:publication',
  'research-article',
  'external-publication',
  '{"basis":"registration","registrationKey":"g1-discovery-fixture"}',
  '2026-03-12T00:00:00.000Z',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationVersion" (
  "id", "publicationId", "stableKey", "sourcesSha256", "versionLabel", "title", "canonicalUrl", "observedPublicationBaseUrl", "adapterType", "adapterBindingJson", "structuralProvenance", "contentCorpusJson", "contentCorpusSha256", "contentCompletenessJson", "contributorsDeclared", "observedAt", "createdAt"
) VALUES (
  'g1-discovery-version',
  'g1-discovery-publication',
  'g1-discovery:version-1',
  'de3d3960b987df55170f1389cd5ece8544d1733a539ab7fdebc8c58c3abc0076',
  'v1',
  'G1 public discovery fixture',
  'https://publications.g1.oratlas.example/discovery/',
  'https://publications.g1.oratlas.example/discovery/',
  'myst',
  '{"crossReferenceInventoryPath":"myst.xref.json","generatorName":"g1-synthetic","generatorVersion":"1","protocolVersion":"0.3.0","type":"myst"}',
  'published-structure',
  '[{"id":"g1-discovery-document","publishedUrl":"https://publications.g1.oratlas.example/discovery/article","representation":"source-text","role":"results","sha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourceArtifactIdentitySha256":"17f318edde9cd8fc6f8473dbe80d7763d9ef99eb35530d080b718bd59c4889e4","sourceArtifactSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourcePath":"article.md","text":"Synthetic public result: alpha and beta are independent fixture labels.","title":"G1 public discovery result"}]',
  'b860917604289dd04b0f16f63d17846687331979a836a6cf2761d6d49708caf7',
  '{"coverage":"complete","returnedDocuments":1,"totalDocumentsKnown":1,"truncated":false}',
  true,
  '2026-03-12T00:00:00.000Z',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationCapture" (
  "id", "publicationVersionId", "artifactKind", "artifactIdentitySha256", "declaredPath", "requestedUrl", "observedUrl", "mediaType", "contentSha256", "byteLength", "contentBytes", "declaredSha256", "structuralProvenance", "capturedAt", "createdAt"
) VALUES (
  'g1-discovery-manifest',
  'g1-discovery-version',
  'publication-manifest',
  'ba0969399c05d646c5703cf94a829be4a4dc5879203422d425f34bd399c27395',
  NULL,
  'https://publications.g1.oratlas.example/discovery/oratlas.manifest.json',
  'https://publications.g1.oratlas.example/discovery/oratlas.manifest.json',
  'application/json',
  'a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43',
  1298,
  '{
  "adapter": { "type": "myst", "xref": "myst.xref.json" },
  "artifacts": {
    "claims": {
      "declarations": "publication-source",
      "format": "jsonl",
      "path": "oratlas/claims.jsonl",
      "records": 1,
      "sha256": "448bb4fdff5ae233d2afeccd4611d00d44998c191bc62786614e35531ba41e05"
    }
  },
  "contributors": [
    {
      "displayName": "G1 Discovery Author",
      "kind": "person",
      "position": 1,
      "roles": ["author"],
      "sourceContributorKey": "author-1"
    }
  ],
  "generator": { "name": "g1-synthetic", "version": "1" },
  "production": {
    "actors": [
      {
        "activities": ["drafting"],
        "id": "synthetic-tool",
        "kind": "software",
        "name": "Synthetic Discovery Tool",
        "version": "fixture-1"
      }
    ],
    "mode": "ai-assisted",
    "sourceAssertionKey": "synthetic-production",
    "statement": "Synthetic source declaration, never scientific verification.",
    "strength": "source-declared"
  },
  "publication": {
    "canonicalUrl": "https://publications.g1.oratlas.example/discovery/",
    "title": "G1 public discovery fixture",
    "version": {
      "label": "v1",
      "sourcesSha256": "de3d3960b987df55170f1389cd5ece8544d1733a539ab7fdebc8c58c3abc0076"
    }
  },
  "schemaVersion": "0.3.0"
}
',
  'a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43',
  'published-structure',
  '2026-03-12T00:00:00.000Z',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationCapture" (
  "id", "publicationVersionId", "artifactKind", "artifactIdentitySha256", "declaredPath", "requestedUrl", "observedUrl", "mediaType", "contentSha256", "byteLength", "contentBytes", "declaredSha256", "structuralProvenance", "capturedAt", "createdAt"
) VALUES (
  'g1-discovery-source',
  'g1-discovery-version',
  'source-document',
  '17f318edde9cd8fc6f8473dbe80d7763d9ef99eb35530d080b718bd59c4889e4',
  'article.md',
  'https://publications.g1.oratlas.example/discovery/article.md',
  'https://publications.g1.oratlas.example/discovery/article.md',
  'text/plain',
  '53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08',
  71,
  'Synthetic public result: alpha and beta are independent fixture labels.',
  '53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08',
  'published-structure',
  '2026-03-12T00:00:00.000Z',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationVersionContributor" (
  "id", "publicationVersionId", "sourceContributorKey", "kind", "displayName", "rolesJson", "position", "sourceDeclarationProvenanceJson", "createdAt"
) VALUES (
  'g1-discovery-contributor',
  'g1-discovery-version',
  'author-1',
  'person',
  'G1 Discovery Author',
  '["author"]',
  1,
  '{"sourceArtifactIdentitySha256":"ba0969399c05d646c5703cf94a829be4a4dc5879203422d425f34bd399c27395","sourceArtifactKind":"publication-manifest","sourceArtifactSha256":"a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43","type":"source-declared"}',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationProductionAssertion" (
  "id", "publicationVersionId", "sourceAssertionKey", "mode", "actorsJson", "activitiesJson", "statement", "strength", "assertedAt", "createdAt"
) VALUES (
  'g1-discovery-production',
  'g1-discovery-version',
  'synthetic-production',
  'ai-assisted',
  '[{"kind":"software","name":"Synthetic Discovery Tool","version":"fixture-1"}]',
  '["drafting"]',
  'Synthetic source declaration, never scientific verification.',
  'source-declared',
  '2026-03-12T00:00:00.000Z',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationClaimOccurrence" (
  "id", "publicationVersionId", "sourceLocalClaimId", "stableKey", "targetJson", "publishedUrl", "sourceBindingJson", "selectorJson", "declarationSha256", "declarationAuthority", "text", "claimType", "createdAt"
) VALUES (
  'g1-discovery-occurrence',
  'g1-discovery-version',
  'synthetic-result',
  'g1-discovery:occurrence',
  '{"htmlId":"synthetic-result","identifier":"synthetic-result","type":"myst-xref"}',
  'https://publications.g1.oratlas.example/discovery/article#synthetic-result',
  '{"blockSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","documentPath":"article.md","documentSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","endLine":1,"startLine":1}',
  '{"representation":"oratlas-myst-source-utf8-v1","textPosition":{"end":71,"start":0,"type":"TextPositionSelector"},"textQuote":{"exact":"Synthetic public result: alpha and beta are independent fixture labels.","type":"TextQuoteSelector"},"unit":"body"}',
  '6a8159c20e6f58a8f5da18a3c970df1f92f0bd232f2b34c53d0cf5a99c4e7503',
  'publication-source',
  'Synthetic public result: alpha and beta are independent fixture labels.',
  'empirical',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "PublicationRelation" (
  "id", "sourcePublicationId", "targetPublicationId", "relationType", "rationale", "reviewedById", "reviewedAt", "createdAt"
) VALUES (
  'g1-discovery-relation',
  'g1-discovery-publication',
  'g1-publication-1',
  'derived-from',
  'Explicit synthetic fixture relation; no canonical identity merge.',
  'g1-user-admin',
  '2026-03-12T00:00:00.000Z',
  '2026-03-12T00:00:00.000Z'
);
INSERT INTO "Claim" (
  "id", "reviewVersionId", "localClaimId", "text", "normalizedText", "claimType", "createdAt"
) VALUES (
  'g1-discovery-claim-tombstoned',
  'g1-version-tombstoned',
  'discovery-claim',
  'Tombstoned discovery claim must never escape.',
  'tombstoned discovery claim must never escape.',
  'empirical',
  '2026-03-12T00:00:00.000Z'
);
-- One explicit synthetic editorial edge: source assertions alone must not appear in this DTO.
INSERT INTO "NodeEdge" ("id", "sourceNodeVersionId", "targetNodeId", "relationType", "status",
  "provenance", "rationale", "confirmedTargetNodeVersionId", "confirmedById", "confirmedAt",
  "createdAt", "updatedAt")
VALUES ('g1-discovery-confirmed-edge', 'g1-node-1-v1', 'g1-node-2', 'background', 'confirmed',
  'confirmed-by-editor', 'Synthetic explicit editorial confirmation fixture only.',
  'g1-node-2-v1', 'g1-user-admin', TIMESTAMP '2026-03-12 00:00:00',
  TIMESTAMP '2026-03-12 00:00:00', TIMESTAMP '2026-03-12 00:00:00');
