-- G1 synthetic PUBLIC discovery fixtures. Append after public-fixtures.sql, inside each reset.
-- No live producer, private content, scientific endorsement, canonical merge or membership grant.
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
  '73fce482f3180f2bc684bad2a97d7246ab1c751c3c2dc65d09d0f7b75f08a78f',
  'v1',
  'G1 public discovery fixture',
  'https://publications.g1.oratlas.example/discovery/',
  'https://publications.g1.oratlas.example/discovery/',
  'myst',
  '{"crossReferenceInventoryPath":"myst.xref.json","generatorName":"g1-synthetic","generatorVersion":"1","protocolVersion":"0.2.0","type":"myst"}',
  'published-structure',
  '[{"id":"g1-discovery-document","publishedUrl":"https://publications.g1.oratlas.example/discovery/article","representation":"source-text","role":"results","sha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourceArtifactIdentitySha256":"6b9e400090a3afd8304bce7afb9e6a735a7b86f0818f5fee5f5774bacb735e0e","sourceArtifactSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourcePath":"article.md","text":"Synthetic public result: alpha and beta are independent fixture labels.","title":"G1 public discovery result"}]',
  '95f141b6198ca68b61ac90b10b096602ea283b9e876e80e264c06e29c85a79fa',
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
  'ee25eab560fc2cb1d2d431110812508cdf78493fda947bfc9af13243db7bd1ed',
  NULL,
  'https://publications.g1.oratlas.example/discovery/oratlas.manifest.json',
  'https://publications.g1.oratlas.example/discovery/oratlas.manifest.json',
  'application/json',
  '490df2e64421971f9a3d5eca777f0bf716c947b8fd1983525c114eccee450232',
  105,
  'eyJjb250cmlidXRvcnMiOlt7ImRpc3BsYXlOYW1lIjoiRzEgRGlzY292ZXJ5IEF1dGhvciJ9XSwiaWQiOiJnMS1kaXNjb3ZlcnktcHVibGljYXRpb24iLCJzeW50aGV0aWMiOnRydWV9',
  '490df2e64421971f9a3d5eca777f0bf716c947b8fd1983525c114eccee450232',
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
  '6b9e400090a3afd8304bce7afb9e6a735a7b86f0818f5fee5f5774bacb735e0e',
  'article.md',
  'https://publications.g1.oratlas.example/discovery/article.md',
  'https://publications.g1.oratlas.example/discovery/article.md',
  'text/plain',
  '53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08',
  71,
  'U3ludGhldGljIHB1YmxpYyByZXN1bHQ6IGFscGhhIGFuZCBiZXRhIGFyZSBpbmRlcGVuZGVudCBmaXh0dXJlIGxhYmVscy4=',
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
  '{"sourceArtifactIdentitySha256":"ee25eab560fc2cb1d2d431110812508cdf78493fda947bfc9af13243db7bd1ed","sourceArtifactKind":"publication-manifest","sourceArtifactSha256":"490df2e64421971f9a3d5eca777f0bf716c947b8fd1983525c114eccee450232","type":"source-declared"}',
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
