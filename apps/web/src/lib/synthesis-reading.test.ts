import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_PIPELINE_SOFTWARE_ID,
  SYNTHESIS_PIPELINE_SOFTWARE_NAME,
  SYNTHESIS_REVIEW_SCHEMA_VERSION,
  SYNTHESIS_SECTION_IDS,
  SYNTHESIS_SECTION_TITLES,
  publicSynthesisReviewSchema,
  type PublicSynthesisReview,
  type SubgraphEvidenceNode,
  type SubgraphEvidenceSource,
} from "@oratlas/contracts";
import {
  buildPreparedSubgraphEvidencePacket,
  fingerprintSubgraphEvidenceSelection,
} from "@oratlas/knowledge";
import type { PrismaClient } from "@oratlas/db";
import type { ExactPublicNodeVersionProjection } from "./node-publication";

vi.mock("server-only", () => ({}));

import { buildSynthesisJsonLd, loadSynthesisReadingContext } from "./synthesis-reading";
import { serializeJsonForHtml } from "./json-for-html";

const generatedAt = "2026-07-16T10:00:00.000Z";
const acceptedAt = "2026-07-16T11:00:00.000Z";
const promptHash = "a".repeat(64);
const documentHash = "b".repeat(64);

function packetNode(index: number): SubgraphEvidenceNode {
  const id = `node-${String(index).padStart(3, "0")}`;
  const commitSha = index.toString(16).padStart(40, "0");
  return {
    id,
    localNodeId: `local-${index}`,
    repository: {
      owner: "open",
      name: `evidence-${index}`,
      url: `https://github.com/open/evidence-${index}`,
    },
    versionId: `${id}-version`,
    snapshotId: `${id}-snapshot`,
    commitSha,
    title: `Exact claim node ${index}`,
    contributors: [],
    license: "CC-BY-4.0",
    provenance: {
      sourcePath: `nodes/${id}.json`,
      sourcePointer: `/nodes/${index}`,
      repositoryUrl: `https://github.com/open/evidence-${index}`,
      commitSha,
    },
    identifiers: [],
    isExample: false,
    createdAt: generatedAt,
    kind: "claim",
    payload: { statement: `Grounded claim ${index}.`, qualifiers: [] },
  };
}

function preparedPacket(nodeCount = 2) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => packetNode(index + 1));
  const selection = { kind: "seed" as const, nodeId: nodes[0]!.id, versionId: nodes[0]!.versionId };
  const edges: SubgraphEvidenceSource["edges"] =
    nodes.length === 2
      ? [
          {
            id: "edge-contradiction",
            sourceNodeId: nodes[0]!.id,
            sourceVersionId: nodes[0]!.versionId,
            targetNodeId: nodes[1]!.id,
            targetVersionId: nodes[1]!.versionId,
            relationType: "contradicts",
            status: "confirmed",
            provenance: "confirmed-by-editor",
            confirmedAt: acceptedAt,
          },
        ]
      : [];
  return buildPreparedSubgraphEvidencePacket({
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      contradictionEdgeIds: edges.map((edge) => edge.id),
    },
    nodes,
    edges,
  });
}

function synthesis(prepared = preparedPacket()): PublicSynthesisReview {
  const nodeReferences = prepared.packet.references.filter(
    (reference) => reference.kind === "node",
  );
  const citationDtos = nodeReferences.map((reference, index) => {
    const node = prepared.packet.nodes.find((candidate) => candidate.id === reference.nodeId)!;
    return {
      referenceId: reference.referenceId,
      nodeId: node.id,
      nodeVersionId: node.versionId,
      nodeKind: node.kind,
      title: node.title,
      href: `/nodes/${node.id}/versions/${node.versionId}`,
      location: `sections[3].paragraphs[0].citations[${index}]`,
      occurrenceOrdinal: index,
    };
  });
  const documentCitations = nodeReferences.slice(0, 50).map((reference) => ({
    referenceId: reference.referenceId,
    nodeId: reference.nodeId,
    nodeVersionId: reference.nodeVersionId,
  }));
  return publicSynthesisReviewSchema.parse({
    slug: "grounded-synthesis",
    reviewType: "ai-synthesis",
    title: "A grounded synthesis",
    abstract: "A bounded evidence summary.",
    document: {
      schemaVersion: SYNTHESIS_REVIEW_SCHEMA_VERSION,
      title: "A grounded synthesis",
      summary: "A bounded evidence summary.",
      citations: [],
      sections: SYNTHESIS_SECTION_IDS.map((id, index) => ({
        id,
        title: SYNTHESIS_SECTION_TITLES[index],
        paragraphs: [
          {
            text: `Grounded section ${index + 1}.`,
            citations: id === "contradictions-and-open-questions" ? documentCitations : [],
          },
        ],
      })),
    },
    provenance: {
      generationMode: "deterministic-template",
      pipelineSoftware: {
        id: SYNTHESIS_PIPELINE_SOFTWARE_ID,
        kind: "software-agent",
        displayName: SYNTHESIS_PIPELINE_SOFTWARE_NAME,
        pipelineVersion: "kg12-v1",
      },
      provider: "deterministic",
      model: "grounded-template",
      modelVersion: "1",
      promptVersion: "synthesis-prompt/1.0.0",
      promptHash,
      packetHash: prepared.sha256,
      documentHash,
      generatedAt,
      attributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
      materializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
      acceptedAt,
      approvingEditor: {
        displayName: "Accountable Editor",
        githubLogin: "editor",
        roleSnapshot: "EDITOR",
      },
      rightsStatement: "The editor confirms publication rights for this synthesis.",
      licenseSpdx: "CC-BY-4.0",
      checklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
      acceptedPredecessorVersionId: null,
      acceptedPredecessorOrdinal: null,
      ordinal: 1,
    },
    citations: citationDtos,
    version: {
      id: "synthesis-version-1",
      ordinal: 1,
      isCurrent: true,
      versionDoi: "10.5281/zenodo.1234567",
      conceptDoi: "10.5281/zenodo.1234500",
    },
    freshness: {
      status: "unchecked",
      policyVersion: "synthesis-staleness/1.0.0",
      reasonCodes: [],
      affectedReferenceCount: 0,
    },
  });
}

function acceptedClient(prepared = preparedPacket()) {
  const value = synthesis(prepared);
  const row = {
    id: "review-1",
    slug: value.slug,
    reviewType: "ai-synthesis",
    status: "published",
    currentSynthesisVersionId: value.version.id,
    currentSynthesisVersion: {
      id: value.version.id,
      reviewId: "review-1",
      recordSourceType: "synthesis",
      publicState: "published",
      isExample: false,
      synthesisDraftId: "draft-1",
      synthesisPacketHash: prepared.sha256,
      synthesisDocumentHash: documentHash,
      synthesisDraft: {
        id: "draft-1",
        reviewId: "review-1",
        status: "accepted",
        packetJson: prepared.json,
        packetHash: prepared.sha256,
        documentHash,
      },
    },
  };
  return {
    row,
    client: {
      review: { findFirst: vi.fn().mockResolvedValue(row) },
    } as unknown as PrismaClient,
  };
}

function exactProjection(prepared = preparedPacket()) {
  return new Map<string, ExactPublicNodeVersionProjection>(
    prepared.packet.nodes.map((node) => [
      `${node.id}\u0000${node.versionId}`,
      {
        id: node.id,
        localNodeId: node.localNodeId,
        kind: node.kind,
        repository: node.repository,
        version: {
          id: node.versionId,
          snapshotId: node.snapshotId,
          commitSha: node.commitSha,
          kind: node.kind,
          title: node.title,
          abstract: node.abstract,
          text: node.text,
          contributors: node.contributors,
          license: node.license,
          provenance: node.provenance,
          payload: node.payload,
          identifiers: node.identifiers,
          isExample: node.isExample,
          createdAt: node.createdAt,
        },
      } as ExactPublicNodeVersionProjection,
    ]),
  );
}

describe("synthesis reading projection", () => {
  it("binds public display context and disputes to the exact accepted packet", async () => {
    const prepared = preparedPacket();
    const { client } = acceptedClient(prepared);
    const loader = vi.fn().mockResolvedValue(exactProjection(prepared));
    const value = synthesis(prepared);
    const reading = await loadSynthesisReadingContext(value, client, loader);
    expect(loader).toHaveBeenCalledOnce();
    expect(loader.mock.calls[0]![0]).toHaveLength(2);
    const firstCitation = value.citations[0]!;
    const firstReference = firstCitation.referenceId;
    const packetNode = prepared.packet.nodes.find((node) => node.id === firstCitation.nodeId)!;
    const relatedNode = prepared.packet.nodes.find((node) => node.id !== firstCitation.nodeId)!;
    expect(reading?.citations.get(firstReference)).toMatchObject({
      nodeKind: "claim",
      provenance: {
        sourcePath: packetNode.provenance.sourcePath,
        sourcePointer: packetNode.provenance.sourcePointer,
      },
      disputes: [
        {
          relatedTitle: relatedNode.title,
          provenance: `confirmed-by-editor at ${acceptedAt}`,
        },
      ],
    });
    expect([...reading!.disputedReferenceIds]).toHaveLength(2);
    const serialized = JSON.stringify({
      citations: [...reading!.citations],
      disputedReferenceIds: [...reading!.disputedReferenceIds],
    });
    expect(serialized).not.toMatch(/draft|agentRun|packetJson|selector/i);
    expect(serialized).not.toContain(prepared.json);
  });

  it.each([
    [
      "invalid JSON",
      (row: ReturnType<typeof acceptedClient>["row"]) =>
        (row.currentSynthesisVersion.synthesisDraft.packetJson = "{"),
    ],
    [
      "wrong packet hash",
      (row: ReturnType<typeof acceptedClient>["row"]) =>
        (row.currentSynthesisVersion.synthesisPacketHash = "f".repeat(64)),
    ],
  ])("fails closed for %s", async (_name, corrupt) => {
    const prepared = preparedPacket();
    const value = synthesis(prepared);
    const { row, client } = acceptedClient(prepared);
    corrupt(row);
    const loader = vi.fn();
    expect(await loadSynthesisReadingContext(value, client, loader)).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("fails closed for valid but noncanonical packet bytes even when every hash agrees", async () => {
    const prepared = preparedPacket();
    const value = synthesis(prepared);
    const { row, client } = acceptedClient(prepared);
    const draft = row.currentSynthesisVersion.synthesisDraft;
    draft.packetJson = JSON.stringify(JSON.parse(draft.packetJson), null, 2);
    draft.packetHash = buildHash(draft.packetJson);
    row.currentSynthesisVersion.synthesisPacketHash = draft.packetHash;
    value.provenance.packetHash = draft.packetHash;
    const loader = vi.fn();
    expect(await loadSynthesisReadingContext(value, client, loader)).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it.each([
    [
      "repository",
      (projection: ExactPublicNodeVersionProjection) => (projection.repository.name = "other"),
    ],
    [
      "commit",
      (projection: ExactPublicNodeVersionProjection) =>
        (projection.version.commitSha = "f".repeat(40)),
    ],
    [
      "provenance",
      (projection: ExactPublicNodeVersionProjection) =>
        (projection.version.provenance.sourcePath = "other.json"),
    ],
    [
      "license",
      (projection: ExactPublicNodeVersionProjection) => (projection.version.license = "MIT"),
    ],
    ["kind", (projection: ExactPublicNodeVersionProjection) => (projection.kind = "code")],
    [
      "title",
      (projection: ExactPublicNodeVersionProjection) => (projection.version.title = "Other"),
    ],
    [
      "payload",
      (projection: ExactPublicNodeVersionProjection) =>
        (projection.version.payload = { statement: "Drifted public content.", qualifiers: [] }),
    ],
    [
      "identifiers",
      (projection: ExactPublicNodeVersionProjection) =>
        (projection.version.identifiers = [
          {
            scheme: "doi",
            role: "version-doi",
            value: "10.5281/zenodo.9999999",
            isExample: false,
          },
        ]),
    ],
    [
      "example flag",
      (projection: ExactPublicNodeVersionProjection) => (projection.version.isExample = true),
    ],
  ])("fails closed for a packet/public %s mismatch", async (_name, corrupt) => {
    const prepared = preparedPacket();
    const value = synthesis(prepared);
    const { client } = acceptedClient(prepared);
    const projected = exactProjection(prepared);
    corrupt(projected.values().next().value!);
    expect(
      await loadSynthesisReadingContext(value, client, vi.fn().mockResolvedValue(projected)),
    ).toBeNull();
  });

  it("fails closed when repeated occurrences disagree about reference ownership", async () => {
    const prepared = preparedPacket();
    const value = synthesis(prepared);
    value.citations.push({ ...value.citations[0]!, nodeVersionId: "forged-version" });
    const { client } = acceptedClient(prepared);
    const loader = vi.fn();
    expect(await loadSynthesisReadingContext(value, client, loader)).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads the packet maximum of 100 exact nodes in one bounded batch call", async () => {
    const prepared = preparedPacket(100);
    const value = synthesis(prepared);
    const { client } = acceptedClient(prepared);
    const loader = vi.fn().mockResolvedValue(exactProjection(prepared));
    const reading = await loadSynthesisReadingContext(value, client, loader);
    expect(reading?.citations.size).toBe(100);
    expect(loader).toHaveBeenCalledOnce();
    expect(loader.mock.calls[0]![0]).toHaveLength(100);
  });

  it("maps software authorship and editor accountability into ScholarlyArticle JSON-LD", () => {
    const jsonLd = buildSynthesisJsonLd(synthesis());
    expect(jsonLd).toMatchObject({
      "@type": "ScholarlyArticle",
      author: { "@type": "SoftwareApplication", "@id": SYNTHESIS_PIPELINE_SOFTWARE_ID },
      editor: {
        "@type": "Person",
        name: "Accountable Editor",
        sameAs: "https://github.com/editor",
      },
      dateCreated: generatedAt,
      identifier: "https://doi.org/10.5281/zenodo.1234567",
    });
    expect(JSON.stringify(jsonLd)).not.toMatch(/promptHash|packetHash|githubLogin|roleSnapshot/);
  });

  it("remains safe when hostile stored prose reaches the JSON-LD serializer", () => {
    const value = synthesis();
    value.title = "Evidence </script><script>alert(1)</script>";
    const serialized = serializeJsonForHtml(buildSynthesisJsonLd(value));
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
  });
});

function buildHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
