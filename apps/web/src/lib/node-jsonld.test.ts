import { describe, expect, it } from "vitest";
import { publicNodeDetailSchema, type PublicNodeDetail } from "@oratlas/contracts";
import { nodeJsonLd } from "./node-jsonld";

function datasetNode(): PublicNodeDetail {
  return publicNodeDetailSchema.parse({
    schemaVersion: "1.0.0",
    id: "node-1",
    localNodeId: "dataset-1",
    kind: "dataset",
    repository: { owner: "lab", name: "repo", url: "https://github.com/lab/repo" },
    version: {
      id: "version-1",
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
      kind: "dataset",
      title: "Dataset </script>",
      contributors: [],
      license: "CC-BY-4.0",
      provenance: { sourcePath: "nodes/dataset.json" },
      payload: { format: "text/csv", sizeBytes: 42, doi: "10.1234/artifact" },
      identifiers: [
        {
          scheme: "doi",
          role: "version-doi",
          value: "10.1234/version",
          isExample: false,
        },
        {
          scheme: "doi",
          role: "concept-doi",
          value: "10.5555/example",
          isExample: true,
        },
        {
          scheme: "doi",
          role: "artifact-doi",
          value: "10.1234/artifact",
          isExample: false,
        },
      ],
      isExample: true,
      createdAt: new Date(0).toISOString(),
    },
    versions: [
      {
        id: "version-1",
        title: "Dataset </script>",
        commitSha: "a".repeat(40),
        createdAt: new Date(0).toISOString(),
        isCurrent: true,
      },
    ],
    edges: [],
    sameClaims: [],
    trustContext: [],
  });
}

describe("nodeJsonLd", () => {
  it("maps kind-specific metadata and independently excludes only example DOI roles", () => {
    const json = nodeJsonLd(datasetNode(), "https://oratlas.example/nodes/node-1");
    expect(json["@type"]).toBe("Dataset");
    expect(json.encodingFormat).toBe("text/csv");
    const identifiers = json.identifier as Array<{ value: string }>;
    expect(identifiers.map((identifier) => identifier.value)).toEqual([
      "10.1234/version",
      "10.1234/artifact",
    ]);
    expect(JSON.stringify(json)).not.toContain("10.5555/example");
  });
});
