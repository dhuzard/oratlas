import { describe, expect, it } from "vitest";
import {
  archiveSearchQuerySchema,
  nodeArchiveQuerySchema,
  publicNodeEdgeSchema,
  publicNodeVersionSchema,
} from "./index.js";

describe("public node contracts", () => {
  it("parses bounded content filters and rejects unknown fields", () => {
    expect(
      archiveSearchQuerySchema.parse({ contentType: "node", nodeKind: "dataset" }),
    ).toMatchObject({ contentType: "node", nodeKind: "dataset", page: 1, pageSize: 20 });
    expect(nodeArchiveQuerySchema.safeParse({ kind: "claim", extra: true }).success).toBe(false);
  });

  it("keeps kind payloads strict", () => {
    const base = {
      id: "v1",
      snapshotId: "s1",
      commitSha: "a".repeat(40),
      kind: "claim",
      title: "Claim",
      contributors: [],
      license: "CC-BY-4.0",
      provenance: { sourcePath: "nodes/claim.json" },
      identifiers: [],
      isExample: false,
      createdAt: new Date(0).toISOString(),
    };
    expect(
      publicNodeVersionSchema.safeParse({
        ...base,
        payload: { statement: "Grounded statement.", qualifiers: [] },
      }).success,
    ).toBe(true);
    expect(
      publicNodeVersionSchema.safeParse({
        ...base,
        payload: { statement: "Grounded statement.", qualifiers: [], injected: "<script>" },
      }).success,
    ).toBe(false);
  });

  it("identifies the exact related version used by a confirmed edge", () => {
    const edge = {
      id: "edge-1",
      direction: "outgoing",
      relationType: "uses-dataset",
      provenance: "confirmed-by-editor",
      relatedNode: {
        id: "node-2",
        localNodeId: "dataset-2",
        kind: "dataset",
        title: "Dataset at confirmation",
        repository: {
          owner: "lab",
          name: "review",
          url: "https://github.com/lab/review",
        },
        versionId: "version-2",
        versionCreatedAt: new Date(0).toISOString(),
      },
    };
    expect(publicNodeEdgeSchema.safeParse(edge).success).toBe(true);
    expect(
      publicNodeEdgeSchema.safeParse({
        ...edge,
        relatedNode: { ...edge.relatedNode, currentVersionId: "newest-version" },
      }).success,
    ).toBe(false);
  });
});
