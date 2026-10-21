-- Additive synthetic index-only controls, after public-fixtures.sql. Never load into HTTP G1
-- captures: these change discovery rows. No existing row is modified. jsonb_populate_record clones
-- a fully populated baseline record, overriding every identity and relevant lifecycle/source field.
INSERT INTO "Repository"
SELECT (jsonb_populate_record(NULL::"Repository", to_jsonb(r) || jsonb_build_object(
  'id', c.id || '-repo', 'name', c.id, 'githubRepositoryId', NULL,
  'canonicalUrl', 'https://github.com/oratlas-g1-fixture/' || c.id))).*
FROM "Repository" r CROSS JOIN (VALUES
  ('g1-index-withdrawn'), ('g1-index-tombstone'), ('g1-index-invalid-sha')
) AS c(id) WHERE r.id = 'g1-repo-1';

INSERT INTO "RepositorySnapshot"
SELECT (jsonb_populate_record(NULL::"RepositorySnapshot", to_jsonb(s) || jsonb_build_object(
  'id', c.id || '-snapshot', 'repositoryId', c.id || '-repo',
  'commitSha', CASE WHEN c.id = 'g1-index-invalid-sha' THEN 'not-an-exact-commit-sha'
    ELSE '1111111111111111111111111111111111111111' END,
  'contentHash', c.id || '-content'))).*
FROM "RepositorySnapshot" s CROSS JOIN (VALUES
  ('g1-index-withdrawn'), ('g1-index-tombstone'), ('g1-index-invalid-sha')
) AS c(id) WHERE s.id = 'g1-snap-2';

INSERT INTO "Review"
SELECT (jsonb_populate_record(NULL::"Review", to_jsonb(r) || jsonb_build_object(
  'id', c.id, 'slug', c.id, 'title', c.id,
  'repositoryId', c.id || '-repo', 'currentSnapshotId', c.id || '-snapshot',
  'lifecycleRevision', CASE WHEN c.id = 'g1-index-withdrawn' THEN 2 ELSE 1 END))).*
FROM "Review" r CROSS JOIN (VALUES
  ('g1-index-withdrawn'), ('g1-index-tombstone'), ('g1-index-invalid-sha')
) AS c(id) WHERE r.id = 'g1-review-1';

INSERT INTO "ReviewVersion"
SELECT (jsonb_populate_record(NULL::"ReviewVersion", to_jsonb(v) || jsonb_build_object(
  'id', c.id || '-version', 'reviewId', c.id, 'title', c.id,
  'snapshotId', c.id || '-snapshot',
  'publicState', c.state))).*
FROM "ReviewVersion" v CROSS JOIN (VALUES
  ('g1-index-withdrawn', 'withdrawn'), ('g1-index-tombstone', 'tombstoned'),
  ('g1-index-invalid-sha', 'published')
) AS c(id, state) WHERE v.id = 'g1-version-2';

INSERT INTO "Claim"
SELECT (jsonb_populate_record(NULL::"Claim", to_jsonb(c) || jsonb_build_object(
  'id', x.id || '-claim', 'reviewVersionId', x.id || '-version',
  'text', 'G1_INDEX_EXCLUDED_' || x.id, 'normalizedText', 'g1_index_excluded_' || x.id,
  'knowledgeNodeId', NULL))).*
FROM "Claim" c CROSS JOIN (VALUES
  ('g1-index-withdrawn'), ('g1-index-tombstone'), ('g1-index-invalid-sha')
) AS x(id) WHERE c.id = 'g1-claim-1';

INSERT INTO "ReviewLifecycleEvent" ("id", "reviewId", "reviewVersionId", "actorId", "kind",
  "reason", "revision", "createdAt") VALUES
  ('g1-index-withdrawal', 'g1-index-withdrawn', 'g1-index-withdrawn-version', 'g1-user-editor',
  'withdrawal', 'Synthetic index metadata remains discoverable; withdrawn claims do not.', 2,
  TIMESTAMP '2026-03-08 00:00:00');
