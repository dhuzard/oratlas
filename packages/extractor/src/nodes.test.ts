import { describe, expect, it } from "vitest";
import { createFakeTransport, inspectRepository, type FakeRepoFixture } from "@oratlas/github";
import { CLAIM_NODE_JSON, NODE_COMMIT, nodePublicationFixture } from "@oratlas/github/fixtures";
import { runExtraction } from "./index.js";
import { extractKnowledgeNodes, nodeExtractionReportSchema } from "./nodes.js";

const now = () => new Date("2026-07-16T00:00:00Z");

async function inspect(fixture: FakeRepoFixture, maxFileBytes?: number) {
  return inspectRepository(`${fixture.owner}/${fixture.name}`, {
    transport: createFakeTransport(fixture),
    limits: maxFileBytes ? { maxFileBytes } : undefined,
    now,
  });
}

describe("extractKnowledgeNodes", () => {
  it("extracts all node kinds and edges with field-level provenance", async () => {
    const report = extractKnowledgeNodes(await inspect(nodePublicationFixture));

    expect(report.manifest.status).toBe("ok");
    expect(report.counts).toEqual({
      ok: 4,
      invalid: 0,
      skipped: 0,
      edgesOk: 1,
      edgesInvalid: 0,
      edgesSkipped: 0,
    });
    expect(report.nodes.map((record) => record.node?.kind)).toEqual([
      "claim",
      "figure",
      "dataset",
      "code",
    ]);
    expect(report.nodes[0]?.fieldProvenance["payload.statement"]).toMatchObject({
      file: "nodes/primary-claim.json",
      pointer: "$.payload.statement",
      commitSha: NODE_COMMIT,
      confidence: 1,
    });
    expect(report.edges[0]?.edge?.relationType).toBe("uses-dataset");
    expect(nodeExtractionReportSchema.safeParse(JSON.parse(JSON.stringify(report))).success).toBe(
      true,
    );
  });

  it("reports malformed manifests without attempting partial extraction", async () => {
    const fixture = {
      ...nodePublicationFixture,
      files: { "node-manifest.json": "{broken" },
    };
    const report = extractKnowledgeNodes(await inspect(fixture));
    expect(report.manifest.status).toBe("invalid");
    expect(report.errors.map((issue) => issue.code)).toContain("manifest-invalid");
    expect(report.nodes).toEqual([]);
  });

  it("rejects unsafe artifact paths at the record boundary", async () => {
    const unsafe = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
    unsafe.kind = "figure";
    unsafe.id = "figure:unsafe";
    unsafe.provenance = { sourcePath: "nodes/unsafe.json", commitSha: NODE_COMMIT };
    unsafe.payload = { artifactPath: "../private.png", caption: "Unsafe" };
    const fixture = singleJsonNodeFixture("nodes/unsafe.json", unsafe);
    const report = extractKnowledgeNodes(await inspect(fixture));
    expect(report.nodes[0]?.status).toBe("invalid");
    expect(report.nodes[0]?.issues.map((issue) => issue.code)).toContain("record-schema-invalid");
  });

  it("marks oversized source files as skipped", async () => {
    const report = extractKnowledgeNodes(await inspect(nodePublicationFixture, 100));
    expect(report.nodes.every((record) => record.status === "skipped")).toBe(true);
    expect(report.nodes[0]?.issues.map((issue) => issue.code)).toContain("source-oversized");
  });

  it("flags example DOIs without rejecting or resolving the node", async () => {
    const report = extractKnowledgeNodes(await inspect(nodePublicationFixture));
    const dataset = report.nodes.find((record) => record.declaredId === "dataset:observations");
    expect(dataset?.status).toBe("ok");
    expect(dataset?.doiReferences).toContainEqual({
      field: "payload.doi",
      input: "10.5555/oratlas.example.dataset.v1",
      normalizedDoi: "10.5555/oratlas.example.dataset.v1",
      isZenodo: false,
      isExample: true,
    });
    expect(dataset?.issues.map((issue) => issue.code)).toContain("example-doi");
  });

  it.each(["10.5555/", "10.1234/"])(
    "invalidates schema-accepted overlong DOI values for prefix %s",
    async (prefix) => {
      const dataset = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
      dataset.id = "dataset:overlong-doi";
      dataset.kind = "dataset";
      dataset.provenance = { sourcePath: "nodes/overlong.json", commitSha: NODE_COMMIT };
      dataset.versionDoi = `${prefix}${"x".repeat(501)}`;
      dataset.payload = { format: "text/csv", sizeBytes: 1 };
      const report = extractKnowledgeNodes(
        await inspect(singleJsonNodeFixture("nodes/overlong.json", dataset)),
      );

      expect(report.nodes[0]?.status).toBe("invalid");
      expect(report.nodes[0]?.issues).toContainEqual(
        expect.objectContaining({
          severity: "error",
          code: "doi-invalid",
          field: "versionDoi",
        }),
      );
      expect(report.errors.map((issue) => issue.code)).toContain("doi-invalid");
    },
  );

  it("preserves JSONL order and line pointers", async () => {
    const first = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
    first.provenance = { sourcePath: "nodes/nodes.jsonl", commitSha: NODE_COMMIT };
    const second = structuredClone(first);
    second.id = "claim:secondary";
    const fixture: FakeRepoFixture = {
      ...nodePublicationFixture,
      files: {
        "node-manifest.json": JSON.stringify({
          schemaVersion: "1.0.0",
          nodes: { format: "jsonl", path: "nodes/nodes.jsonl" },
        }),
        "nodes/nodes.jsonl": `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
      },
      extraTreePaths: [],
    };
    const report = extractKnowledgeNodes(await inspect(fixture));
    expect(report.nodes.map((record) => record.declaredId)).toEqual([
      "claim:primary-result",
      "claim:secondary",
    ]);
    expect(report.nodes.map((record) => record.sourcePointer)).toEqual(["line:1", "line:2"]);
    expect(report.nodes[1]?.fieldProvenance.id?.pointer).toBe("line:2.id");
  });

  it("rejects missing artifacts, duplicate ids, and edges to invalid nodes", async () => {
    const figure = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
    figure.id = "figure:missing";
    figure.kind = "figure";
    figure.provenance = { sourcePath: "nodes/nodes.jsonl", commitSha: NODE_COMMIT };
    figure.payload = { artifactPath: "figures/missing.png", caption: "Missing" };
    const duplicate = structuredClone(figure);
    const fixture: FakeRepoFixture = {
      ...nodePublicationFixture,
      files: {
        "node-manifest.json": JSON.stringify({
          schemaVersion: "1.0.0",
          nodes: { format: "jsonl", path: "nodes/nodes.jsonl" },
          edges: { format: "jsonl", path: "nodes/edges.jsonl" },
        }),
        "nodes/nodes.jsonl": `${JSON.stringify(figure)}\n${JSON.stringify(duplicate)}`,
        "nodes/edges.jsonl": JSON.stringify({
          sourceNodeId: "figure:missing",
          targetNodeId: "figure:missing",
          relationType: "derives-from",
          provenance: "asserted-by-author",
          status: "proposed",
        }),
      },
      extraTreePaths: [],
    };
    const report = extractKnowledgeNodes(await inspect(fixture));
    expect(report.nodes[0]?.issues.map((issue) => issue.code)).toContain("artifact-missing");
    expect(report.nodes[1]?.issues.map((issue) => issue.code)).toContain("duplicate-node-id");
    expect(report.edges[0]?.issues.map((issue) => issue.code)).toContain("edge-unknown-node");
  });

  it("is byte-for-byte deterministic for the same inspection report", async () => {
    const inspection = await inspect(nodePublicationFixture);
    expect(extractKnowledgeNodes(inspection)).toEqual(extractKnowledgeNodes(inspection));
  });

  it("normalizes repository URLs with adversarial trailing separators in linear time", async () => {
    const node = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
    node.provenance = {
      sourcePath: "nodes/url-normalization.json",
      commitSha: NODE_COMMIT,
      repositoryUrl: "https://GITHUB.COM/example-lab/node-publications.git" + "/".repeat(512),
    };
    const report = extractKnowledgeNodes(
      await inspect(singleJsonNodeFixture("nodes/url-normalization.json", node)),
    );

    expect(report.nodes[0]?.status).toBe("ok");
    expect(report.nodes[0]?.issues.map((issue) => issue.code)).not.toContain("repository-mismatch");
  });

  it("classifies a valid node-only repository as compatible", async () => {
    const extraction = runExtraction(await inspect(nodePublicationFixture), now);
    expect(extraction.compatibility.overallCompatibility).toBe("compatible");
    expect(extraction.compatibility.blockingErrors).toEqual([]);
    expect(extraction.compatibility.levelRationale.join(" ")).toContain(
      "valid first-class knowledge node",
    );
  });
});

function singleJsonNodeFixture(path: string, node: unknown): FakeRepoFixture {
  return {
    ...nodePublicationFixture,
    files: {
      "node-manifest.json": JSON.stringify({
        schemaVersion: "1.0.0",
        nodes: { format: "json", files: [path] },
      }),
      [path]: JSON.stringify(node),
    },
    extraTreePaths: [],
  };
}
