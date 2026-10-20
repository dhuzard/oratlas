-- G1 deterministic PUBLIC fixtures (docs/private-workspace-g1-harness.md).
-- Synthetic, non-research rows for a disposable database only. Fixed IDs, SHAs and timestamps so
-- paired captures are byte-comparable. Contains no private data and no real identifiers.

INSERT INTO "Repository" ("id", "host", "owner", "name", "canonicalUrl", "githubRepositoryId",
  "defaultBranch", "description", "licenseSpdx", "topicsJson", "isArchived", "createdAt", "updatedAt")
VALUES ('g1-repo-1', 'github.com', 'oratlas-g1-fixture', 'g1-review',
  'https://github.com/oratlas-g1-fixture/g1-review', '910000001', 'main',
  'Synthetic G1 harness fixture repository', 'CC-BY-4.0', '[]', false,
  TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00');

INSERT INTO "RepositorySnapshot" ("id", "repositoryId", "commitSha", "branch", "capturedAt",
  "inspectionStatus", "inspectionReportJson", "contentHash")
VALUES
  ('g1-snap-1', 'g1-repo-1', '1111111111111111111111111111111111111111', 'main',
    TIMESTAMP '2026-01-02 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-1'),
  ('g1-snap-2', 'g1-repo-1', '2222222222222222222222222222222222222222', 'main',
    TIMESTAMP '2026-02-02 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-2'),
  ('g1-snap-3', 'g1-repo-1', '3333333333333333333333333333333333333333', 'main',
    TIMESTAMP '2026-03-02 00:00:00', 'complete', '{}', 'g1-fixture-content-hash-3');

INSERT INTO "Review" ("id", "slug", "repositoryId", "currentSnapshotId", "title", "abstract",
  "reviewType", "licenseSpdx", "status", "acceptedAt", "createdAt", "updatedAt")
VALUES ('g1-review-1', 'g1-fixture-review', 'g1-repo-1', 'g1-snap-2',
  'G1 fixture review & public baseline', 'Synthetic abstract <for> the G1 public baseline.',
  'systematic', 'CC-BY-4.0', 'published', TIMESTAMP '2026-01-03 00:00:00',
  TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-02-03 00:00:00');

-- Two published versions with fixed publish times (feed order: v2 then v1) and one unpublished
-- version that the public feed must exclude.
INSERT INTO "ReviewVersion" ("id", "reviewId", "snapshotId", "recordSourceType", "semanticVersion",
  "title", "abstract", "metadataJson", "publishedAt", "createdAt", "publicState")
VALUES
  ('g1-version-1', 'g1-review-1', 'g1-snap-1', 'repository', '1.0.0',
    'G1 fixture review v1', 'First synthetic public version.', '{}',
    TIMESTAMP '2026-01-03 12:00:00', TIMESTAMP '2026-01-03 12:00:00', 'published'),
  ('g1-version-2', 'g1-review-1', 'g1-snap-2', 'repository', '1.1.0',
    'G1 fixture review v2 & "quoted"', 'Second synthetic public version.', '{}',
    TIMESTAMP '2026-02-03 12:00:00', TIMESTAMP '2026-02-03 12:00:00', 'published'),
  ('g1-version-3', 'g1-review-1', 'g1-snap-3', 'repository', '1.2.0',
    'G1 fixture unpublished draft', 'Must not appear in public discovery.', '{}',
    NULL, TIMESTAMP '2026-03-03 12:00:00', 'published');

INSERT INTO "Person" ("id", "displayName", "givenName", "familyName")
VALUES
  ('g1-person-1', 'Fixture Author One', 'Fixture', 'One'),
  ('g1-person-2', 'Fixture Author Two', 'Fixture', 'Two');

INSERT INTO "ReviewContributor" ("reviewVersionId", "personId", "rolesJson", "position")
VALUES
  ('g1-version-1', 'g1-person-1', '[]', 0),
  ('g1-version-2', 'g1-person-2', '[]', 0),
  ('g1-version-2', 'g1-person-1', '[]', 1),
  ('g1-version-3', 'g1-person-1', '[]', 0);
