import { describe, expect, it } from "vitest";
import {
  inspectionReportSchema,
  type InspectionReport,
  type ReviewManifest,
} from "@oratlas/contracts";
import { extractKnowledgeWithOutcomes } from "./knowledge.js";

function report(contents: Record<string, string>, extraTree: string[] = []): InspectionReport {
  const paths = [...new Set([...Object.keys(contents), ...extraTree])];
  return inspectionReportSchema.parse({
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: "example",
      name: "review",
      canonicalUrl: "https://github.com/example/review",
    },
    inspectedAt: "2026-07-20T00:00:00.000Z",
    status: "succeeded",
    tree: paths.map((path) => ({ path, size: contents[path]?.length ?? 10 })),
    files: Object.fromEntries(
      Object.entries(contents).map(([path, content]) => [
        path,
        { path, size: content.length, content, truncated: false },
      ]),
    ),
    limits: {
      maxFileBytes: 1_000_000,
      maxTotalBytes: 10_000_000,
      maxFileCount: 100,
      totalBytesFetched: 0,
      filesFetched: Object.keys(contents).length,
    },
  });
}

function manifest(artifacts: ReviewManifest["artifacts"]): ReviewManifest {
  return {
    schemaVersion: "1.0.0",
    review: { title: "Review" },
    repository: { url: "https://github.com/example/review" },
    artifacts,
  };
}

describe("extractKnowledgeWithOutcomes", () => {
  it("does not fall back when a declared path is missing", () => {
    const result = extractKnowledgeWithOutcomes(
      report({
        "fallback-claims.jsonl": JSON.stringify({ id: "wrong", text: "Must not load." }),
      }),
      manifest({ claims: "declared-claims.jsonl" }),
    );
    expect(result.knowledge.claims).toEqual([]);
    expect(result.artifactOutcomes.claims).toMatchObject({
      status: "skipped",
      loadedCount: 0,
      skippedCount: null,
      sources: [{ path: "declared-claims.jsonl", discovery: "declared" }],
    });
  });

  it("counts parse failures and referential drops after final ingestion", () => {
    const result = extractKnowledgeWithOutcomes(
      report({
        "claims.jsonl": JSON.stringify({ id: "c1", text: "Claim" }),
        "citations.jsonl": JSON.stringify({ id: "r1", title: "Reference" }),
        "relations.jsonl": [
          JSON.stringify({ claimId: "c1", citationId: "r1", relationType: "supports" }),
          JSON.stringify({ claimId: "missing", citationId: "r1", relationType: "supports" }),
          "not-json",
        ].join("\n"),
      }),
      manifest({
        claims: "claims.jsonl",
        citations: "citations.jsonl",
        relations: "relations.jsonl",
      }),
    );
    expect(result.knowledge.relations).toHaveLength(1);
    expect(result.artifactOutcomes.relations).toMatchObject({
      status: "loaded",
      loadedCount: 1,
      skippedCount: 2,
    });
  });

  it("aggregates mixed TRUST sources without hiding a failed source", () => {
    const validTrust = JSON.stringify({
      claimId: "c1",
      citationId: "r1",
      protocolVersion: "trust-1.0",
      assessorType: "agent",
      criteria: {},
    });
    const result = extractKnowledgeWithOutcomes(
      report({
        "claims.jsonl": JSON.stringify({ id: "c1", text: "Claim" }),
        "citations.jsonl": JSON.stringify({ id: "r1", title: "Reference" }),
        "node-manifest.json": JSON.stringify({
          schemaVersion: "1.0.0",
          nodes: { format: "jsonl", path: "nodes.jsonl" },
          trustAssessments: { format: "jsonl", path: "node-trust.jsonl" },
        }),
        "node-trust.jsonl": validTrust,
        "review-trust.jsonl": "not-json",
      }),
      manifest({
        claims: "claims.jsonl",
        citations: "citations.jsonl",
        trustAssessments: "review-trust.jsonl",
      }),
    );
    expect(result.knowledge.trust).toHaveLength(1);
    expect(result.artifactOutcomes.trust).toMatchObject({
      status: "loaded",
      loadedCount: 1,
      skippedCount: 1,
    });
    expect(result.artifactOutcomes.trust.sources.map((source) => source.status)).toEqual([
      "loaded",
      "invalid",
    ]);
  });
});
