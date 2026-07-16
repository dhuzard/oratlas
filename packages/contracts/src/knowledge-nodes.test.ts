import { describe, expect, it } from "vitest";
import {
  knowledgeNodeSchema,
  repositoryNodeEdgeDeclarationSchema,
  nodeEdgeSchema,
  validateNodeManifest,
  type KnowledgeNode,
} from "./knowledge-nodes.js";

const sharedEnvelope = {
  title: "Reference node",
  abstract: "A bounded description of the publication object.",
  contributors: [{ displayName: "Ada Researcher", orcid: "0000-0002-1825-0097" }],
  license: "CC-BY-4.0",
  provenance: {
    sourcePath: "nodes/reference.json",
    repositoryUrl: "https://github.com/example/lab-notebook",
    commitSha: "a".repeat(40),
  },
  versionDoi: "10.5281/zenodo.1234567",
  conceptDoi: "10.5281/zenodo.1234566",
};

const validNodes: KnowledgeNode[] = [
  {
    ...sharedEnvelope,
    id: "claim:primary-result",
    kind: "claim",
    payload: {
      statement: "The intervention changed the measured outcome.",
      qualifiers: ["In the declared study population"],
    },
  },
  {
    ...sharedEnvelope,
    id: "figure:main",
    kind: "figure",
    payload: {
      artifactPath: "figures/main-result.png",
      caption: "Measured outcome by experimental condition.",
      altText: "A point plot comparing two experimental conditions.",
    },
  },
  {
    ...sharedEnvelope,
    id: "dataset:observations",
    kind: "dataset",
    payload: {
      artifactPath: "data/observations.csv",
      format: "text/csv",
      sizeBytes: 42_000,
      doi: "10.5281/zenodo.1234500",
    },
  },
  {
    ...sharedEnvelope,
    id: "code:analysis",
    kind: "code",
    payload: {
      entryPoints: ["src/analyse.py", "notebooks/reproduce.ipynb"],
      language: "Python",
      releaseRef: "v1.0.0",
    },
  },
];

describe("knowledgeNodeSchema", () => {
  it("accepts all four node kinds and preserves the DOI fields independently", () => {
    for (const node of validNodes) {
      const parsed = knowledgeNodeSchema.parse(node);
      expect(parsed.kind).toBe(node.kind);
      expect(parsed.versionDoi).toBe("10.5281/zenodo.1234567");
      expect(parsed.conceptDoi).toBe("10.5281/zenodo.1234566");
    }
  });

  it("rejects a kind-specific payload from a different node kind", () => {
    const invalid = {
      ...validNodes[0],
      payload: { artifactPath: "figures/main.png", caption: "Wrong payload" },
    };
    expect(knowledgeNodeSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects unsafe artifact and entry-point paths", () => {
    const unsafeFigure = structuredClone(validNodes[1]!);
    if (unsafeFigure.kind !== "figure") throw new Error("Expected fixture to be a figure");
    unsafeFigure.payload.artifactPath = "../../private.png";
    expect(knowledgeNodeSchema.safeParse(unsafeFigure).success).toBe(false);

    const unsafeCode = structuredClone(validNodes[3]!);
    if (unsafeCode.kind !== "code") throw new Error("Expected fixture to be code");
    unsafeCode.payload.entryPoints = ["https://evil.example/run.js"];
    expect(knowledgeNodeSchema.safeParse(unsafeCode).success).toBe(false);

    const unsafeDataset = structuredClone(validNodes[2]!);
    if (unsafeDataset.kind !== "dataset") throw new Error("Expected fixture to be a dataset");
    unsafeDataset.payload.artifactPath = "../private.csv";
    expect(knowledgeNodeSchema.safeParse(unsafeDataset).success).toBe(false);
  });

  it("requires a repository artifact or DOI for datasets", () => {
    const unlocatable = structuredClone(validNodes[2]!);
    if (unlocatable.kind !== "dataset") throw new Error("Expected fixture to be a dataset");
    delete unlocatable.payload.artifactPath;
    delete unlocatable.payload.doi;
    delete unlocatable.versionDoi;
    delete unlocatable.conceptDoi;

    const parsed = knowledgeNodeSchema.safeParse(unlocatable);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["payload", "artifactPath"]);
    }
  });

  it("rejects conflated version and concept DOIs", () => {
    const invalid = { ...validNodes[0], conceptDoi: validNodes[0]?.versionDoi };
    const parsed = knowledgeNodeSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["conceptDoi"]);
    }
  });

  it("rejects prefixed DOIs and unbounded content", () => {
    const prefixed = {
      ...validNodes[2],
      versionDoi: "https://doi.org/10.5281/zenodo.1234567",
    };
    expect(knowledgeNodeSchema.safeParse(prefixed).success).toBe(false);

    const oversized = { ...validNodes[0], text: "x".repeat(100_001) };
    expect(knowledgeNodeSchema.safeParse(oversized).success).toBe(false);
  });
});

describe("nodeEdgeSchema", () => {
  it("normalizes legacy repository lifecycle claims to a declaration", () => {
    expect(
      repositoryNodeEdgeDeclarationSchema.parse({
        sourceNodeId: "claim:primary-result",
        targetNodeId: "dataset:observations",
        relationType: "uses-dataset",
        provenance: "confirmed-by-editor",
        status: "confirmed",
        rationale: "A repository cannot confer editorial authority.",
      }),
    ).toEqual({
      sourceNodeId: "claim:primary-result",
      targetNodeId: "dataset:observations",
      relationType: "uses-dataset",
      rationale: "A repository cannot confer editorial authority.",
    });
  });

  it("accepts an exact immutable cross-lab target address", () => {
    expect(
      repositoryNodeEdgeDeclarationSchema.parse({
        sourceNodeId: "claim:primary-result",
        targetNodeId: "claim:replication",
        targetRepository: {
          githubRepositoryId: "987654321",
          commitSha: "b".repeat(40),
        },
        relationType: "contradicts",
      }),
    ).toMatchObject({ targetRepository: { githubRepositoryId: "987654321" } });
    expect(
      repositoryNodeEdgeDeclarationSchema.safeParse({
        sourceNodeId: "claim:primary-result",
        targetNodeId: "claim:replication",
        targetRepository: { githubRepositoryId: "mutable-name", commitSha: "b".repeat(40) },
        relationType: "contradicts",
      }).success,
    ).toBe(false);
  });

  it("accepts every relation type in the public contract", () => {
    const relationTypes = [
      "supports",
      "contradicts",
      "replicates",
      "extends",
      "uses-dataset",
      "uses-code",
      "derives-from",
    ] as const;
    for (const relationType of relationTypes) {
      expect(
        nodeEdgeSchema.safeParse({
          sourceNodeId: "claim:primary-result",
          targetNodeId: "dataset:observations",
          relationType,
          provenance: "asserted-by-author",
          status: "proposed",
        }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown lifecycle and provenance values", () => {
    const base = {
      sourceNodeId: "claim:primary-result",
      targetNodeId: "dataset:observations",
      relationType: "uses-dataset",
      provenance: "asserted-by-author",
      status: "confirmed",
    };
    expect(nodeEdgeSchema.safeParse({ ...base, status: "published" }).success).toBe(false);
    expect(nodeEdgeSchema.safeParse({ ...base, provenance: "unknown" }).success).toBe(false);
  });
});

describe("validateNodeManifest", () => {
  it("accepts both supported declaration modes", () => {
    const files = validateNodeManifest({
      schemaVersion: "1.0.0",
      nodes: { format: "json", files: ["nodes/claim.json", "nodes/figure.json"] },
      edges: { format: "jsonl", path: "nodes/edges.jsonl" },
    });
    expect(files.ok).toBe(true);
    expect(files.errors).toEqual([]);

    expect(
      validateNodeManifest({
        schemaVersion: "1.0.0",
        nodes: { format: "jsonl", path: "nodes.jsonl" },
      }).ok,
    ).toBe(true);
  });

  it("rejects traversal, schemes, duplicate files, and ambiguous source shapes", () => {
    const badManifests = [
      {
        schemaVersion: "1.0.0",
        nodes: { format: "jsonl", path: "../nodes.jsonl" },
      },
      {
        schemaVersion: "1.0.0",
        nodes: { format: "jsonl", path: "https://evil.example/nodes.jsonl" },
      },
      {
        schemaVersion: "1.0.0",
        nodes: { format: "json", files: ["nodes/claim.json", "nodes/claim.json"] },
      },
      {
        schemaVersion: "1.0.0",
        nodes: { format: "jsonl", path: "nodes.jsonl", files: ["nodes/claim.json"] },
      },
    ];
    for (const manifest of badManifests) {
      expect(validateNodeManifest(manifest).ok).toBe(false);
    }
  });
});
