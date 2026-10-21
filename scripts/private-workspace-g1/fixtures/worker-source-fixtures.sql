-- Additive synthetic worker-read subject. Load after all established fixture files.
-- Exact same native MyST source declaration, imported into a distinct synthetic registration.
-- The subject is separate so new worker runs do not change existing public run-list counts.
INSERT INTO "Publication"
SELECT (jsonb_populate_record(NULL::"Publication", to_jsonb(p) || jsonb_build_object(
  'id', 'g1-worker-publication', 'stableKey', 'g1-worker:publication'))).*
FROM "Publication" p WHERE p.id = 'g1-discovery-publication';
INSERT INTO "PublicationVersion"
SELECT (jsonb_populate_record(NULL::"PublicationVersion", to_jsonb(v) || jsonb_build_object(
  'id', 'g1-worker-version', 'publicationId', 'g1-worker-publication',
  'stableKey', 'g1-worker:version'))).*
FROM "PublicationVersion" v WHERE v.id = 'g1-discovery-version';
INSERT INTO "PublicationCapture"
SELECT (jsonb_populate_record(NULL::"PublicationCapture", to_jsonb(c) || jsonb_build_object(
  'id', CASE WHEN c.id = 'g1-discovery-source' THEN 'g1-worker-source' ELSE 'g1-worker-manifest' END,
  'publicationVersionId', 'g1-worker-version'))).*
FROM "PublicationCapture" c WHERE c.id IN ('g1-discovery-source', 'g1-discovery-manifest');
INSERT INTO "PublicationVersionContributor"
SELECT (jsonb_populate_record(NULL::"PublicationVersionContributor", to_jsonb(c) || jsonb_build_object(
  'id', 'g1-worker-contributor', 'publicationVersionId', 'g1-worker-version'))).*
FROM "PublicationVersionContributor" c WHERE c.id = 'g1-discovery-contributor';
INSERT INTO "PublicationProductionAssertion"
SELECT (jsonb_populate_record(NULL::"PublicationProductionAssertion", to_jsonb(p) || jsonb_build_object(
  'id', 'g1-worker-production', 'publicationVersionId', 'g1-worker-version'))).*
FROM "PublicationProductionAssertion" p WHERE p.id = 'g1-discovery-production';
INSERT INTO "PublicationClaimOccurrence"
SELECT (jsonb_populate_record(NULL::"PublicationClaimOccurrence", to_jsonb(c) || jsonb_build_object(
  'id', 'g1-worker-occurrence', 'publicationVersionId', 'g1-worker-version',
  'stableKey', 'g1-worker:occurrence'))).*
FROM "PublicationClaimOccurrence" c WHERE c.id = 'g1-discovery-occurrence';

-- These explicit synthetic service identities are independent of cookie principals.
INSERT INTO "Verifier"
SELECT (jsonb_populate_record(NULL::"Verifier", to_jsonb(v) || jsonb_build_object(
  'id', 'g1-worker-verifier-' || c.kind, 'slug', 'g1-worker-verifier-' || c.kind,
  'name', 'Synthetic worker verifier ' || c.kind, 'status', c.status))).*
FROM "Verifier" v CROSS JOIN (VALUES ('primary', 'active'), ('other', 'active'), ('inactive', 'suspended')) AS c(kind,status)
WHERE v.id = 'g1-verifier-editorial';
INSERT INTO "Certifier"
SELECT (jsonb_populate_record(NULL::"Certifier", to_jsonb(c) || jsonb_build_object(
  'id', 'g1-worker-certifier-' || x.kind, 'slug', 'g1-worker-certifier-' || x.kind,
  'name', 'Synthetic worker certifier ' || x.kind, 'status', x.status))).*
FROM "Certifier" c CROSS JOIN (VALUES ('other', 'active'), ('inactive', 'suspended')) AS x(kind,status)
WHERE c.id = 'g1-certifier-ora';
