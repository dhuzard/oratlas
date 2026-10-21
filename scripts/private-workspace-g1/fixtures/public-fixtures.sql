-- G1 deterministic PUBLIC fixtures (docs/private-workspace-g1-harness.md).
-- Synthetic, non-research rows for a disposable database only. Fixed IDs, SHAs and timestamps so
-- paired captures are byte-comparable. Contains no private data, no real identifiers and no real
-- people: users, ORCID iDs (outside the assigned ORCID ranges), GitHub identities, DOIs
-- (10.5555 example prefix) and URLs (*.oratlas.example) are synthetic. The orchestrator reloads
-- this file after truncating the run-created public tables before every capture child.

-- Five synthetic principals (scripts/private-workspace-g1/principals.ts). A/B are labels only.
INSERT INTO "User" ("id", "githubUserId", "githubLogin", "githubLoginNormalized", "displayName",
  "role", "orcid", "orcidVerifiedAt", "createdAt", "updatedAt")
VALUES
  ('g1-user-a-only', 'g1-synthetic-github-0001', 'g1-fixture-a-only', 'g1-fixture-a-only',
    'G1 Fixture A-only', 'USER', '0000-0000-0000-0001', TIMESTAMP '2026-01-10 00:00:00',
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'),
  ('g1-user-b-only', 'g1-synthetic-github-0002', 'g1-fixture-b-only', 'g1-fixture-b-only',
    'G1 Fixture B-only', 'USER', '0000-0000-0000-0002', NULL,
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'),
  ('g1-user-a-and-b', 'g1-synthetic-github-0003', 'g1-fixture-a-and-b', 'g1-fixture-a-and-b',
    'G1 Fixture A+B', 'USER', '0000-0000-0000-0003', NULL,
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'),
  ('g1-user-editor', 'g1-synthetic-github-0004', 'g1-fixture-editor', 'g1-fixture-editor',
    'G1 Fixture Editor', 'EDITOR', '0000-0000-0000-0004', NULL,
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'),
  ('g1-user-admin', 'g1-synthetic-github-0005', 'g1-fixture-admin', 'g1-fixture-admin',
    'G1 Fixture Admin', 'ADMIN', '0000-0000-0000-0005', NULL,
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00');

-- Each principal owns non-empty notifications; A-only owns two (one is marked read by its owner,
-- the other is the cross-user target that must stay unread).
INSERT INTO "Notification" ("id", "userId", "kind", "subjectType", "subjectId", "payloadJson",
  "readAt", "createdAt")
VALUES
  ('g1-notification-a-only-1', 'g1-user-a-only', 'decision-issued', 'submission',
    'g1-fixture-submission-a', '{}', NULL, TIMESTAMP '2026-03-20 00:00:00'),
  ('g1-notification-a-only-2', 'g1-user-a-only', 'evidence-alert', 'review', 'g1-review-1', '{}',
    NULL, TIMESTAMP '2026-03-21 00:00:00'),
  ('g1-notification-b-only-1', 'g1-user-b-only', 'round-opened', 'submission',
    'g1-fixture-submission-b', '{}', NULL, TIMESTAMP '2026-03-22 00:00:00'),
  ('g1-notification-a-and-b-1', 'g1-user-a-and-b', 'report-submitted', 'submission',
    'g1-fixture-submission-ab', '{}', NULL, TIMESTAMP '2026-03-23 00:00:00'),
  ('g1-notification-editor-1', 'g1-user-editor', 'editor-assigned', 'submission',
    'g1-fixture-submission-e', '{}', NULL, TIMESTAMP '2026-03-24 00:00:00'),
  ('g1-notification-admin-1', 'g1-user-admin', 'review-comment-created', 'review',
    'g1-review-2', '{}', NULL, TIMESTAMP '2026-03-25 00:00:00');

INSERT INTO "Repository" ("id", "host", "owner", "name", "canonicalUrl", "githubRepositoryId",
  "defaultBranch", "description", "licenseSpdx", "topicsJson", "isArchived", "createdAt", "updatedAt")
VALUES
  ('g1-repo-1', 'github.com', 'oratlas-g1-fixture', 'g1-review',
    'https://github.com/oratlas-g1-fixture/g1-review', '910000001', 'main',
    'Synthetic G1 harness fixture repository', 'CC-BY-4.0', '[]', false,
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00'),
  ('g1-repo-2', 'github.com', 'oratlas-g1-fixture', 'g1-second-review',
    'https://github.com/oratlas-g1-fixture/g1-second-review', '910000002', 'main',
    'Second synthetic G1 harness fixture repository', 'CC-BY-4.0', '[]', false,
    TIMESTAMP '2026-03-01 00:00:00', TIMESTAMP '2026-03-01 00:00:00'),
  ('g1-repo-3', 'github.com', 'oratlas-g1-fixture', 'g1-control',
    'https://github.com/oratlas-g1-fixture/g1-control', '910000003', 'main',
    'Synthetic non-public control repository', 'CC-BY-4.0', '[]', false,
    TIMESTAMP '2026-03-01 00:00:00', TIMESTAMP '2026-03-01 00:00:00');

INSERT INTO "RepositorySnapshot" ("id", "repositoryId", "commitSha", "branch", "capturedAt",
  "inspectionStatus", "inspectionReportJson", "contentHash")
VALUES
  ('g1-snap-1', 'g1-repo-1', '1111111111111111111111111111111111111111', 'main',
    TIMESTAMP '2026-01-02 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-1'),
  ('g1-snap-2', 'g1-repo-1', '2222222222222222222222222222222222222222', 'main',
    TIMESTAMP '2026-02-02 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-2'),
  ('g1-snap-3', 'g1-repo-3', '3333333333333333333333333333333333333333', 'main',
    TIMESTAMP '2026-03-02 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-3'),
  ('g1-snap-4', 'g1-repo-2', '4444444444444444444444444444444444444444', 'main',
    TIMESTAMP '2026-03-04 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-4');

-- Two published reviews are the public search heads. The control review is not `published`, so
-- its newest version (published-state but never publishedAt) cannot become a public head in
-- search, claims, sitemap, feeds or the graph; it is the expected-excluded control.
INSERT INTO "Review" ("id", "slug", "repositoryId", "currentSnapshotId", "title", "abstract",
  "reviewType", "licenseSpdx", "status", "acceptedAt", "createdAt", "updatedAt", "lifecycleRevision")
VALUES
  ('g1-review-1', 'g1-fixture-review', 'g1-repo-1', 'g1-snap-2',
    'G1 fixture review & public baseline', 'Synthetic abstract <for> the G1 public baseline.',
    'systematic', 'CC-BY-4.0', 'published', TIMESTAMP '2026-01-03 00:00:00',
    TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-02-03 00:00:00', 1),
  ('g1-review-2', 'g1-second-review', 'g1-repo-2', 'g1-snap-4',
    'G1 second fixture review', 'Second synthetic public review.', 'scoping', 'CC-BY-4.0',
    'published', TIMESTAMP '2026-03-05 00:00:00', TIMESTAMP '2026-03-01 00:00:00',
    TIMESTAMP '2026-03-05 00:00:00', 1),
  ('g1-review-control', 'g1-control-review', 'g1-repo-3', 'g1-snap-3',
    'G1 non-public control review', 'Must not appear in public discovery.', 'systematic',
    'CC-BY-4.0', 'withdrawn', NULL, TIMESTAMP '2026-03-01 00:00:00',
    TIMESTAMP '2026-03-03 00:00:00', 1);

-- Feed order: v4, v2, v1. The control version is excluded everywhere.
INSERT INTO "ReviewVersion" ("id", "reviewId", "snapshotId", "recordSourceType", "semanticVersion",
  "title", "abstract", "metadataJson", "publishedAt", "createdAt", "publicState")
VALUES
  ('g1-version-1', 'g1-review-1', 'g1-snap-1', 'repository', '1.0.0',
    'G1 fixture review v1', 'First synthetic public version.', '{}',
    TIMESTAMP '2026-01-03 12:00:00', TIMESTAMP '2026-01-03 12:00:00', 'published'),
  ('g1-version-2', 'g1-review-1', 'g1-snap-2', 'repository', '1.1.0',
    'G1 fixture review v2 & "quoted"', 'Second synthetic public version.', '{}',
    TIMESTAMP '2026-02-03 12:00:00', TIMESTAMP '2026-02-03 12:00:00', 'published'),
  ('g1-version-3', 'g1-review-control', 'g1-snap-3', 'repository', '1.2.0',
    'G1 fixture unpublished draft', 'Must not appear in public discovery.', '{}',
    NULL, TIMESTAMP '2026-03-03 12:00:00', 'published'),
  ('g1-version-4', 'g1-review-2', 'g1-snap-4', 'repository', '1.0.0',
    'G1 second fixture review v1', 'Synthetic second public version.', '{}',
    TIMESTAMP '2026-03-05 12:00:00', TIMESTAMP '2026-03-05 12:00:00', 'published');

INSERT INTO "Person" ("id", "displayName", "givenName", "familyName")
VALUES
  ('g1-person-1', 'Fixture Author One', 'Fixture', 'One'),
  ('g1-person-2', 'Fixture Author Two', 'Fixture', 'Two');

INSERT INTO "ReviewContributor" ("reviewVersionId", "personId", "rolesJson", "position")
VALUES
  ('g1-version-1', 'g1-person-1', '[]', 0),
  ('g1-version-2', 'g1-person-2', '[]', 0),
  ('g1-version-2', 'g1-person-1', '[]', 1),
  ('g1-version-3', 'g1-person-1', '[]', 0),
  ('g1-version-4', 'g1-person-2', '[]', 0);

-- Lifecycle ledger: two public events (order: review 2, then review 1) and one control event on
-- the non-public review that the feed must exclude.
INSERT INTO "ReviewLifecycleEvent" ("id", "reviewId", "reviewVersionId", "actorId", "kind",
  "reason", "supersedesVersionId", "revision", "createdAt")
VALUES
  ('g1-lifecycle-1', 'g1-review-1', 'g1-version-2', 'g1-user-editor', 'correction',
    'Synthetic correction: 1.1.0 supersedes 1.0.0.', 'g1-version-1', 1,
    TIMESTAMP '2026-02-03 13:00:00'),
  ('g1-lifecycle-2', 'g1-review-2', 'g1-version-4', 'g1-user-admin', 'correction',
    'Synthetic metadata correction.', NULL, 1, TIMESTAMP '2026-03-06 09:00:00'),
  ('g1-lifecycle-control', 'g1-review-control', 'g1-version-3', 'g1-user-editor', 'withdrawal',
    'Control event on a non-public review.', NULL, 1, TIMESTAMP '2026-03-07 09:00:00');

-- Claims on both public heads (one with a citation and evidence relation) plus a control claim
-- on the non-public version.
INSERT INTO "Claim" ("id", "reviewVersionId", "localClaimId", "text", "normalizedText", "section",
  "claimType", "createdAt")
VALUES
  ('g1-claim-1', 'g1-version-2', 'claim-1',
    'Synthetic fixture claim: paired public captures are byte-identical.',
    'synthetic fixture claim: paired public captures are byte-identical.', 'Results',
    'empirical', TIMESTAMP '2026-02-03 12:00:00'),
  ('g1-claim-2', 'g1-version-4', 'claim-1',
    'Synthetic second claim without evidence relations.',
    'synthetic second claim without evidence relations.', 'Summary', 'summary',
    TIMESTAMP '2026-03-05 12:00:00'),
  ('g1-claim-control', 'g1-version-3', 'claim-1', 'Control claim that must stay hidden.',
    'control claim that must stay hidden.', 'Results', 'empirical',
    TIMESTAMP '2026-03-03 12:00:00');

INSERT INTO "Citation" ("id", "reviewVersionId", "localCitationId", "doi", "title", "year",
  "source")
VALUES
  ('g1-citation-1', 'g1-version-2', 'ref-1', '10.5555/g1-fixture-citation-1',
    'Synthetic fixture work', 2025, 'G1 Fixture Journal');

INSERT INTO "ClaimEvidenceRelation" ("id", "claimId", "citationId", "relationType",
  "supportDirection", "extractionMethod", "humanReviewed")
VALUES
  ('g1-relation-1', 'g1-claim-1', 'g1-citation-1', 'supports', 'supports', 'manifest', false);

-- Repository-object claim nodes on the published review-1 snapshot (readable), two source
-- assertions from node 1 (graph pagination with limit 1), one unconfirmed-target control edge and
-- a control node on the non-public snapshot (excluded from the sitemap).
INSERT INTO "KnowledgeNode" ("id", "originType", "repositoryId", "localNodeId", "kind",
  "createdAt", "updatedAt")
VALUES
  ('g1-node-1', 'repository-object', 'g1-repo-1', 'node-1', 'claim',
    TIMESTAMP '2026-02-02 00:00:00', TIMESTAMP '2026-02-02 00:00:00'),
  ('g1-node-2', 'repository-object', 'g1-repo-1', 'node-2', 'claim',
    TIMESTAMP '2026-02-02 00:00:00', TIMESTAMP '2026-02-02 00:00:00'),
  ('g1-node-3', 'repository-object', 'g1-repo-1', 'node-3', 'claim',
    TIMESTAMP '2026-02-02 00:00:00', TIMESTAMP '2026-02-02 00:00:00'),
  ('g1-node-control', 'repository-object', 'g1-repo-3', 'node-control', 'claim',
    TIMESTAMP '2026-03-02 00:00:00', TIMESTAMP '2026-03-02 00:00:00');

INSERT INTO "KnowledgeNodeVersion" ("id", "knowledgeNodeId", "snapshotId", "title",
  "contributorsJson", "license", "provenanceJson", "payloadJson", "createdAt")
VALUES
  ('g1-node-1-v1', 'g1-node-1', 'g1-snap-2', 'Synthetic seed claim node',
    '[{"displayName":"Fixture Author One"}]', 'CC-BY-4.0',
    '{"sourcePath":"nodes/node-1.json","sourcePointer":"/nodes/0"}',
    '{"statement":"Synthetic seed claim statement.","qualifiers":[]}',
    TIMESTAMP '2026-02-02 01:00:00'),
  ('g1-node-2-v1', 'g1-node-2', 'g1-snap-2', 'Synthetic supporting claim node',
    '[{"displayName":"Fixture Author Two"}]', 'CC-BY-4.0',
    '{"sourcePath":"nodes/node-2.json","sourcePointer":"/nodes/1"}',
    '{"statement":"Synthetic supporting claim statement.","qualifiers":["synthetic"]}',
    TIMESTAMP '2026-02-02 02:00:00'),
  ('g1-node-3-v1', 'g1-node-3', 'g1-snap-2', 'Synthetic contextual claim node',
    '[{"displayName":"Fixture Author One"}]', 'CC-BY-4.0',
    '{"sourcePath":"nodes/node-3.json","sourcePointer":"/nodes/2"}',
    '{"statement":"Synthetic contextual claim statement.","qualifiers":[]}',
    TIMESTAMP '2026-02-02 03:00:00'),
  ('g1-node-control-v1', 'g1-node-control', 'g1-snap-3', 'Control node on a hidden snapshot',
    '[{"displayName":"Fixture Author One"}]', 'CC-BY-4.0',
    '{"sourcePath":"nodes/node-control.json"}',
    '{"statement":"Control claim node that must stay hidden.","qualifiers":[]}',
    TIMESTAMP '2026-03-02 01:00:00');

INSERT INTO "NodeEdge" ("id", "sourceNodeVersionId", "targetNodeId", "relationType", "status",
  "provenance", "rationale", "assertedAt", "createdAt", "updatedAt",
  "confirmedTargetNodeVersionId", "confirmedById", "confirmedAt")
VALUES
  ('g1-edge-1', 'g1-node-1-v1', 'g1-node-2', 'supports', 'source-assertion',
    'imported-from-review', 'Synthetic source assertion one.', TIMESTAMP '2026-02-02 04:00:00',
    TIMESTAMP '2026-02-02 04:00:00', TIMESTAMP '2026-02-02 04:00:00', 'g1-node-2-v1', NULL, NULL),
  ('g1-edge-2', 'g1-node-1-v1', 'g1-node-3', 'contextualizes', 'source-assertion',
    'imported-from-review', 'Synthetic source assertion two.', TIMESTAMP '2026-02-02 05:00:00',
    TIMESTAMP '2026-02-02 05:00:00', TIMESTAMP '2026-02-02 05:00:00', 'g1-node-3-v1', NULL, NULL),
  ('g1-edge-3-unconfirmed', 'g1-node-1-v1', 'g1-node-3', 'background', 'source-assertion',
    'imported-from-review', 'Control: no confirmed target version.',
    TIMESTAMP '2026-02-02 06:00:00', TIMESTAMP '2026-02-02 06:00:00',
    TIMESTAMP '2026-02-02 06:00:00', NULL, NULL, NULL);

-- Real publication version for the editorial ORA readiness read (providers stay disabled).
INSERT INTO "Publication" ("id", "stableKey", "publicationType", "recordSource",
  "identityEvidenceJson", "createdAt", "updatedAt")
VALUES
  ('g1-publication-1', 'g1-fixture:publication-1', 'review-article', 'external-publication',
    '{}', TIMESTAMP '2026-03-10 00:00:00', TIMESTAMP '2026-03-10 00:00:00');

INSERT INTO "PublicationVersion" ("id", "publicationId", "stableKey", "sourcesSha256",
  "versionLabel", "title", "canonicalUrl", "adapterType", "adapterBindingJson",
  "structuralProvenance", "observedAt", "createdAt")
VALUES
  ('g1-publication-version-1', 'g1-publication-1', 'g1-fixture:publication-1:v1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'v1',
    'G1 fixture publication', 'https://publications.g1.oratlas.example/p1', 'myst', '{}',
    'published-structure', TIMESTAMP '2026-03-10 00:00:00', TIMESTAMP '2026-03-10 00:00:00');

-- Certifiers: the status-mutation target and a synthetic `ora` certifier with an active protocol
-- (readiness must still report available=false because no provider is configured).
INSERT INTO "Certifier" ("id", "slug", "name", "description", "status", "createdById",
  "createdAt", "activatedAt")
VALUES
  ('g1-certifier-1', 'g1-fixture-certifier', 'G1 Fixture Certifier',
    'Synthetic certifier for the G1 status mutation.', 'active', 'g1-user-admin',
    TIMESTAMP '2026-01-04 00:00:00', TIMESTAMP '2026-01-05 00:00:00'),
  ('g1-certifier-ora', 'ora', 'ORA (G1 synthetic fixture)',
    'Synthetic stand-in; no provider is configured in the G1 capture.', 'active',
    'g1-user-admin', TIMESTAMP '2026-01-04 00:00:00', TIMESTAMP '2026-01-05 00:00:00');

INSERT INTO "CertificationProtocol" ("id", "certifierId", "seriesKey", "protocolVersion", "title",
  "description", "protocolJson", "protocolSha256", "status", "createdAt")
VALUES
  ('g1-protocol-ora', 'g1-certifier-ora', 'scientific-merit-pilot', '0.1.0',
    'Synthetic G1 protocol fixture', 'Synthetic protocol row for the readiness read.', '{}',
    '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', 'active',
    TIMESTAMP '2026-01-05 00:00:00');

-- Public artifact fixtures: retained bytes must not leak through metadata or packet routes.
INSERT INTO "PublicationCapture" (
  "id",
  "publicationVersionId",
  "artifactKind",
  "artifactIdentitySha256",
  "declaredPath",
  "requestedUrl",
  "observedUrl",
  "mediaType",
  "contentSha256",
  "byteLength",
  "contentBytes",
  "declaredSha256",
  "structuralProvenance",
  "capturedAt",
  "createdAt"
) VALUES (
  'g1-capture-manifest',
  'g1-publication-version-1',
  'publication-manifest',
  '7c365b5fa7a844f052e8c60f33cd2be98039791e78a6a865c6ebb0589cfc167e',
  NULL,
  'https://publications.g1.oratlas.example/p1/oratlas.manifest.json',
  'https://publications.g1.oratlas.example/p1/oratlas.manifest.json',
  'application/json',
  '1596a4c89d2e847ffa7b24c3a4214bcd1e496518d138b7233405a3d778812ea2',
  25,
  'eyJzY2hlbWFWZXJzaW9uIjoiMC4yLjAifQ==',
  '1596a4c89d2e847ffa7b24c3a4214bcd1e496518d138b7233405a3d778812ea2',
  'published-structure',
  TIMESTAMP '2026-03-10 00:00:00',
  TIMESTAMP '2026-03-10 00:00:00'
);
INSERT INTO "PublicationCapture" (
  "id",
  "publicationVersionId",
  "artifactKind",
  "artifactIdentitySha256",
  "declaredPath",
  "requestedUrl",
  "observedUrl",
  "mediaType",
  "contentSha256",
  "byteLength",
  "contentBytes",
  "declaredSha256",
  "structuralProvenance",
  "capturedAt",
  "createdAt"
) VALUES (
  'g1-capture-source',
  'g1-publication-version-1',
  'source-document',
  '336103bd9e7dfb6f1218bd7fb19ce36dcb1632284380904fdcfbc292deb2260d',
  'article.md',
  'https://publications.g1.oratlas.example/p1/article.md',
  'https://publications.g1.oratlas.example/p1/article.md',
  'text/plain',
  '5d6e3bf06175c7079a93531c1b6835fcf8b010c1ba56244678651fb0a2e44d29',
  49,
  'RzEgcmV0YWluZWQgY2FwdHVyZSBieXRlczogPHNjcmlwdD5pbmVydDwvc2NyaXB0Pg==',
  '5d6e3bf06175c7079a93531c1b6835fcf8b010c1ba56244678651fb0a2e44d29',
  'published-structure',
  TIMESTAMP '2026-03-10 00:00:00',
  TIMESTAMP '2026-03-10 00:00:00'
);
-- The tombstone shares a populated snapshot with the readable version: denial must be
-- attributable to publicState, not to a missing snapshot/file or a withdrawn review.
UPDATE "RepositorySnapshot"
SET "preservedFilesJson" = '{"article.md":{"size":44,"truncated":false,"content":"<script>G1 inert public attachment</script>\n"}}'
WHERE "id" = 'g1-snap-2';
INSERT INTO "ReviewVersion" ("id", "reviewId", "snapshotId", "recordSourceType", "semanticVersion",
  "title", "metadataJson", "publishedAt", "createdAt", "publicState")
VALUES ('g1-version-tombstoned', 'g1-review-1', 'g1-snap-2', 'repository', '0.9.0',
  'G1 tombstoned attachment control', '{}', TIMESTAMP '2025-12-01 00:00:00',
  TIMESTAMP '2025-12-01 00:00:00', 'tombstoned');
