import { describe, expect, it } from "vitest";
import {
  archiveSearchQuerySchema,
  nodeArchiveQuerySchema,
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
});
