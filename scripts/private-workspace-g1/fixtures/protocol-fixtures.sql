-- Synthetic PUBLIC protocol/execution archive rows; no workflow/verifier/certifier executed.
-- Load after public, discovery, editorial and scholarly fixtures. No credentials or private data.
-- Signed passports use ONLY the committed synthetic public trust keys; no private key is retained.
INSERT INTO "ExecutionPassport" (
  "id", "status", "verificationStatus", "revision", "sourceJson", "crateSha256", "attestationSha256", "payloadSha256", "repositoryUrl", "commitSha", "treeSha", "workflowEntityId", "workflowPath", "workflowSha256", "workflowRunId", "workflowRunAttempt", "signingKeyId", "signingIssuer", "signingSubject", "issuedAt", "registeredById", "lastVerifiedById", "registeredAt", "verifiedAt"
) VALUES (
  'g1-protocol-passport-public',
  'execution-attested',
  'verified',
  0,
  '{"attestation":{"payload":"eyJhcnRpZmFjdHMiOlt7ImJ5dGVTaXplIjo1LCJlbnRpdHlJZCI6ImlucHV0cy9kYXRhLmNzdiIsIm1lZGlhVHlwZSI6InRleHQvY3N2IiwibmFtZSI6ImRhdGEuY3N2IiwicGF0aCI6ImlucHV0cy9kYXRhLmNzdiIsInJvbGUiOiJpbnB1dCIsInNoYTI1NiI6ImM5NmM2ZDViZThkMDhhMTJlN2I1Y2RjMWIyMDdmYTZiMjQzMDk3NGM4NjgwM2Q4ODkxNjc1ZTc2ZmQ5OTJjMjAifSx7ImJ5dGVTaXplIjo2LCJlbnRpdHlJZCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJtZWRpYVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIiwibmFtZSI6InJlc3VsdC5qc29uIiwicGF0aCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJyb2xlIjoib3V0cHV0Iiwic2hhMjU2IjoiZTBlZThiYjUwNjg1ZTA1ZmEwZjQ3ZWQwNDIwM2FlOTUzZmRmZDA1NWY1YmQyODkyZWExODY1MDQyNTRmOGMzYSJ9XSwiY2xhaW1zIjpbeyJjbGFpbUlkIjoib3JhdGxhczpjbGFpbTp2MTowMDY3MDAzMTAwMmQwMDc2MDA2NTAwNzIwMDczMDA2OTAwNmYwMDZlMDAyZDAwMzQ6MDA2MzAwNmMwMDYxMDA2OTAwNmQwMDJkMDAzMSIsImxvY2FsQ2xhaW1JZCI6ImNsYWltLTEiLCJ2ZXJzaW9uSWQiOiJnMS12ZXJzaW9uLTQifV0sImNyYXRlU2hhMjU2IjoiMTI0OGExYTU3ZWU5MmZlNDRiOGZlYjY1YzViZWFjN2EyOWEwMTU3MWE4OTg0OGU4ZGE5N2I2MGUxNjlkZGY2ZSIsImlzc3VlZEF0IjoiMjAyNi0wMy0xNVQwODowMDowMC4wMDBaIiwicHJlZGljYXRlVHlwZSI6Imh0dHBzOi8vb3JhdGxhcy5vcmcvYXR0ZXN0YXRpb25zL2V4ZWN1dGlvbi92MSIsInJlcG9zaXRvcnkiOnsiY29tbWl0U2hhIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInRyZWVTaGEiOiIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIiwidXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2V4YW1wbGUvcmV2aWV3In0sInNjaGVtYVZlcnNpb24iOiIxLjAiLCJzaWduaW5nSWRlbnRpdHkiOnsiaXNzdWVyIjoiaHR0cHM6Ly90b2tlbi5hY3Rpb25zLmdpdGh1YnVzZXJjb250ZW50LmNvbSIsInN1YmplY3QiOiJodHRwczovL2dpdGh1Yi5jb20vZXhhbXBsZS9yZXZpZXcvLmdpdGh1Yi93b3JrZmxvd3MvYW5hbHlzaXMueW1sQHJlZnMvaGVhZHMvbWFpbiJ9LCJ3b3JrZmxvdyI6eyJlbnRpdHlJZCI6Ii5naXRodWIvd29ya2Zsb3dzL2FuYWx5c2lzLnltbCIsInBhdGgiOiIuZ2l0aHViL3dvcmtmbG93cy9hbmFseXNpcy55bWwiLCJydW5BdHRlbXB0IjoxLCJydW5JZCI6IjQyIiwic2hhMjU2IjoiZGE3ZjczOWY2MjcxOTg0NjVlZWFiNTM3YTZmN2E0MzVkYzRhMGMzMzJmOWU0YTg0NjIyOTNlYjNmNGFiN2VlMCJ9fQ==","payloadType":"application/vnd.oratlas.execution-attestation.v1+json","signatures":[{"keyId":"b170f6a987b79c56992c1bfe8f88fd973184836bb65931646ab679088a7bba82","sig":"+h5QfsrST67SGqjBFoke3DS8uMPHOvW4i6lNojFhnVYiCAwMi4I5ypwm7qdjoiOmXazF0/Uztrmz6BO3rj9MAA=="}]},"crate":{"@context":["https://w3id.org/ro/crate/1.1/context","https://w3id.org/ro/terms/workflow-run/context"],"@graph":[{"@id":"ro-crate-metadata.json","@type":"CreativeWork","about":{"@id":"./"},"conformsTo":[{"@id":"https://w3id.org/ro/crate/1.1"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}]},{"@id":"./","@type":"Dataset","conformsTo":[{"@id":"https://w3id.org/ro/wfrun/workflow/0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}],"hasPart":[{"@id":".github/workflows/analysis.yml"},{"@id":"inputs/data.csv"},{"@id":"outputs/result.json"}],"license":"MIT","mainEntity":{"@id":".github/workflows/analysis.yml"},"mentions":[{"@id":"#source"},{"@id":"#run"},{"@id":"#claim-1"}],"name":"Attested analysis run"},{"@id":"https://w3id.org/ro/wfrun/workflow/0.5","@type":"CreativeWork","name":"Workflow Run RO-Crate 0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5","@type":"CreativeWork","name":"Process Run RO-Crate 0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0","@type":"CreativeWork","name":"Workflow RO-Crate 1.0"},{"@id":"#github-actions","@type":"ComputerLanguage","name":"GitHub Actions workflow"},{"@id":"#source","@type":"SoftwareSourceCode","codeRepository":"https://github.com/example/review","commitSha":"1111111111111111111111111111111111111111","treeSha":"2222222222222222222222222222222222222222"},{"@id":".github/workflows/analysis.yml","@type":["File","SoftwareSourceCode","ComputationalWorkflow"],"name":"analysis.yml","programmingLanguage":{"@id":"#github-actions"},"sha256":"da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0","workflowPath":".github/workflows/analysis.yml"},{"@id":"#run","@type":"CreateAction","actionStatus":"https://schema.org/CompletedActionStatus","claimBindings":{"@id":"#claim-1"},"instrument":{"@id":".github/workflows/analysis.yml"},"name":"GitHub Actions run 42","object":{"@id":"inputs/data.csv"},"result":{"@id":"outputs/result.json"},"runAttempt":1,"runId":"42"},{"@id":"inputs/data.csv","@type":"File","contentSize":5,"encodingFormat":"text/csv","name":"data.csv","sha256":"c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20"},{"@id":"outputs/result.json","@type":"File","contentSize":6,"encodingFormat":"application/json","name":"result.json","sha256":"e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a"},{"@id":"#claim-1","@type":"EvidenceBinding","name":"Immutable Atlas claim binding","oratlasClaimId":"oratlas:claim:v1:00670031002d00760065007200730069006f006e002d0034:0063006c00610069006d002d0031"}]}}',
  '1248a1a57ee92fe44b8feb65c5beac7a29a01571a89848e8da97b60e169ddf6e',
  '67c05565848aa96013f963f5fc51bdb06fdddb7b30f495c5ebefaceb0518232e',
  'e6185a6e6fe5b70445d99a5d81632aa4bb8ec16d3bbe1bdeebf9a6537365393d',
  'https://github.com/example/review',
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '.github/workflows/analysis.yml',
  '.github/workflows/analysis.yml',
  'da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0',
  '42',
  1,
  'b170f6a987b79c56992c1bfe8f88fd973184836bb65931646ab679088a7bba82',
  'https://token.actions.githubusercontent.com',
  'https://github.com/example/review/.github/workflows/analysis.yml@refs/heads/main',
  '2026-03-15T08:00:00.000Z',
  'g1-user-admin',
  'g1-user-admin',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "ExecutionPassportClaim" (
  "id", "passportId", "claimId"
) VALUES (
  'g1-protocol-passport-public-claim',
  'g1-protocol-passport-public',
  'g1-claim-2'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-public-artifact-0',
  'g1-protocol-passport-public',
  'inputs/data.csv',
  'input',
  'data.csv',
  'inputs/data.csv',
  'text/csv',
  5,
  'c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-public-artifact-1',
  'g1-protocol-passport-public',
  'outputs/result.json',
  'output',
  'result.json',
  'outputs/result.json',
  'application/json',
  6,
  'e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a'
);
INSERT INTO "ExecutionPassport" (
  "id", "status", "verificationStatus", "revision", "sourceJson", "crateSha256", "attestationSha256", "payloadSha256", "repositoryUrl", "commitSha", "treeSha", "workflowEntityId", "workflowPath", "workflowSha256", "workflowRunId", "workflowRunAttempt", "signingKeyId", "signingIssuer", "signingSubject", "issuedAt", "registeredById", "lastVerifiedById", "registeredAt", "verifiedAt"
) VALUES (
  'g1-protocol-passport-hidden',
  'execution-attested',
  'verified',
  0,
  '{"attestation":{"payload":"eyJhcnRpZmFjdHMiOlt7ImJ5dGVTaXplIjo1LCJlbnRpdHlJZCI6ImlucHV0cy9kYXRhLmNzdiIsIm1lZGlhVHlwZSI6InRleHQvY3N2IiwibmFtZSI6ImRhdGEuY3N2IiwicGF0aCI6ImlucHV0cy9kYXRhLmNzdiIsInJvbGUiOiJpbnB1dCIsInNoYTI1NiI6ImM5NmM2ZDViZThkMDhhMTJlN2I1Y2RjMWIyMDdmYTZiMjQzMDk3NGM4NjgwM2Q4ODkxNjc1ZTc2ZmQ5OTJjMjAifSx7ImJ5dGVTaXplIjo2LCJlbnRpdHlJZCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJtZWRpYVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIiwibmFtZSI6InJlc3VsdC5qc29uIiwicGF0aCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJyb2xlIjoib3V0cHV0Iiwic2hhMjU2IjoiZTBlZThiYjUwNjg1ZTA1ZmEwZjQ3ZWQwNDIwM2FlOTUzZmRmZDA1NWY1YmQyODkyZWExODY1MDQyNTRmOGMzYSJ9XSwiY2xhaW1zIjpbeyJjbGFpbUlkIjoib3JhdGxhczpjbGFpbTp2MTowMDY3MDAzMTAwMmQwMDc2MDA2NTAwNzIwMDczMDA2OTAwNmYwMDZlMDAyZDAwMzM6MDA2MzAwNmMwMDYxMDA2OTAwNmQwMDJkMDAzMSIsImxvY2FsQ2xhaW1JZCI6ImNsYWltLTEiLCJ2ZXJzaW9uSWQiOiJnMS12ZXJzaW9uLTMifV0sImNyYXRlU2hhMjU2IjoiMDY1MzU2NjM4MmIyYjU4OTliMTIzNDRiOGIwMDliZjRiYmI1MmQyNGIzN2VhODZlNzZjNDc3Y2Y3YzNjN2VjZiIsImlzc3VlZEF0IjoiMjAyNi0wMy0xNVQwODowMDowMS4wMDBaIiwicHJlZGljYXRlVHlwZSI6Imh0dHBzOi8vb3JhdGxhcy5vcmcvYXR0ZXN0YXRpb25zL2V4ZWN1dGlvbi92MSIsInJlcG9zaXRvcnkiOnsiY29tbWl0U2hhIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInRyZWVTaGEiOiIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIiwidXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2V4YW1wbGUvcmV2aWV3In0sInNjaGVtYVZlcnNpb24iOiIxLjAiLCJzaWduaW5nSWRlbnRpdHkiOnsiaXNzdWVyIjoiaHR0cHM6Ly90b2tlbi5hY3Rpb25zLmdpdGh1YnVzZXJjb250ZW50LmNvbSIsInN1YmplY3QiOiJodHRwczovL2dpdGh1Yi5jb20vZXhhbXBsZS9yZXZpZXcvLmdpdGh1Yi93b3JrZmxvd3MvYW5hbHlzaXMueW1sQHJlZnMvaGVhZHMvbWFpbiJ9LCJ3b3JrZmxvdyI6eyJlbnRpdHlJZCI6Ii5naXRodWIvd29ya2Zsb3dzL2FuYWx5c2lzLnltbCIsInBhdGgiOiIuZ2l0aHViL3dvcmtmbG93cy9hbmFseXNpcy55bWwiLCJydW5BdHRlbXB0IjoxLCJydW5JZCI6IjQyIiwic2hhMjU2IjoiZGE3ZjczOWY2MjcxOTg0NjVlZWFiNTM3YTZmN2E0MzVkYzRhMGMzMzJmOWU0YTg0NjIyOTNlYjNmNGFiN2VlMCJ9fQ==","payloadType":"application/vnd.oratlas.execution-attestation.v1+json","signatures":[{"keyId":"b7ba734eada0bc30652748ffd2a6df2a5d80b3cfe44096a06836230a61922449","sig":"nem4EM6noegG21El+3pDnjg5Li5/fZEwbTCyommjWQZLsZmcOnvQwMrlzWsNfDcUDBD9Ag7fmNOelB9uG1h/Bg=="}]},"crate":{"@context":["https://w3id.org/ro/crate/1.1/context","https://w3id.org/ro/terms/workflow-run/context"],"@graph":[{"@id":"ro-crate-metadata.json","@type":"CreativeWork","about":{"@id":"./"},"conformsTo":[{"@id":"https://w3id.org/ro/crate/1.1"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}]},{"@id":"./","@type":"Dataset","conformsTo":[{"@id":"https://w3id.org/ro/wfrun/workflow/0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}],"hasPart":[{"@id":".github/workflows/analysis.yml"},{"@id":"inputs/data.csv"},{"@id":"outputs/result.json"}],"license":"MIT","mainEntity":{"@id":".github/workflows/analysis.yml"},"mentions":[{"@id":"#source"},{"@id":"#run"},{"@id":"#claim-1"}],"name":"Attested analysis run"},{"@id":"https://w3id.org/ro/wfrun/workflow/0.5","@type":"CreativeWork","name":"Workflow Run RO-Crate 0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5","@type":"CreativeWork","name":"Process Run RO-Crate 0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0","@type":"CreativeWork","name":"Workflow RO-Crate 1.0"},{"@id":"#github-actions","@type":"ComputerLanguage","name":"GitHub Actions workflow"},{"@id":"#source","@type":"SoftwareSourceCode","codeRepository":"https://github.com/example/review","commitSha":"1111111111111111111111111111111111111111","treeSha":"2222222222222222222222222222222222222222"},{"@id":".github/workflows/analysis.yml","@type":["File","SoftwareSourceCode","ComputationalWorkflow"],"name":"analysis.yml","programmingLanguage":{"@id":"#github-actions"},"sha256":"da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0","workflowPath":".github/workflows/analysis.yml"},{"@id":"#run","@type":"CreateAction","actionStatus":"https://schema.org/CompletedActionStatus","claimBindings":{"@id":"#claim-1"},"instrument":{"@id":".github/workflows/analysis.yml"},"name":"GitHub Actions run 42","object":{"@id":"inputs/data.csv"},"result":{"@id":"outputs/result.json"},"runAttempt":1,"runId":"42"},{"@id":"inputs/data.csv","@type":"File","contentSize":5,"encodingFormat":"text/csv","name":"data.csv","sha256":"c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20"},{"@id":"outputs/result.json","@type":"File","contentSize":6,"encodingFormat":"application/json","name":"result.json","sha256":"e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a"},{"@id":"#claim-1","@type":"EvidenceBinding","name":"Immutable Atlas claim binding","oratlasClaimId":"oratlas:claim:v1:00670031002d00760065007200730069006f006e002d0033:0063006c00610069006d002d0031"}]}}',
  '0653566382b2b5899b12344b8b009bf4bbb52d24b37ea86e76c477cf7c3c7ecf',
  'd241435903c2754afa1a913990f87857d310631c861a87ccfcf20cd5ed56da18',
  'fcad94a053b33129c8ee12d62b6e1b11f71df75df8aac1a9d41ce59bf4d81aa9',
  'https://github.com/example/review',
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '.github/workflows/analysis.yml',
  '.github/workflows/analysis.yml',
  'da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0',
  '42',
  1,
  'b7ba734eada0bc30652748ffd2a6df2a5d80b3cfe44096a06836230a61922449',
  'https://token.actions.githubusercontent.com',
  'https://github.com/example/review/.github/workflows/analysis.yml@refs/heads/main',
  '2026-03-15T08:00:01.000Z',
  'g1-user-admin',
  'g1-user-admin',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "ExecutionPassportClaim" (
  "id", "passportId", "claimId"
) VALUES (
  'g1-protocol-passport-hidden-claim',
  'g1-protocol-passport-hidden',
  'g1-claim-control'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-hidden-artifact-0',
  'g1-protocol-passport-hidden',
  'inputs/data.csv',
  'input',
  'data.csv',
  'inputs/data.csv',
  'text/csv',
  5,
  'c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-hidden-artifact-1',
  'g1-protocol-passport-hidden',
  'outputs/result.json',
  'output',
  'result.json',
  'outputs/result.json',
  'application/json',
  6,
  'e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a'
);
INSERT INTO "ExecutionPassport" (
  "id", "status", "verificationStatus", "revision", "sourceJson", "crateSha256", "attestationSha256", "payloadSha256", "repositoryUrl", "commitSha", "treeSha", "workflowEntityId", "workflowPath", "workflowSha256", "workflowRunId", "workflowRunAttempt", "signingKeyId", "signingIssuer", "signingSubject", "issuedAt", "registeredById", "lastVerifiedById", "registeredAt", "verifiedAt"
) VALUES (
  'g1-protocol-passport-tombstoned',
  'execution-attested',
  'verified',
  0,
  '{"attestation":{"payload":"eyJhcnRpZmFjdHMiOlt7ImJ5dGVTaXplIjo1LCJlbnRpdHlJZCI6ImlucHV0cy9kYXRhLmNzdiIsIm1lZGlhVHlwZSI6InRleHQvY3N2IiwibmFtZSI6ImRhdGEuY3N2IiwicGF0aCI6ImlucHV0cy9kYXRhLmNzdiIsInJvbGUiOiJpbnB1dCIsInNoYTI1NiI6ImM5NmM2ZDViZThkMDhhMTJlN2I1Y2RjMWIyMDdmYTZiMjQzMDk3NGM4NjgwM2Q4ODkxNjc1ZTc2ZmQ5OTJjMjAifSx7ImJ5dGVTaXplIjo2LCJlbnRpdHlJZCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJtZWRpYVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIiwibmFtZSI6InJlc3VsdC5qc29uIiwicGF0aCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJyb2xlIjoib3V0cHV0Iiwic2hhMjU2IjoiZTBlZThiYjUwNjg1ZTA1ZmEwZjQ3ZWQwNDIwM2FlOTUzZmRmZDA1NWY1YmQyODkyZWExODY1MDQyNTRmOGMzYSJ9XSwiY2xhaW1zIjpbeyJjbGFpbUlkIjoib3JhdGxhczpjbGFpbTp2MTowMDY3MDAzMTAwMmQwMDc2MDA2NTAwNzIwMDczMDA2OTAwNmYwMDZlMDAyZDAwNzQwMDZmMDA2ZDAwNjIwMDczMDA3NDAwNmYwMDZlMDA2NTAwNjQ6MDA2NDAwNjkwMDczMDA2MzAwNmYwMDc2MDA2NTAwNzIwMDc5MDAyZDAwNjMwMDZjMDA2MTAwNjkwMDZkIiwibG9jYWxDbGFpbUlkIjoiZGlzY292ZXJ5LWNsYWltIiwidmVyc2lvbklkIjoiZzEtdmVyc2lvbi10b21ic3RvbmVkIn1dLCJjcmF0ZVNoYTI1NiI6ImRhYjRjZjJiNGYzYTQyMTA0MWYxM2U1ZTliZmM3NTE0ZjE2NDc2YWYxMmZjNzlkZjEzZDA0YmRhOTkyYzVmNzUiLCJpc3N1ZWRBdCI6IjIwMjYtMDMtMTVUMDg6MDA6MDIuMDAwWiIsInByZWRpY2F0ZVR5cGUiOiJodHRwczovL29yYXRsYXMub3JnL2F0dGVzdGF0aW9ucy9leGVjdXRpb24vdjEiLCJyZXBvc2l0b3J5Ijp7ImNvbW1pdFNoYSI6IjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJ0cmVlU2hhIjoiMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsInVybCI6Imh0dHBzOi8vZ2l0aHViLmNvbS9leGFtcGxlL3JldmlldyJ9LCJzY2hlbWFWZXJzaW9uIjoiMS4wIiwic2lnbmluZ0lkZW50aXR5Ijp7Imlzc3VlciI6Imh0dHBzOi8vdG9rZW4uYWN0aW9ucy5naXRodWJ1c2VyY29udGVudC5jb20iLCJzdWJqZWN0IjoiaHR0cHM6Ly9naXRodWIuY29tL2V4YW1wbGUvcmV2aWV3Ly5naXRodWIvd29ya2Zsb3dzL2FuYWx5c2lzLnltbEByZWZzL2hlYWRzL21haW4ifSwid29ya2Zsb3ciOnsiZW50aXR5SWQiOiIuZ2l0aHViL3dvcmtmbG93cy9hbmFseXNpcy55bWwiLCJwYXRoIjoiLmdpdGh1Yi93b3JrZmxvd3MvYW5hbHlzaXMueW1sIiwicnVuQXR0ZW1wdCI6MSwicnVuSWQiOiI0MiIsInNoYTI1NiI6ImRhN2Y3MzlmNjI3MTk4NDY1ZWVhYjUzN2E2ZjdhNDM1ZGM0YTBjMzMyZjllNGE4NDYyMjkzZWIzZjRhYjdlZTAifX0=","payloadType":"application/vnd.oratlas.execution-attestation.v1+json","signatures":[{"keyId":"654b15b18977e097e98078ceb1bd87b39094d34692fcbefbf76305e4370bd15f","sig":"aXuktNVA9MpADIM8ZVGYwm71hHcquB+cQyutr8shuMGbynomU8DDHaXDKmoSLAqeTl7MIb8FfRCt0DxmKdNHBg=="}]},"crate":{"@context":["https://w3id.org/ro/crate/1.1/context","https://w3id.org/ro/terms/workflow-run/context"],"@graph":[{"@id":"ro-crate-metadata.json","@type":"CreativeWork","about":{"@id":"./"},"conformsTo":[{"@id":"https://w3id.org/ro/crate/1.1"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}]},{"@id":"./","@type":"Dataset","conformsTo":[{"@id":"https://w3id.org/ro/wfrun/workflow/0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}],"hasPart":[{"@id":".github/workflows/analysis.yml"},{"@id":"inputs/data.csv"},{"@id":"outputs/result.json"}],"license":"MIT","mainEntity":{"@id":".github/workflows/analysis.yml"},"mentions":[{"@id":"#source"},{"@id":"#run"},{"@id":"#claim-1"}],"name":"Attested analysis run"},{"@id":"https://w3id.org/ro/wfrun/workflow/0.5","@type":"CreativeWork","name":"Workflow Run RO-Crate 0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5","@type":"CreativeWork","name":"Process Run RO-Crate 0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0","@type":"CreativeWork","name":"Workflow RO-Crate 1.0"},{"@id":"#github-actions","@type":"ComputerLanguage","name":"GitHub Actions workflow"},{"@id":"#source","@type":"SoftwareSourceCode","codeRepository":"https://github.com/example/review","commitSha":"1111111111111111111111111111111111111111","treeSha":"2222222222222222222222222222222222222222"},{"@id":".github/workflows/analysis.yml","@type":["File","SoftwareSourceCode","ComputationalWorkflow"],"name":"analysis.yml","programmingLanguage":{"@id":"#github-actions"},"sha256":"da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0","workflowPath":".github/workflows/analysis.yml"},{"@id":"#run","@type":"CreateAction","actionStatus":"https://schema.org/CompletedActionStatus","claimBindings":{"@id":"#claim-1"},"instrument":{"@id":".github/workflows/analysis.yml"},"name":"GitHub Actions run 42","object":{"@id":"inputs/data.csv"},"result":{"@id":"outputs/result.json"},"runAttempt":1,"runId":"42"},{"@id":"inputs/data.csv","@type":"File","contentSize":5,"encodingFormat":"text/csv","name":"data.csv","sha256":"c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20"},{"@id":"outputs/result.json","@type":"File","contentSize":6,"encodingFormat":"application/json","name":"result.json","sha256":"e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a"},{"@id":"#claim-1","@type":"EvidenceBinding","name":"Immutable Atlas claim binding","oratlasClaimId":"oratlas:claim:v1:00670031002d00760065007200730069006f006e002d0074006f006d006200730074006f006e00650064:0064006900730063006f0076006500720079002d0063006c00610069006d"}]}}',
  'dab4cf2b4f3a421041f13e5e9bfc7514f16476af12fc79df13d04bda992c5f75',
  'a2aaa957c379c3d24b7bcb75c70d1e4bc86139f91f753f936614d3a44b85e054',
  'fe7d8b156b462f65cddd10cba4b607c99273e2bec5f35269d5b782dac1891c80',
  'https://github.com/example/review',
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '.github/workflows/analysis.yml',
  '.github/workflows/analysis.yml',
  'da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0',
  '42',
  1,
  '654b15b18977e097e98078ceb1bd87b39094d34692fcbefbf76305e4370bd15f',
  'https://token.actions.githubusercontent.com',
  'https://github.com/example/review/.github/workflows/analysis.yml@refs/heads/main',
  '2026-03-15T08:00:02.000Z',
  'g1-user-admin',
  'g1-user-admin',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "ExecutionPassportClaim" (
  "id", "passportId", "claimId"
) VALUES (
  'g1-protocol-passport-tombstoned-claim',
  'g1-protocol-passport-tombstoned',
  'g1-discovery-claim-tombstoned'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-tombstoned-artifact-0',
  'g1-protocol-passport-tombstoned',
  'inputs/data.csv',
  'input',
  'data.csv',
  'inputs/data.csv',
  'text/csv',
  5,
  'c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-tombstoned-artifact-1',
  'g1-protocol-passport-tombstoned',
  'outputs/result.json',
  'output',
  'result.json',
  'outputs/result.json',
  'application/json',
  6,
  'e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a'
);
INSERT INTO "ExecutionPassport" (
  "id", "status", "verificationStatus", "revision", "sourceJson", "crateSha256", "attestationSha256", "payloadSha256", "repositoryUrl", "commitSha", "treeSha", "workflowEntityId", "workflowPath", "workflowSha256", "workflowRunId", "workflowRunAttempt", "signingKeyId", "signingIssuer", "signingSubject", "issuedAt", "registeredById", "lastVerifiedById", "registeredAt", "verifiedAt"
) VALUES (
  'g1-protocol-passport-tampered',
  'execution-attested',
  'verified',
  0,
  '{"attestation":{"payload":"eyJhcnRpZmFjdHMiOlt7ImJ5dGVTaXplIjo1LCJlbnRpdHlJZCI6ImlucHV0cy9kYXRhLmNzdiIsIm1lZGlhVHlwZSI6InRleHQvY3N2IiwibmFtZSI6ImRhdGEuY3N2IiwicGF0aCI6ImlucHV0cy9kYXRhLmNzdiIsInJvbGUiOiJpbnB1dCIsInNoYTI1NiI6ImM5NmM2ZDViZThkMDhhMTJlN2I1Y2RjMWIyMDdmYTZiMjQzMDk3NGM4NjgwM2Q4ODkxNjc1ZTc2ZmQ5OTJjMjAifSx7ImJ5dGVTaXplIjo2LCJlbnRpdHlJZCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJtZWRpYVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIiwibmFtZSI6InJlc3VsdC5qc29uIiwicGF0aCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJyb2xlIjoib3V0cHV0Iiwic2hhMjU2IjoiZTBlZThiYjUwNjg1ZTA1ZmEwZjQ3ZWQwNDIwM2FlOTUzZmRmZDA1NWY1YmQyODkyZWExODY1MDQyNTRmOGMzYSJ9XSwiY2xhaW1zIjpbeyJjbGFpbUlkIjoib3JhdGxhczpjbGFpbTp2MTowMDY3MDAzMTAwMmQwMDc2MDA2NTAwNzIwMDczMDA2OTAwNmYwMDZlMDAyZDAwMzQ6MDA2MzAwNmMwMDYxMDA2OTAwNmQwMDJkMDAzMSIsImxvY2FsQ2xhaW1JZCI6ImNsYWltLTEiLCJ2ZXJzaW9uSWQiOiJnMS12ZXJzaW9uLTQifV0sImNyYXRlU2hhMjU2IjoiMTI0OGExYTU3ZWU5MmZlNDRiOGZlYjY1YzViZWFjN2EyOWEwMTU3MWE4OTg0OGU4ZGE5N2I2MGUxNjlkZGY2ZSIsImlzc3VlZEF0IjoiMjAyNi0wMy0xNVQwODowMDowMy4wMDBaIiwicHJlZGljYXRlVHlwZSI6Imh0dHBzOi8vb3JhdGxhcy5vcmcvYXR0ZXN0YXRpb25zL2V4ZWN1dGlvbi92MSIsInJlcG9zaXRvcnkiOnsiY29tbWl0U2hhIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInRyZWVTaGEiOiIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIiwidXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2V4YW1wbGUvcmV2aWV3In0sInNjaGVtYVZlcnNpb24iOiIxLjAiLCJzaWduaW5nSWRlbnRpdHkiOnsiaXNzdWVyIjoiaHR0cHM6Ly90b2tlbi5hY3Rpb25zLmdpdGh1YnVzZXJjb250ZW50LmNvbSIsInN1YmplY3QiOiJodHRwczovL2dpdGh1Yi5jb20vZXhhbXBsZS9yZXZpZXcvLmdpdGh1Yi93b3JrZmxvd3MvYW5hbHlzaXMueW1sQHJlZnMvaGVhZHMvbWFpbiJ9LCJ3b3JrZmxvdyI6eyJlbnRpdHlJZCI6Ii5naXRodWIvd29ya2Zsb3dzL2FuYWx5c2lzLnltbCIsInBhdGgiOiIuZ2l0aHViL3dvcmtmbG93cy9hbmFseXNpcy55bWwiLCJydW5BdHRlbXB0IjoxLCJydW5JZCI6IjQyIiwic2hhMjU2IjoiZGE3ZjczOWY2MjcxOTg0NjVlZWFiNTM3YTZmN2E0MzVkYzRhMGMzMzJmOWU0YTg0NjIyOTNlYjNmNGFiN2VlMCJ9fQ==","payloadType":"application/vnd.oratlas.execution-attestation.v1+json","signatures":[{"keyId":"b5f1e48136c73aeecef1dd2d8253187836bd6bef0bce4256e671f32e7404aec9","sig":"Ei5jN/s/b9jEh/22b7DLM3Ku8HLi/1uo1cebKxUVeNYfNpMPntNZVJ1LKSyNEBpLeUVJlzse7FFaUJoBx1z0BA=="}]},"crate":{"@context":["https://w3id.org/ro/crate/1.1/context","https://w3id.org/ro/terms/workflow-run/context"],"@graph":[{"@id":"ro-crate-metadata.json","@type":"CreativeWork","about":{"@id":"./"},"conformsTo":[{"@id":"https://w3id.org/ro/crate/1.1"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}]},{"@id":"./","@type":"Dataset","conformsTo":[{"@id":"https://w3id.org/ro/wfrun/workflow/0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}],"hasPart":[{"@id":".github/workflows/analysis.yml"},{"@id":"inputs/data.csv"},{"@id":"outputs/result.json"}],"license":"MIT","mainEntity":{"@id":".github/workflows/analysis.yml"},"mentions":[{"@id":"#source"},{"@id":"#run"},{"@id":"#claim-1"}],"name":"Attested analysis run"},{"@id":"https://w3id.org/ro/wfrun/workflow/0.5","@type":"CreativeWork","name":"Workflow Run RO-Crate 0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5","@type":"CreativeWork","name":"Process Run RO-Crate 0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0","@type":"CreativeWork","name":"Workflow RO-Crate 1.0"},{"@id":"#github-actions","@type":"ComputerLanguage","name":"GitHub Actions workflow"},{"@id":"#source","@type":"SoftwareSourceCode","codeRepository":"https://github.com/example/review","commitSha":"1111111111111111111111111111111111111111","treeSha":"2222222222222222222222222222222222222222"},{"@id":".github/workflows/analysis.yml","@type":["File","SoftwareSourceCode","ComputationalWorkflow"],"name":"analysis.yml","programmingLanguage":{"@id":"#github-actions"},"sha256":"da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0","workflowPath":".github/workflows/analysis.yml"},{"@id":"#run","@type":"CreateAction","actionStatus":"https://schema.org/CompletedActionStatus","claimBindings":{"@id":"#claim-1"},"instrument":{"@id":".github/workflows/analysis.yml"},"name":"GitHub Actions run 42","object":{"@id":"inputs/data.csv"},"result":{"@id":"outputs/result.json"},"runAttempt":1,"runId":"42"},{"@id":"inputs/data.csv","@type":"File","contentSize":5,"encodingFormat":"text/csv","name":"data.csv","sha256":"c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20"},{"@id":"outputs/result.json","@type":"File","contentSize":6,"encodingFormat":"application/json","name":"result.json","sha256":"d121be3103007b41edf96f8262925f8c7d61894afe9a041843b631f69445bc57"},{"@id":"#claim-1","@type":"EvidenceBinding","name":"Immutable Atlas claim binding","oratlasClaimId":"oratlas:claim:v1:00670031002d00760065007200730069006f006e002d0034:0063006c00610069006d002d0031"}]}}',
  '1248a1a57ee92fe44b8feb65c5beac7a29a01571a89848e8da97b60e169ddf6e',
  '9f661dca693ac7d10c5e26754f5c8bcd53c7d24fe75c6b7d535814a786d66b2a',
  '5aaa6865812643adbc396080168bff80810305524cc79b57763ba60b04f453db',
  'https://github.com/example/review',
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '.github/workflows/analysis.yml',
  '.github/workflows/analysis.yml',
  'da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0',
  '42',
  1,
  'b5f1e48136c73aeecef1dd2d8253187836bd6bef0bce4256e671f32e7404aec9',
  'https://token.actions.githubusercontent.com',
  'https://github.com/example/review/.github/workflows/analysis.yml@refs/heads/main',
  '2026-03-15T08:00:03.000Z',
  'g1-user-admin',
  'g1-user-admin',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "ExecutionPassportClaim" (
  "id", "passportId", "claimId"
) VALUES (
  'g1-protocol-passport-tampered-claim',
  'g1-protocol-passport-tampered',
  'g1-claim-2'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-tampered-artifact-0',
  'g1-protocol-passport-tampered',
  'inputs/data.csv',
  'input',
  'data.csv',
  'inputs/data.csv',
  'text/csv',
  5,
  'c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-tampered-artifact-1',
  'g1-protocol-passport-tampered',
  'outputs/result.json',
  'output',
  'result.json',
  'outputs/result.json',
  'application/json',
  6,
  'e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a'
);
INSERT INTO "ExecutionPassport" (
  "id", "status", "verificationStatus", "revision", "sourceJson", "crateSha256", "attestationSha256", "payloadSha256", "repositoryUrl", "commitSha", "treeSha", "workflowEntityId", "workflowPath", "workflowSha256", "workflowRunId", "workflowRunAttempt", "signingKeyId", "signingIssuer", "signingSubject", "issuedAt", "registeredById", "lastVerifiedById", "registeredAt", "verifiedAt"
) VALUES (
  'g1-protocol-passport-unknown-key',
  'execution-attested',
  'verified',
  0,
  '{"attestation":{"payload":"eyJhcnRpZmFjdHMiOlt7ImJ5dGVTaXplIjo1LCJlbnRpdHlJZCI6ImlucHV0cy9kYXRhLmNzdiIsIm1lZGlhVHlwZSI6InRleHQvY3N2IiwibmFtZSI6ImRhdGEuY3N2IiwicGF0aCI6ImlucHV0cy9kYXRhLmNzdiIsInJvbGUiOiJpbnB1dCIsInNoYTI1NiI6ImM5NmM2ZDViZThkMDhhMTJlN2I1Y2RjMWIyMDdmYTZiMjQzMDk3NGM4NjgwM2Q4ODkxNjc1ZTc2ZmQ5OTJjMjAifSx7ImJ5dGVTaXplIjo2LCJlbnRpdHlJZCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJtZWRpYVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIiwibmFtZSI6InJlc3VsdC5qc29uIiwicGF0aCI6Im91dHB1dHMvcmVzdWx0Lmpzb24iLCJyb2xlIjoib3V0cHV0Iiwic2hhMjU2IjoiZTBlZThiYjUwNjg1ZTA1ZmEwZjQ3ZWQwNDIwM2FlOTUzZmRmZDA1NWY1YmQyODkyZWExODY1MDQyNTRmOGMzYSJ9XSwiY2xhaW1zIjpbeyJjbGFpbUlkIjoib3JhdGxhczpjbGFpbTp2MTowMDY3MDAzMTAwMmQwMDc2MDA2NTAwNzIwMDczMDA2OTAwNmYwMDZlMDAyZDAwMzQ6MDA2MzAwNmMwMDYxMDA2OTAwNmQwMDJkMDAzMSIsImxvY2FsQ2xhaW1JZCI6ImNsYWltLTEiLCJ2ZXJzaW9uSWQiOiJnMS12ZXJzaW9uLTQifV0sImNyYXRlU2hhMjU2IjoiMTI0OGExYTU3ZWU5MmZlNDRiOGZlYjY1YzViZWFjN2EyOWEwMTU3MWE4OTg0OGU4ZGE5N2I2MGUxNjlkZGY2ZSIsImlzc3VlZEF0IjoiMjAyNi0wMy0xNVQwODowMDowNC4wMDBaIiwicHJlZGljYXRlVHlwZSI6Imh0dHBzOi8vb3JhdGxhcy5vcmcvYXR0ZXN0YXRpb25zL2V4ZWN1dGlvbi92MSIsInJlcG9zaXRvcnkiOnsiY29tbWl0U2hhIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInRyZWVTaGEiOiIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIiwidXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2V4YW1wbGUvcmV2aWV3In0sInNjaGVtYVZlcnNpb24iOiIxLjAiLCJzaWduaW5nSWRlbnRpdHkiOnsiaXNzdWVyIjoiaHR0cHM6Ly90b2tlbi5hY3Rpb25zLmdpdGh1YnVzZXJjb250ZW50LmNvbSIsInN1YmplY3QiOiJodHRwczovL2dpdGh1Yi5jb20vZXhhbXBsZS9yZXZpZXcvLmdpdGh1Yi93b3JrZmxvd3MvYW5hbHlzaXMueW1sQHJlZnMvaGVhZHMvbWFpbiJ9LCJ3b3JrZmxvdyI6eyJlbnRpdHlJZCI6Ii5naXRodWIvd29ya2Zsb3dzL2FuYWx5c2lzLnltbCIsInBhdGgiOiIuZ2l0aHViL3dvcmtmbG93cy9hbmFseXNpcy55bWwiLCJydW5BdHRlbXB0IjoxLCJydW5JZCI6IjQyIiwic2hhMjU2IjoiZGE3ZjczOWY2MjcxOTg0NjVlZWFiNTM3YTZmN2E0MzVkYzRhMGMzMzJmOWU0YTg0NjIyOTNlYjNmNGFiN2VlMCJ9fQ==","payloadType":"application/vnd.oratlas.execution-attestation.v1+json","signatures":[{"keyId":"c0faaa0f767ec352c94e0cbcd1f47158887c9596c265301f60ef6092e8d922a0","sig":"CbPcWViU0Av7PKck6WxBpcNyXAj73PCuY0y/OMCWLWhaRvwJlg7aM6oySWQSYvae6iiTVu9lAZx3/aBpR63tBg=="}]},"crate":{"@context":["https://w3id.org/ro/crate/1.1/context","https://w3id.org/ro/terms/workflow-run/context"],"@graph":[{"@id":"ro-crate-metadata.json","@type":"CreativeWork","about":{"@id":"./"},"conformsTo":[{"@id":"https://w3id.org/ro/crate/1.1"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}]},{"@id":"./","@type":"Dataset","conformsTo":[{"@id":"https://w3id.org/ro/wfrun/workflow/0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0"}],"hasPart":[{"@id":".github/workflows/analysis.yml"},{"@id":"inputs/data.csv"},{"@id":"outputs/result.json"}],"license":"MIT","mainEntity":{"@id":".github/workflows/analysis.yml"},"mentions":[{"@id":"#source"},{"@id":"#run"},{"@id":"#claim-1"}],"name":"Attested analysis run"},{"@id":"https://w3id.org/ro/wfrun/workflow/0.5","@type":"CreativeWork","name":"Workflow Run RO-Crate 0.5"},{"@id":"https://w3id.org/ro/wfrun/process/0.5","@type":"CreativeWork","name":"Process Run RO-Crate 0.5"},{"@id":"https://w3id.org/workflowhub/workflow-ro-crate/1.0","@type":"CreativeWork","name":"Workflow RO-Crate 1.0"},{"@id":"#github-actions","@type":"ComputerLanguage","name":"GitHub Actions workflow"},{"@id":"#source","@type":"SoftwareSourceCode","codeRepository":"https://github.com/example/review","commitSha":"1111111111111111111111111111111111111111","treeSha":"2222222222222222222222222222222222222222"},{"@id":".github/workflows/analysis.yml","@type":["File","SoftwareSourceCode","ComputationalWorkflow"],"name":"analysis.yml","programmingLanguage":{"@id":"#github-actions"},"sha256":"da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0","workflowPath":".github/workflows/analysis.yml"},{"@id":"#run","@type":"CreateAction","actionStatus":"https://schema.org/CompletedActionStatus","claimBindings":{"@id":"#claim-1"},"instrument":{"@id":".github/workflows/analysis.yml"},"name":"GitHub Actions run 42","object":{"@id":"inputs/data.csv"},"result":{"@id":"outputs/result.json"},"runAttempt":1,"runId":"42"},{"@id":"inputs/data.csv","@type":"File","contentSize":5,"encodingFormat":"text/csv","name":"data.csv","sha256":"c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20"},{"@id":"outputs/result.json","@type":"File","contentSize":6,"encodingFormat":"application/json","name":"result.json","sha256":"e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a"},{"@id":"#claim-1","@type":"EvidenceBinding","name":"Immutable Atlas claim binding","oratlasClaimId":"oratlas:claim:v1:00670031002d00760065007200730069006f006e002d0034:0063006c00610069006d002d0031"}]}}',
  '1248a1a57ee92fe44b8feb65c5beac7a29a01571a89848e8da97b60e169ddf6e',
  '6419e52e920deada596b170898fc898879ea23139909660c53d4ad0f15914041',
  '205908e167a142fb4a2329796a117c6faa8f320c8b8f484d2492f7bccffda91f',
  'https://github.com/example/review',
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '.github/workflows/analysis.yml',
  '.github/workflows/analysis.yml',
  'da7f739f627198465eeab537a6f7a435dc4a0c332f9e4a8462293eb3f4ab7ee0',
  '42',
  1,
  'c0faaa0f767ec352c94e0cbcd1f47158887c9596c265301f60ef6092e8d922a0',
  'https://token.actions.githubusercontent.com',
  'https://github.com/example/review/.github/workflows/analysis.yml@refs/heads/main',
  '2026-03-15T08:00:04.000Z',
  'g1-user-admin',
  'g1-user-admin',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "ExecutionPassportClaim" (
  "id", "passportId", "claimId"
) VALUES (
  'g1-protocol-passport-unknown-key-claim',
  'g1-protocol-passport-unknown-key',
  'g1-claim-2'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-unknown-key-artifact-0',
  'g1-protocol-passport-unknown-key',
  'inputs/data.csv',
  'input',
  'data.csv',
  'inputs/data.csv',
  'text/csv',
  5,
  'c96c6d5be8d08a12e7b5cdc1b207fa6b2430974c86803d8891675e76fd992c20'
);
INSERT INTO "ExecutionPassportArtifact" (
  "id", "passportId", "entityId", "role", "name", "path", "mediaType", "byteSize", "sha256"
) VALUES (
  'g1-protocol-passport-unknown-key-artifact-1',
  'g1-protocol-passport-unknown-key',
  'outputs/result.json',
  'output',
  'result.json',
  'outputs/result.json',
  'application/json',
  6,
  'e0ee8bb50685e05fa0f47ed04203ae953fdfd055f5bd2892ea186504254f8c3a'
);
INSERT INTO "VerificationRun" (
  "id", "protocolId", "publicationVersionId", "claimedVerifierId", "status", "inputProfile", "inputProfileVersion", "inputSchemaVersion", "inputJson", "inputSha256", "inputCapturedAt", "idempotencyKey", "requestedById", "requestedAt", "claimedAt", "startedAt", "completedAt", "leaseTokenHash", "leaseIssuedAt", "leaseExpiresAt", "leaseGeneration", "createdAt"
) VALUES (
  'g1-protocol-verification-run',
  'g1-verification-protocol-editorial',
  'g1-discovery-version',
  'g1-verifier-editorial',
  'running',
  'full',
  '1.0.0',
  '1.3.0',
  '{"captures":[{"artifactKind":"publication-manifest","byteLength":1298,"contentSha256":"a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43","declaredPath":null,"id":"g1-discovery-manifest","observedUrl":"https://publications.g1.oratlas.example/discovery/oratlas.manifest.json","requestedUrl":"https://publications.g1.oratlas.example/discovery/oratlas.manifest.json","structuralProvenance":"published-structure"},{"artifactKind":"source-document","byteLength":71,"contentSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","declaredPath":"article.md","id":"g1-discovery-source","observedUrl":"https://publications.g1.oratlas.example/discovery/article.md","requestedUrl":"https://publications.g1.oratlas.example/discovery/article.md","structuralProvenance":"published-structure"}],"challenges":[],"completeness":{"captures":{"returned":2,"total":2,"truncated":false},"challenges":{"returned":0,"total":0,"truncated":false},"content":{"coverage":"complete","returnedDocuments":1,"totalDocumentsKnown":1,"truncated":false},"contributors":{"returned":1,"total":1,"truncated":false},"occurrences":{"returned":1,"total":1,"truncated":false},"productionProvenance":{"returned":1,"total":1,"truncated":false},"relations":{"returned":0,"total":0,"truncated":false}},"content":[{"id":"g1-discovery-document","publishedUrl":"https://publications.g1.oratlas.example/discovery/article","representation":"source-text","role":"results","sha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourceArtifactIdentitySha256":"17f318edde9cd8fc6f8473dbe80d7763d9ef99eb35530d080b718bd59c4889e4","sourceArtifactSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourcePath":"article.md","text":"Synthetic public result: alpha and beta are independent fixture labels.","title":"G1 public discovery result"}],"contributors":[{"affiliations":[],"declarationStatus":"source-declared","displayName":"G1 Discovery Author","familyName":null,"givenName":null,"id":"g1-discovery-contributor","identifiers":[],"kind":"person","links":{"publicProfile":null,"publicationVersion":"/api/publication-versions/g1-discovery-version"},"position":1,"publicUrl":null,"publicationVersionId":"g1-discovery-version","roles":["author"],"sourceContributorKey":"author-1","sourceDeclarationProvenance":{"sourceArtifactIdentitySha256":"ba0969399c05d646c5703cf94a829be4a4dc5879203422d425f34bd399c27395","sourceArtifactKind":"publication-manifest","sourceArtifactSha256":"a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43","type":"source-declared"}}],"links":{"content":"/api/publication-versions/g1-discovery-version/content","contributors":"/api/publication-versions/g1-discovery-version/contributors","productionProvenance":"/api/publication-versions/g1-discovery-version/production-provenance","publication":"/api/publications/g1-discovery-publication","publicationVersion":"/api/publication-versions/g1-discovery-version","self":"/api/publication-versions/g1-discovery-version/packet"},"occurrences":[{"canonicalBinding":null,"claimType":"empirical","declarationAuthority":"publication-source","declarationSha256":"6a8159c20e6f58a8f5da18a3c970df1f92f0bd232f2b34c53d0cf5a99c4e7503","id":"g1-discovery-occurrence","links":{"canonicalGraph":null,"occurrence":"/api/publication-claim-occurrences/g1-discovery-occurrence","originalPublication":"https://publications.g1.oratlas.example/discovery/article#synthetic-result"},"publishedTargetUrl":"https://publications.g1.oratlas.example/discovery/article#synthetic-result","qualification":null,"selector":{"representation":"oratlas-myst-source-utf8-v1","textPosition":{"end":71,"start":0,"type":"TextPositionSelector"},"textQuote":{"exact":"Synthetic public result: alpha and beta are independent fixture labels.","type":"TextQuoteSelector"},"unit":"body"},"sourceBinding":{"blockSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","documentPath":"article.md","documentSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","endLine":1,"startLine":1},"sourceLocalClaimId":"synthetic-result","target":{"htmlId":"synthetic-result","identifier":"synthetic-result","type":"myst-xref"},"text":"Synthetic public result: alpha and beta are independent fixture labels."}],"productionProvenance":[{"activities":["drafting"],"actors":[{"kind":"software","name":"Synthetic Discovery Tool","version":"fixture-1"}],"agentRunId":null,"assertedAt":"2026-03-12T00:00:00.000Z","assertedBy":null,"executionPassportId":null,"id":"g1-discovery-production","lifecycleState":"active","links":{"executionPassport":null,"publicEvidence":null,"publicationVersion":"/api/publication-versions/g1-discovery-version"},"mode":"ai-assisted","publicEvidenceUrl":null,"publicationVersionId":"g1-discovery-version","sourceAssertionKey":"synthetic-production","statement":"Synthetic source declaration, never scientific verification.","strength":"source-declared","supersededByAssertionId":null,"supersedesAssertionId":null}],"publication":{"id":"g1-discovery-publication","publicationType":"research-article","recordSource":"external-publication","sourceLocalPublicationId":null},"relations":[],"schemaVersion":"1.3.0","sha256":"c5b7b48e8b2eb1e568713a86c82f3c485598e8ed27eccc9968789453ffa33dd3","version":{"adapterType":"myst","id":"g1-discovery-version","observedAt":"2026-03-12T00:00:00.000Z","observedPublicationBaseUrl":"https://publications.g1.oratlas.example/discovery/","publisherCanonicalUrl":"https://publications.g1.oratlas.example/discovery/","sourceLocalPublicationId":null,"sourcesSha256":"de3d3960b987df55170f1389cd5ece8544d1733a539ab7fdebc8c58c3abc0076","structuralProvenance":"published-structure","title":"G1 public discovery fixture","versionLabel":"v1"}}',
  '890bdbdfaafb0db8bae2370c838704ff684969413a79160f6e1bd2f89c87bd6e',
  '2026-04-01T00:00:00.000Z',
  'g1-protocol-verification-run',
  'g1-user-admin',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  NULL,
  'dfa4c9a940ee304df45fd5d2e75a0bca748f8e866175c174368cf2db6ef4a8f1',
  '2026-04-01T00:00:00.000Z',
  '2026-04-02T00:00:00.000Z',
  1,
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationRunLifecycleEvent" (
  "id", "verificationRunId", "kind", "actorUserId", "actorVerifierId", "detailsJson", "createdAt"
) VALUES (
  'g1-protocol-lifecycle-0-requested',
  'g1-protocol-verification-run',
  'requested',
  'g1-user-admin',
  NULL,
  '{"fixture":"Synthetic archive lifecycle only; no verifier was executed."}',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationRunLifecycleEvent" (
  "id", "verificationRunId", "kind", "actorUserId", "actorVerifierId", "detailsJson", "createdAt"
) VALUES (
  'g1-protocol-lifecycle-1-claimed',
  'g1-protocol-verification-run',
  'claimed',
  NULL,
  'g1-verifier-editorial',
  '{"fixture":"Synthetic archive lifecycle only; no verifier was executed."}',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationRunLifecycleEvent" (
  "id", "verificationRunId", "kind", "actorUserId", "actorVerifierId", "detailsJson", "createdAt"
) VALUES (
  'g1-protocol-lifecycle-2-running',
  'g1-protocol-verification-run',
  'running',
  NULL,
  'g1-verifier-editorial',
  '{"fixture":"Synthetic archive lifecycle only; no verifier was executed."}',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationRunLifecycleEvent" (
  "id", "verificationRunId", "kind", "actorUserId", "actorVerifierId", "detailsJson", "createdAt"
) VALUES (
  'g1-protocol-lifecycle-3-completed',
  'g1-protocol-verification-run',
  'completed',
  NULL,
  'g1-verifier-editorial',
  '{"fixture":"Synthetic archive lifecycle only; no verifier was executed."}',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifact" (
  "id", "verificationRunId", "submittedByVerifierId", "artifactKey", "kind", "mediaType", "sha256", "byteLength", "visibility", "status", "storageRef", "provenanceJson", "preparedAt", "uploadExpiresAt", "uploadedAt", "completedAt", "createdAt"
) VALUES (
  'g1-protocol-artifact-public',
  'g1-protocol-verification-run',
  'g1-verifier-editorial',
  'public',
  'synthetic-evidence',
  'text/plain; charset=utf-8',
  '4dde5204666e8a1176de3d34f56b3edc55e2d78db252a8270b3dfee0dbc82825',
  44,
  'public',
  'completed',
  'postgres:VerificationArtifactBlob:g1-protocol-artifact-public',
  '{"fixture":"synthetic-g1-only"}',
  '2026-04-01T00:00:00.000Z',
  '2026-04-02T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifactBlob" (
  "artifactId", "bytes", "createdAt"
) VALUES (
  'g1-protocol-artifact-public',
  '\x53796e74686574696320473120766572696669636174696f6e2065766964656e63653a207075626c69632e0a',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifact" (
  "id", "verificationRunId", "submittedByVerifierId", "artifactKey", "kind", "mediaType", "sha256", "byteLength", "visibility", "status", "storageRef", "provenanceJson", "preparedAt", "uploadExpiresAt", "uploadedAt", "completedAt", "createdAt"
) VALUES (
  'g1-protocol-artifact-private',
  'g1-protocol-verification-run',
  'g1-verifier-editorial',
  'private',
  'synthetic-evidence',
  'text/plain; charset=utf-8',
  '7f4d7c5e22d0ad64bd3b18fbadc0178c8fdc4873e3f34da81d31f2971f1f9bff',
  34,
  'private',
  'completed',
  'postgres:VerificationArtifactBlob:g1-protocol-artifact-private',
  '{"fixture":"synthetic-g1-only"}',
  '2026-04-01T00:00:00.000Z',
  '2026-04-02T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifactBlob" (
  "artifactId", "bytes", "createdAt"
) VALUES (
  'g1-protocol-artifact-private',
  '\x47315f50524f544f434f4c5f505249564154455f41525449464143545f4259544553',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifact" (
  "id", "verificationRunId", "submittedByVerifierId", "artifactKey", "kind", "mediaType", "sha256", "byteLength", "visibility", "status", "storageRef", "provenanceJson", "preparedAt", "uploadExpiresAt", "uploadedAt", "completedAt", "createdAt"
) VALUES (
  'g1-protocol-artifact-prepared',
  'g1-protocol-verification-run',
  'g1-verifier-editorial',
  'prepared',
  'synthetic-evidence',
  'text/plain; charset=utf-8',
  '955e4eb84f917c4c9fdf4f8ba0ce2f90731860ddeb4232eee2b531b486e8edd4',
  46,
  'public',
  'prepared',
  NULL,
  '{"fixture":"synthetic-g1-only"}',
  '2026-04-01T00:00:00.000Z',
  '2026-04-02T00:00:00.000Z',
  NULL,
  NULL,
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifact" (
  "id", "verificationRunId", "submittedByVerifierId", "artifactKey", "kind", "mediaType", "sha256", "byteLength", "visibility", "status", "storageRef", "provenanceJson", "preparedAt", "uploadExpiresAt", "uploadedAt", "completedAt", "createdAt"
) VALUES (
  'g1-protocol-artifact-tampered',
  'g1-protocol-verification-run',
  'g1-verifier-editorial',
  'tampered',
  'synthetic-evidence',
  'text/plain; charset=utf-8',
  'd827bba55bf22245a44c8fe09c9b5fc0b970082559a71610669eb0dd50533f11',
  46,
  'public',
  'completed',
  'postgres:VerificationArtifactBlob:g1-protocol-artifact-tampered',
  '{"fixture":"synthetic-g1-only"}',
  '2026-04-01T00:00:00.000Z',
  '2026-04-02T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationArtifactBlob" (
  "artifactId", "bytes", "createdAt"
) VALUES (
  'g1-protocol-artifact-tampered',
  '\x53796e74686574696320473120766572696669636174696f6e2065766964656e63653a2074616d70657265642e0a',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationFinding" (
  "id", "verificationRunId", "submittedByVerifierId", "findingKey", "findingType", "status", "impact", "statement", "rationale", "evidenceRefsJson", "payloadJson", "payloadSha256", "createdAt"
) VALUES (
  'g1-protocol-finding-a',
  'g1-protocol-verification-run',
  'g1-verifier-editorial',
  'synthetic-a',
  'statistic-consistency',
  'unverifiable',
  'minor',
  'Synthetic archive unverifiable fixture; no scientific evaluation occurred.',
  'Only public read projection and provenance are exercised.',
  '[{"id":"g1-discovery-occurrence","type":"publication-occurrence"}]',
  '{"artifactRefs":["g1-protocol-artifact-public"],"evidenceRefs":[{"id":"g1-discovery-occurrence","type":"publication-occurrence"}],"findingKey":"synthetic-a","findingType":"statistic-consistency","impact":"minor","rationale":"Only public read projection and provenance are exercised.","statement":"Synthetic archive unverifiable fixture; no scientific evaluation occurred.","status":"unverifiable"}',
  '20b6e42cb73a0127a93cba6f61d7400f6c1a1b51224fe7d946862b2f79e3b147',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationFindingArtifact" (
  "verificationFindingId", "verificationArtifactId"
) VALUES (
  'g1-protocol-finding-a',
  'g1-protocol-artifact-public'
);
INSERT INTO "VerificationFinding" (
  "id", "verificationRunId", "submittedByVerifierId", "findingKey", "findingType", "status", "impact", "statement", "rationale", "evidenceRefsJson", "payloadJson", "payloadSha256", "createdAt"
) VALUES (
  'g1-protocol-finding-b',
  'g1-protocol-verification-run',
  'g1-verifier-editorial',
  'synthetic-b',
  'statistic-consistency',
  'discrepancy',
  'minor',
  'Synthetic archive discrepancy fixture; no scientific evaluation occurred.',
  'Only public read projection and provenance are exercised.',
  '[{"id":"g1-discovery-occurrence","type":"publication-occurrence"}]',
  '{"artifactRefs":["g1-protocol-artifact-public"],"evidenceRefs":[{"id":"g1-discovery-occurrence","type":"publication-occurrence"}],"findingKey":"synthetic-b","findingType":"statistic-consistency","impact":"minor","rationale":"Only public read projection and provenance are exercised.","statement":"Synthetic archive discrepancy fixture; no scientific evaluation occurred.","status":"discrepancy"}',
  '0e04c39254adbc8e376adcb1c9ceae0edc4121c0174452e06d670a2698b132aa',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "VerificationFindingArtifact" (
  "verificationFindingId", "verificationArtifactId"
) VALUES (
  'g1-protocol-finding-b',
  'g1-protocol-artifact-public'
);
INSERT INTO "CertificationRun" (
  "id", "publicationVersionId", "certifierId", "protocolId", "assessmentMode", "status", "idempotencyKey", "inputPacketJson", "inputPacketSha256", "packetSchemaVersion", "completenessJson", "capturedAt", "startedAt", "completedAt", "createdAt"
) VALUES (
  'g1-protocol-certification-run',
  'g1-discovery-version',
  'g1-certifier-ora',
  'g1-certification-protocol-editorial',
  'human',
  'completed',
  'g1-protocol-certification-run',
  '{"captures":[{"artifactKind":"publication-manifest","byteLength":1298,"contentSha256":"a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43","declaredPath":null,"id":"g1-discovery-manifest","observedUrl":"https://publications.g1.oratlas.example/discovery/oratlas.manifest.json","requestedUrl":"https://publications.g1.oratlas.example/discovery/oratlas.manifest.json","structuralProvenance":"published-structure"},{"artifactKind":"source-document","byteLength":71,"contentSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","declaredPath":"article.md","id":"g1-discovery-source","observedUrl":"https://publications.g1.oratlas.example/discovery/article.md","requestedUrl":"https://publications.g1.oratlas.example/discovery/article.md","structuralProvenance":"published-structure"}],"challenges":[],"completeness":{"captures":{"returned":2,"total":2,"truncated":false},"challenges":{"returned":0,"total":0,"truncated":false},"content":{"coverage":"complete","returnedDocuments":1,"totalDocumentsKnown":1,"truncated":false},"contributors":{"returned":1,"total":1,"truncated":false},"occurrences":{"returned":1,"total":1,"truncated":false},"productionProvenance":{"returned":1,"total":1,"truncated":false},"relations":{"returned":0,"total":0,"truncated":false}},"content":[{"id":"g1-discovery-document","publishedUrl":"https://publications.g1.oratlas.example/discovery/article","representation":"source-text","role":"results","sha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourceArtifactIdentitySha256":"17f318edde9cd8fc6f8473dbe80d7763d9ef99eb35530d080b718bd59c4889e4","sourceArtifactSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","sourcePath":"article.md","text":"Synthetic public result: alpha and beta are independent fixture labels.","title":"G1 public discovery result"}],"contributors":[{"affiliations":[],"declarationStatus":"source-declared","displayName":"G1 Discovery Author","familyName":null,"givenName":null,"id":"g1-discovery-contributor","identifiers":[],"kind":"person","links":{"publicProfile":null,"publicationVersion":"/api/publication-versions/g1-discovery-version"},"position":1,"publicUrl":null,"publicationVersionId":"g1-discovery-version","roles":["author"],"sourceContributorKey":"author-1","sourceDeclarationProvenance":{"sourceArtifactIdentitySha256":"ba0969399c05d646c5703cf94a829be4a4dc5879203422d425f34bd399c27395","sourceArtifactKind":"publication-manifest","sourceArtifactSha256":"a023519b0542fafd6f3120246286537d6205dbf649a2db3f5ee9e1984444fc43","type":"source-declared"}}],"links":{"content":"/api/publication-versions/g1-discovery-version/content","contributors":"/api/publication-versions/g1-discovery-version/contributors","productionProvenance":"/api/publication-versions/g1-discovery-version/production-provenance","publication":"/api/publications/g1-discovery-publication","publicationVersion":"/api/publication-versions/g1-discovery-version","self":"/api/publication-versions/g1-discovery-version/packet"},"occurrences":[{"canonicalBinding":null,"claimType":"empirical","declarationAuthority":"publication-source","declarationSha256":"6a8159c20e6f58a8f5da18a3c970df1f92f0bd232f2b34c53d0cf5a99c4e7503","id":"g1-discovery-occurrence","links":{"canonicalGraph":null,"occurrence":"/api/publication-claim-occurrences/g1-discovery-occurrence","originalPublication":"https://publications.g1.oratlas.example/discovery/article#synthetic-result"},"publishedTargetUrl":"https://publications.g1.oratlas.example/discovery/article#synthetic-result","qualification":null,"selector":{"representation":"oratlas-myst-source-utf8-v1","textPosition":{"end":71,"start":0,"type":"TextPositionSelector"},"textQuote":{"exact":"Synthetic public result: alpha and beta are independent fixture labels.","type":"TextQuoteSelector"},"unit":"body"},"sourceBinding":{"blockSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","documentPath":"article.md","documentSha256":"53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08","endLine":1,"startLine":1},"sourceLocalClaimId":"synthetic-result","target":{"htmlId":"synthetic-result","identifier":"synthetic-result","type":"myst-xref"},"text":"Synthetic public result: alpha and beta are independent fixture labels."}],"productionProvenance":[{"activities":["drafting"],"actors":[{"kind":"software","name":"Synthetic Discovery Tool","version":"fixture-1"}],"agentRunId":null,"assertedAt":"2026-03-12T00:00:00.000Z","assertedBy":null,"executionPassportId":null,"id":"g1-discovery-production","lifecycleState":"active","links":{"executionPassport":null,"publicEvidence":null,"publicationVersion":"/api/publication-versions/g1-discovery-version"},"mode":"ai-assisted","publicEvidenceUrl":null,"publicationVersionId":"g1-discovery-version","sourceAssertionKey":"synthetic-production","statement":"Synthetic source declaration, never scientific verification.","strength":"source-declared","supersededByAssertionId":null,"supersedesAssertionId":null}],"publication":{"id":"g1-discovery-publication","publicationType":"research-article","recordSource":"external-publication","sourceLocalPublicationId":null},"relations":[],"schemaVersion":"1.3.0","sha256":"c5b7b48e8b2eb1e568713a86c82f3c485598e8ed27eccc9968789453ffa33dd3","version":{"adapterType":"myst","id":"g1-discovery-version","observedAt":"2026-03-12T00:00:00.000Z","observedPublicationBaseUrl":"https://publications.g1.oratlas.example/discovery/","publisherCanonicalUrl":"https://publications.g1.oratlas.example/discovery/","sourceLocalPublicationId":null,"sourcesSha256":"de3d3960b987df55170f1389cd5ece8544d1733a539ab7fdebc8c58c3abc0076","structuralProvenance":"published-structure","title":"G1 public discovery fixture","versionLabel":"v1"}}',
  '890bdbdfaafb0db8bae2370c838704ff684969413a79160f6e1bd2f89c87bd6e',
  '1.3.0',
  '{"captures":{"returned":2,"total":2,"truncated":false},"challenges":{"returned":0,"total":0,"truncated":false},"content":{"coverage":"complete","returnedDocuments":1,"totalDocumentsKnown":1,"truncated":false},"contributors":{"returned":1,"total":1,"truncated":false},"occurrences":{"returned":1,"total":1,"truncated":false},"productionProvenance":{"returned":1,"total":1,"truncated":false},"relations":{"returned":0,"total":0,"truncated":false}}',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "CertificationResult" (
  "id", "certificationRunId", "publicationVersionId", "certifierId", "protocolId", "inputPacketSha256", "assessmentMode", "criteriaJson", "outcome", "limitationsJson", "conflictOfInterestJson", "independenceJson", "provenanceJson", "resultJson", "resultSha256", "issuedAt", "createdAt"
) VALUES (
  'g1-protocol-certification-result',
  'g1-protocol-certification-run',
  'g1-discovery-version',
  'g1-certifier-ora',
  'g1-certification-protocol-editorial',
  '890bdbdfaafb0db8bae2370c838704ff684969413a79160f6e1bd2f89c87bd6e',
  'human',
  '[{"criterionId":"fixture-completeness","evidenceRefs":[],"rationale":"Synthetic archive field present; no scientific evaluation occurred.","status":"pass"}]',
  'inconclusive',
  '["Synthetic public harness fixture; no external certifier executed."]',
  '{"status":"none-declared"}',
  '{"declared":false,"statement":"Synthetic fixture does not assert independent assessment."}',
  '{}',
  '{"conflictOfInterest":{"status":"none-declared"},"criteria":[{"criterionId":"fixture-completeness","evidenceRefs":[],"rationale":"Synthetic archive field present; no scientific evaluation occurred.","status":"pass"}],"independence":{"declared":false,"statement":"Synthetic fixture does not assert independent assessment."},"limitations":["Synthetic public harness fixture; no external certifier executed."],"outcome":"inconclusive","packetSha256":"890bdbdfaafb0db8bae2370c838704ff684969413a79160f6e1bd2f89c87bd6e","provenance":{},"schemaVersion":"1.0.0"}',
  '34f8a689f0ca97d58307dbbdfe6128c3e58d145b2172193587f0091fdfd0e8d7',
  '2026-04-01T00:00:00.000Z',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "CertificationLifecycleEvent" (
  "id", "resultId", "kind", "reason", "actorCertifierId", "createdAt"
) VALUES (
  'g1-protocol-certification-issued',
  'g1-protocol-certification-result',
  'issued',
  NULL,
  'g1-certifier-ora',
  '2026-04-01T00:00:00.000Z'
);
INSERT INTO "CertificationLifecycleEvent" (
  "id", "resultId", "kind", "reason", "actorCertifierId", "createdAt"
) VALUES (
  'g1-protocol-certification-withdrawn',
  'g1-protocol-certification-result',
  'withdrawn',
  'Synthetic withdrawal: historical assertion stays visible, never a current endorsement.',
  'g1-certifier-ora',
  '2026-04-01T00:00:00.000Z'
);
-- Native binding guards require artifacts/findings to be inserted while the claimant is active.
-- Complete only this newly inserted synthetic run after its findings; no base row is modified.
UPDATE "VerificationRun" SET "status" = 'completed', "completedAt" = '2026-04-01T00:00:00.000Z' WHERE "id" = 'g1-protocol-verification-run' AND "status" = 'running';
