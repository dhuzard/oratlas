import { describe, expect, it } from "vitest";
import {
  assertKnowledgeNodeMaterializationBinding,
  type KnowledgeNodeMaterializationBinding,
} from "./knowledge-node-integrity.js";

function validBinding(): KnowledgeNodeMaterializationBinding {
  return {
    repository: { id: "repository-1", githubRepositoryId: "12345" },
    node: { repositoryId: "repository-1" },
    snapshot: { id: "snapshot-1", repositoryId: "repository-1", commitSha: "a".repeat(40) },
    submission: {
      id: "submission-1",
      repositoryId: "repository-1",
      snapshotId: "snapshot-1",
      inspectionCaptureId: "capture-1",
    },
    capture: {
      id: "capture-1",
      githubRepositoryId: "12345",
      commitSha: "a".repeat(40),
      payloadHash: "b".repeat(64),
    },
    version: {
      sourceSubmissionId: "submission-1",
      inspectionCaptureId: "capture-1",
      capturePayloadHash: "b".repeat(64),
    },
  };
}

describe("knowledge-node materialization integrity", () => {
  it("accepts one exact repository, snapshot, submission, and capture chain", () => {
    expect(() => assertKnowledgeNodeMaterializationBinding(validBinding())).not.toThrow();
  });

  it.each([
    [
      "node repository",
      (binding: KnowledgeNodeMaterializationBinding) => (binding.node.repositoryId = "other"),
    ],
    [
      "snapshot repository",
      (binding: KnowledgeNodeMaterializationBinding) => (binding.snapshot.repositoryId = "other"),
    ],
    [
      "submission repository",
      (binding: KnowledgeNodeMaterializationBinding) => (binding.submission.repositoryId = "other"),
    ],
    [
      "submission snapshot",
      (binding: KnowledgeNodeMaterializationBinding) => (binding.submission.snapshotId = "other"),
    ],
    [
      "capture repository identity",
      (binding: KnowledgeNodeMaterializationBinding) =>
        (binding.capture.githubRepositoryId = "different-github-id"),
    ],
    [
      "capture commit",
      (binding: KnowledgeNodeMaterializationBinding) =>
        (binding.capture.commitSha = "c".repeat(40)),
    ],
    [
      "version capture hash",
      (binding: KnowledgeNodeMaterializationBinding) =>
        (binding.version.capturePayloadHash = "different-hash"),
    ],
    [
      "version source submission",
      (binding: KnowledgeNodeMaterializationBinding) => (binding.version.sourceSubmissionId = null),
    ],
    [
      "version inspection capture",
      (binding: KnowledgeNodeMaterializationBinding) =>
        (binding.version.inspectionCaptureId = null),
    ],
    [
      "submission inspection capture",
      (binding: KnowledgeNodeMaterializationBinding) =>
        (binding.submission.inspectionCaptureId = null),
    ],
  ])("rejects a %s mismatch", (label, mutate) => {
    const binding = validBinding();
    mutate(binding);
    expect(() => assertKnowledgeNodeMaterializationBinding(binding)).toThrow(
      new RegExp(`${label} mismatch`),
    );
  });

  it("rejects repositories without an immutable GitHub identity", () => {
    const binding = validBinding();
    binding.repository.githubRepositoryId = null;
    expect(() => assertKnowledgeNodeMaterializationBinding(binding)).toThrow(
      /requires an immutable GitHub repository id/,
    );
  });
});
