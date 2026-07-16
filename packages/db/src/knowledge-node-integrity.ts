/**
 * Cross-table values KG-04 must verify inside the editorial acceptance
 * transaction before it creates a KnowledgeNodeVersion. Prisma foreign keys
 * prove each referenced row exists, but cannot prove all rows describe the
 * same repository, snapshot, capture, and immutable GitHub identity.
 */
export interface KnowledgeNodeMaterializationBinding {
  repository: { id: string; githubRepositoryId: string | null };
  node: { repositoryId: string };
  snapshot: { id: string; repositoryId: string; commitSha: string };
  submission: {
    id: string;
    repositoryId: string;
    snapshotId: string | null;
    inspectionCaptureId: string | null;
  };
  capture: { id: string; githubRepositoryId: string; commitSha: string; payloadHash: string };
  version: {
    sourceSubmissionId: string | null;
    inspectionCaptureId: string | null;
    capturePayloadHash: string | null;
  };
}

/** Fail closed on any cross-table provenance mismatch. */
export function assertKnowledgeNodeMaterializationBinding(
  binding: KnowledgeNodeMaterializationBinding,
): void {
  const repositoryGithubId = binding.repository.githubRepositoryId;
  if (!repositoryGithubId) {
    throw new Error("Knowledge-node materialization requires an immutable GitHub repository id.");
  }

  requireEqual("node repository", binding.node.repositoryId, binding.repository.id);
  requireEqual("snapshot repository", binding.snapshot.repositoryId, binding.repository.id);
  requireEqual("submission repository", binding.submission.repositoryId, binding.repository.id);
  requireEqual("submission snapshot", binding.submission.snapshotId, binding.snapshot.id);
  requireEqual(
    "version source submission",
    binding.version.sourceSubmissionId,
    binding.submission.id,
  );
  requireEqual(
    "submission inspection capture",
    binding.submission.inspectionCaptureId,
    binding.capture.id,
  );
  requireEqual(
    "version inspection capture",
    binding.version.inspectionCaptureId,
    binding.capture.id,
  );
  requireEqual(
    "capture repository identity",
    binding.capture.githubRepositoryId,
    repositoryGithubId,
  );
  requireEqual("capture commit", binding.capture.commitSha, binding.snapshot.commitSha);
  requireEqual(
    "version capture hash",
    binding.version.capturePayloadHash,
    binding.capture.payloadHash,
  );
}

function requireEqual(label: string, actual: string | null, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      `Knowledge-node materialization ${label} mismatch: expected '${expected}', received ` +
        `${actual === null ? "null" : `'${actual}'`}.`,
    );
  }
}
