-- Supplemental deterministic PUBLIC G1 editorial fixtures. Synthetic-only; load AFTER
-- public-fixtures.sql, inside the same reset transaction. No credentials, providers or private data.
-- The base ORA row is inserted with the same valid synthetic definition; immutable rows are not updated.

INSERT INTO "CertificationProtocol" ("id", "certifierId", "seriesKey", "protocolVersion", "title",
  "description", "protocolJson", "protocolSha256", "status", "createdAt")
VALUES ('g1-certification-protocol-editorial', 'g1-certifier-ora', 'g1-editorial-synthetic', '1.0.0',
  'G1 Editorial Certification Protocol', 'Synthetic retirement target, not a scientific protocol.',
  '{"assessmentModes":["human"],"criteria":[{"allowedStatuses":["pass","fail"],"description":"Synthetic harness criterion only.","evidenceRequired":false,"id":"fixture-completeness","required":true,"title":"Synthetic fixture completeness"}],"outcomes":["inconclusive"],"requireCompleteSections":[]}', '38457c42f5ad19f7c54c3b1198f704d9958be9be7a418c99ebce0558b0d4d84b', 'active', TIMESTAMP '2026-01-06 00:00:00');

INSERT INTO "Verifier" ("id", "slug", "name", "description", "status", "createdById", "createdAt", "activatedAt")
VALUES
  ('g1-verifier-editorial', 'g1-editorial-verifier', 'G1 Editorial Verifier',
    'Synthetic registry/status fixture; no executor or provider.', 'active', 'g1-user-admin',
    TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00'),
  ('g1-verifier-editorial-control', 'g1-editorial-verifier-control', 'G1 Editorial Verifier Control',
    'Synthetic unchanged status control.', 'active', 'g1-user-admin',
    TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00');

INSERT INTO "VerificationProtocol" ("id", "authorityVerifierId", "seriesKey", "protocolVersion",
  "title", "description", "verificationType", "executionMode", "supportedSubjectTypesJson",
  "definitionJson", "definitionSha256", "status", "createdAt")
VALUES
  ('g1-verification-protocol-editorial', 'g1-verifier-editorial', 'g1-editorial-synthetic', '1.0.0',
    'G1 Editorial Verification Protocol', 'Synthetic protocol retirement target.',
    'g1-synthetic-fixture', 'deterministic', '["publication-version"]',
    '{"fixture":"synthetic-g1-only","version":"1.0.0"}', 'd24c75b23e933acee5f70fb43d9b24e2e8e6a17efcd54ae0230548fcf3b9d558', 'active', TIMESTAMP '2026-01-06 00:00:00'),
  ('g1-verification-protocol-editorial-control', 'g1-verifier-editorial-control', 'g1-z-control', '1.0.0',
    'G1 Editorial Verification Control', 'Synthetic unchanged protocol control.',
    'g1-synthetic-fixture', 'deterministic', '["publication-version"]',
    '{"fixture":"synthetic-g1-only","version":"1.0.0"}', 'd24c75b23e933acee5f70fb43d9b24e2e8e6a17efcd54ae0230548fcf3b9d558', 'active', TIMESTAMP '2026-01-06 00:00:00');
