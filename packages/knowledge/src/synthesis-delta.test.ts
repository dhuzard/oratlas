import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  SUBGRAPH_EVIDENCE_LIMITS,
  type SubgraphEvidenceEdge,
  type SubgraphEvidenceNode,
  type SubgraphEvidenceSource,
  type SynthesisReviewDocument,
} from "@oratlas/contracts";
import {
  buildPreparedSubgraphEvidencePacket,
  fingerprintSubgraphEvidenceSelection,
} from "./subgraph-evidence.js";
import {
  compareSynthesisGenerations,
  prepareSynthesisGenerationSnapshot,
  verifySynthesisGenerationDelta,
  SynthesisGenerationDeltaError,
  SYNTHESIS_GENERATION_DELTA_LIMITS,
  type SynthesisGenerationSnapshot,
} from "./synthesis-delta.js";
import { sha256 } from "./synthesis-writer.js";

const sectionDefinitions = [
  ["background", "Background"],
  ["state-of-knowledge", "State of knowledge"],
  ["agreements", "Agreements"],
  ["contradictions-and-open-questions", "Contradictions and open questions"],
  ["data-and-code-availability", "Data and code availability"],
  ["limitations", "Limitations"],
] as const;

function document(background = "Background evidence remains stable."): SynthesisReviewDocument {
  return {
    schemaVersion: "1.0.0",
    title: "Bounded synthesis",
    summary: "A deterministic review of the bounded evidence.",
    citations: [],
    sections: sectionDefinitions.map(([id, title]) => ({
      id,
      title,
      paragraphs: [
        {
          text: id === "background" ? background : `The ${title.toLowerCase()} section is bounded.`,
          citations: [],
        },
      ],
    })) as unknown as SynthesisReviewDocument["sections"],
  };
}

function node(id: string, versionId = `${id}-v1`): SubgraphEvidenceNode {
  const commitSha = sha256(versionId).slice(0, 40);
  return {
    id,
    localNodeId: id,
    repository: {
      owner: "atlas-lab",
      name: `repo-${id}`,
      url: `https://github.com/atlas-lab/repo-${id}`,
    },
    versionId,
    snapshotId: `snapshot-${versionId}`,
    commitSha,
    title: `Claim ${id}`,
    contributors: [{ displayName: "Atlas Author" }],
    license: "CC-BY-4.0",
    provenance: {
      sourcePath: `knowledge/${id}.json`,
      repositoryUrl: `https://github.com/atlas-lab/repo-${id}`,
      commitSha,
    },
    identifiers: [],
    isExample: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "claim" as const,
    payload: { statement: `Claim ${id} is bounded.`, qualifiers: [] },
  };
}

function dataset(id: string, versionId = `${id}-v1`): SubgraphEvidenceNode {
  const commitSha = sha256(versionId).slice(0, 40);
  return {
    id,
    localNodeId: id,
    repository: {
      owner: "atlas-lab",
      name: `repo-${id}`,
      url: `https://github.com/atlas-lab/repo-${id}`,
    },
    versionId,
    snapshotId: `snapshot-${versionId}`,
    commitSha,
    title: `Dataset ${id}`,
    contributors: [{ displayName: "Atlas Author" }],
    license: "CC0-1.0",
    provenance: {
      sourcePath: `knowledge/${id}.json`,
      repositoryUrl: `https://github.com/atlas-lab/repo-${id}`,
      commitSha,
    },
    identifiers: [],
    isExample: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "dataset",
    payload: { artifactPath: `data/${id}.csv`, format: "text/csv", sizeBytes: 10 },
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  sourceVersionId: string,
  targetNodeId: string,
  targetVersionId: string,
  relationType: SubgraphEvidenceEdge["relationType"] = "supports",
): SubgraphEvidenceEdge {
  return {
    id,
    sourceNodeId,
    sourceVersionId,
    targetNodeId,
    targetVersionId,
    relationType,
    status: "confirmed",
    provenance: "confirmed-by-editor",
    confirmedAt: "2026-02-01T00:00:00.000Z",
  };
}

function source(
  nodes: SubgraphEvidenceNode[],
  edges: SubgraphEvidenceEdge[],
): SubgraphEvidenceSource {
  const selection = {
    kind: "topic" as const,
    canonicalQuery: "bounded synthesis",
    seedNodeIds: [[...nodes].map((candidate) => candidate.id).sort()[0]!],
  };
  return {
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      contradictionEdgeIds: edges
        .filter((candidate) => candidate.relationType === "contradicts")
        .map((candidate) => candidate.id),
    },
    nodes,
    edges,
  };
}

function snapshot(
  nodes: SubgraphEvidenceNode[],
  edges: SubgraphEvidenceEdge[],
  review = document(),
): SynthesisGenerationSnapshot {
  return prepareSynthesisGenerationSnapshot(
    buildPreparedSubgraphEvidencePacket(source(nodes, edges)),
    review,
  );
}

function rehash(
  original: SynthesisGenerationSnapshot,
  overrides: Partial<Pick<SynthesisGenerationSnapshot, "packet" | "document">>,
): SynthesisGenerationSnapshot {
  const packet = overrides.packet ?? original.packet;
  const review = overrides.document ?? original.document;
  const packetJson = canonicalJson(packet);
  const documentJson = canonicalJson(review);
  return {
    packet,
    packetJson,
    packetHash: sha256(packetJson),
    document: review,
    documentJson,
    documentHash: sha256(documentJson),
  };
}

function expectCode(operation: () => unknown, code: SynthesisGenerationDeltaError["code"]): void {
  try {
    operation();
    throw new Error("Expected operation to reject.");
  } catch (error) {
    expect(error).toBeInstanceOf(SynthesisGenerationDeltaError);
    expect((error as SynthesisGenerationDeltaError).code).toBe(code);
  }
}

describe("synthesis generation delta", () => {
  it("reports exact nodes, confirmed edges, contradictions, and secondary section text", () => {
    const previous = snapshot(
      [node("node-a"), node("node-b"), node("node-x")],
      [
        edge("edge-stable", "node-a", "node-a-v1", "node-x", "node-x-v1"),
        edge("edge-removed", "node-b", "node-b-v1", "node-x", "node-x-v1"),
        edge("contradiction-old", "node-a", "node-a-v1", "node-b", "node-b-v1", "contradicts"),
      ],
    );
    const changedStable = {
      ...edge("edge-stable", "node-a", "node-a-v2", "node-x", "node-x-v1"),
      confirmedAt: "2026-03-01T00:00:00.000Z",
    };
    const current = snapshot(
      [node("node-c"), node("node-x"), node("node-a", "node-a-v2")],
      [
        changedStable,
        edge("edge-added", "node-c", "node-c-v1", "node-x", "node-x-v1"),
        edge("contradiction-new", "node-c", "node-c-v1", "node-x", "node-x-v1", "contradicts"),
      ],
      document("Background evidence changed in the current generation."),
    );

    const delta = compareSynthesisGenerations(previous, current);
    expect(delta.nodes.added.map((entry) => entry.nodeId)).toEqual(["node-c"]);
    expect(delta.nodes.removed.map((entry) => entry.nodeId)).toEqual(["node-b"]);
    expect(delta.nodes.reassessed).toEqual([
      {
        nodeId: "node-a",
        previous: expect.objectContaining({ nodeVersionId: "node-a-v1" }),
        current: expect.objectContaining({ nodeVersionId: "node-a-v2" }),
      },
    ]);
    expect(delta.confirmedEdges.added.map((entry) => entry.edgeId)).toEqual([
      "contradiction-new",
      "edge-added",
    ]);
    expect(delta.confirmedEdges.removed.map((entry) => entry.edgeId)).toEqual([
      "contradiction-old",
      "edge-removed",
    ]);
    expect(delta.confirmedEdges.changed).toEqual([
      expect.objectContaining({
        edgeId: "edge-stable",
        changedFields: ["binding", "confirmation-metadata"],
      }),
    ]);
    expect(delta.contradictions.opened[0]).toEqual(
      expect.objectContaining({ edgeIds: ["contradiction-new"] }),
    );
    expect(delta.contradictions.resolved[0]).toEqual(
      expect.objectContaining({ edgeIds: ["contradiction-old"] }),
    );
    expect(delta.sectionText).toEqual([
      {
        sectionId: "background",
        title: "Background",
        paragraphChanges: [
          {
            paragraphIndex: 0,
            previousText: "Background evidence remains stable.",
            currentText: "Background evidence changed in the current generation.",
          },
        ],
      },
    ]);
    expect(delta.isNoop).toBe(false);
    expect(verifySynthesisGenerationDelta(delta)).toBe(true);
  });

  it("returns a checksummed no-op and detects checksum tampering", () => {
    const generation = snapshot([node("node-a")], []);
    const delta = compareSynthesisGenerations(generation, generation);
    expect(delta).toMatchObject({
      nodes: { added: [], removed: [], reassessed: [] },
      confirmedEdges: { added: [], removed: [], changed: [] },
      contradictions: { opened: [], resolved: [] },
      sectionText: [],
      isNoop: true,
    });
    expect(delta.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySynthesisGenerationDelta(delta)).toBe(true);
    expect(verifySynthesisGenerationDelta({ ...delta, isNoop: false })).toBe(false);
  });

  it("is deterministic for permuted source inputs and has a stable canonical checksum", () => {
    const nodes = [node("node-b"), node("node-a")];
    const edges = [edge("edge-a", "node-a", "node-a-v1", "node-b", "node-b-v1")];
    const first = snapshot(nodes, edges);
    const second = snapshot([...nodes].reverse(), [...edges].reverse());
    const firstDelta = compareSynthesisGenerations(first, second);
    const secondDelta = compareSynthesisGenerations(second, first);
    expect(canonicalJson(firstDelta)).toBe(canonicalJson(secondDelta));
    expect(firstDelta.checksum).toBe(
      "d67615a7b5fa3009263373ee514c19da1da4aae6b8f263b45b1078800bc92bfc",
    );
  });

  it("classifies a TRUST-only confirmed-edge reassessment", () => {
    const base = edge(
      "edge-trust",
      "node-a",
      "node-a-v1",
      "node-data",
      "node-data-v1",
      "uses-dataset",
    );
    const trust = (assessmentId: string): NonNullable<SubgraphEvidenceEdge["trust"]> => ({
      subject: {
        sourceNodeId: base.sourceNodeId,
        sourceVersionId: base.sourceVersionId,
        targetNodeId: base.targetNodeId,
        targetVersionId: base.targetVersionId,
        relationType: base.relationType,
      },
      assessmentId,
      protocolVersion: "trust/1.0.0",
      reviewStatus: "human-reviewed",
      verificationState: "platform-verified",
      criteria: [{ criterion: "identityIntegrity", rating: "high", status: "assessed" }],
    });
    const nodes = [node("node-a"), dataset("node-data")];
    const previous = snapshot(nodes, [{ ...base, trust: trust("assessment-1") }]);
    const current = snapshot(nodes, [{ ...base, trust: trust("assessment-2") }]);
    const delta = compareSynthesisGenerations(previous, current);
    expect(delta.confirmedEdges.changed).toEqual([
      expect.objectContaining({ edgeId: "edge-trust", changedFields: ["trust"] }),
    ]);
    expect(delta.confirmedEdges.added).toEqual([]);
    expect(delta.confirmedEdges.removed).toEqual([]);
  });

  it("fails closed on forged references and ambiguous exact edges", () => {
    const generation = snapshot(
      [node("node-a"), node("node-b")],
      [edge("edge-a", "node-a", "node-a-v1", "node-b", "node-b-v1")],
    );
    const forgedPacket = structuredClone(generation.packet);
    const nodeReference = forgedPacket.references.find((reference) => reference.kind === "node")!;
    nodeReference.referenceId = `reference:sha256:${"f".repeat(64)}`;
    forgedPacket.references.sort((left, right) =>
      left.referenceId.localeCompare(right.referenceId),
    );
    expectCode(
      () => compareSynthesisGenerations(rehash(generation, { packet: forgedPacket }), generation),
      "ambiguous-reference",
    );

    const duplicateEdgePacket = structuredClone(generation.packet);
    duplicateEdgePacket.edges.push({ ...duplicateEdgePacket.edges[0]!, id: "edge-a-copy" });
    duplicateEdgePacket.edges.sort((left, right) =>
      [
        left.sourceNodeId,
        left.sourceVersionId,
        left.relationType,
        left.targetNodeId,
        left.targetVersionId,
        left.id,
      ]
        .join("\u0000")
        .localeCompare(
          [
            right.sourceNodeId,
            right.sourceVersionId,
            right.relationType,
            right.targetNodeId,
            right.targetVersionId,
            right.id,
          ].join("\u0000"),
        ),
    );
    expectCode(
      () =>
        compareSynthesisGenerations(
          rehash(generation, { packet: duplicateEdgePacket }),
          generation,
        ),
      "ambiguous-edge",
    );
  });

  it("rejects malformed reviews, tampered evidence, hashes, and over-bound packets", () => {
    const generation = snapshot([node("node-a")], []);
    const malformed = structuredClone(generation) as unknown as Record<string, unknown>;
    (malformed.document as Record<string, unknown>).title = "";
    expectCode(() => compareSynthesisGenerations(malformed, generation), "invalid-snapshot");

    const tampered = structuredClone(generation);
    tampered.packet.nodes[0]!.title = "Tampered title";
    expectCode(() => compareSynthesisGenerations(tampered, generation), "integrity-mismatch");
    expectCode(
      () => compareSynthesisGenerations({ ...generation, packetHash: "0".repeat(64) }, generation),
      "integrity-mismatch",
    );

    const overBound = structuredClone(generation);
    overBound.packet.nodes = Array.from(
      { length: SUBGRAPH_EVIDENCE_LIMITS.maxNodes + 1 },
      () => overBound.packet.nodes[0]!,
    );
    expectCode(() => compareSynthesisGenerations(overBound, generation), "invalid-snapshot");
    expect(SYNTHESIS_GENERATION_DELTA_LIMITS.maxNodeChanges).toBe(
      SUBGRAPH_EVIDENCE_LIMITS.maxNodes * 2,
    );
  });
});
