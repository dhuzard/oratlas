import { beforeEach, describe, expect, it, vi } from "vitest";
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
  type PublicNodeDetail,
} from "@oratlas/contracts";

vi.mock("server-only", () => ({}));
const { getPublicNode } = vi.hoisted(() => ({ getPublicNode: vi.fn() }));
vi.mock("./node-publication", () => ({ getPublicNode }));

import { buildSynthesisJsonLd, loadSynthesisReadingContext } from "./synthesis-reading";
import { serializeJsonForHtml } from "./json-for-html";

const hash = "a".repeat(64);
const referenceId = `reference:sha256:${hash}`;

function synthesis() {
  const citation = { referenceId, nodeId: "node-1", nodeVersionId: "node-version-1" };
  return publicSynthesisReviewSchema.parse({
    slug: "grounded-synthesis",
    reviewType: "ai-synthesis",
    title: "A grounded synthesis",
    abstract: "A bounded evidence summary.",
    document: {
      schemaVersion: SYNTHESIS_REVIEW_SCHEMA_VERSION,
      title: "A grounded synthesis",
      summary: "A bounded evidence summary.",
      citations: [citation],
      sections: SYNTHESIS_SECTION_IDS.map((id, index) => ({
        id,
        title: SYNTHESIS_SECTION_TITLES[index],
        paragraphs: [{ text: `Grounded section ${index + 1}.`, citations: [citation] }],
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
      promptHash: hash,
      packetHash: hash,
      documentHash: hash,
      generatedAt: "2026-07-16T10:00:00.000Z",
      attributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
      materializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
      acceptedAt: "2026-07-16T11:00:00.000Z",
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
    citations: [
      {
        ...citation,
        nodeKind: "claim",
        title: "Exact claim node",
        href: "/nodes/node-1/versions/node-version-1",
        location: "sections[3].paragraphs[0]",
        occurrenceOrdinal: 0,
      },
    ],
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

function publicNode(): PublicNodeDetail {
  return {
    id: "node-1",
    kind: "claim",
    version: {
      id: "node-version-1",
      title: "Exact claim node",
      commitSha: "b".repeat(40),
      license: "CC-BY-4.0",
      provenance: { sourcePath: "atlas.manifest.json", sourcePointer: "/nodes/0" },
    },
    repository: { owner: "open", name: "evidence", url: "https://github.com/open/evidence" },
    trustContext: [
      {
        relationType: "supports",
        trust: {
          reviewStatus: "human-reviewed",
          verificationState: "platform-verified",
        },
      },
      {
        relationType: "supports",
        trust: {
          reviewStatus: "human-reviewed",
          verificationState: "platform-verified",
        },
      },
    ],
    edges: [
      {
        relationType: "contradicts",
        provenance: "asserted-by-author",
        relatedNode: {
          id: "node-2",
          versionId: "node-version-2",
          title: "Opposing claim",
        },
      },
    ],
  } as unknown as PublicNodeDetail;
}

describe("synthesis reading projection", () => {
  beforeEach(() => getPublicNode.mockReset());

  it("projects public provenance and relation-scoped TRUST without private draft data", async () => {
    getPublicNode.mockResolvedValue(publicNode());
    const reading = await loadSynthesisReadingContext(synthesis());
    expect(getPublicNode).toHaveBeenCalledWith("node-1", "node-version-1");
    expect(reading?.citations.get(referenceId)).toMatchObject({
      nodeKind: "claim",
      provenance: { sourcePath: "atlas.manifest.json", sourcePointer: "/nodes/0" },
      trust: [
        {
          subject: "claim–citation supports",
          reviewStatus: "human-reviewed",
          verificationState: "platform-verified",
        },
      ],
    });
    expect(
      JSON.stringify({
        citations: [...reading!.citations],
        disputedReferenceIds: [...reading!.disputedReferenceIds],
      }),
    ).not.toMatch(/draft|agentRun|packetJson|selector/i);
  });

  it("deduplicates deterministic TRUST summaries and marks cited contradiction pairs", async () => {
    const value = synthesis();
    const opposingReferenceId = `reference:sha256:${"c".repeat(64)}`;
    value.citations.push({
      ...value.citations[0]!,
      referenceId: opposingReferenceId,
      nodeId: "node-2",
      nodeVersionId: "node-version-2",
      title: "Opposing claim",
      href: "/nodes/node-2/versions/node-version-2",
      occurrenceOrdinal: 1,
    });
    getPublicNode.mockImplementation((id: string) => {
      if (id === "node-1") return publicNode();
      return {
        ...publicNode(),
        id: "node-2",
        version: { ...publicNode().version, id: "node-version-2", title: "Opposing claim" },
        edges: [
          {
            relationType: "contradicts",
            provenance: "asserted-by-author",
            relatedNode: {
              id: "node-1",
              versionId: "node-version-1",
              title: "Exact claim node",
            },
          },
        ],
      };
    });
    const reading = await loadSynthesisReadingContext(value);
    expect(reading?.citations.get(referenceId)?.trust).toHaveLength(1);
    expect([...reading!.disputedReferenceIds]).toEqual([referenceId, opposingReferenceId]);
  });

  it("fails closed when an exact public node projection does not match the accepted citation", async () => {
    getPublicNode.mockResolvedValue({ ...publicNode(), kind: "dataset" });
    expect(await loadSynthesisReadingContext(synthesis())).toBeNull();
  });

  it("fails closed when repeated occurrences disagree about reference ownership", async () => {
    const value = synthesis();
    value.citations.push({ ...value.citations[0]!, nodeVersionId: "forged-version" });
    expect(await loadSynthesisReadingContext(value)).toBeNull();
    expect(getPublicNode).not.toHaveBeenCalled();
  });

  it("bounds work before loading public citation nodes", async () => {
    const value = synthesis();
    value.citations = Array.from({ length: 2_001 }, () => value.citations[0]!);
    expect(await loadSynthesisReadingContext(value)).toBeNull();
    expect(getPublicNode).not.toHaveBeenCalled();
  });

  it("maps software authorship and editor accountability into ScholarlyArticle JSON-LD", () => {
    const jsonLd = buildSynthesisJsonLd(synthesis());
    expect(jsonLd).toMatchObject({
      "@type": "ScholarlyArticle",
      author: {
        "@type": "SoftwareApplication",
        "@id": SYNTHESIS_PIPELINE_SOFTWARE_ID,
      },
      editor: {
        "@type": "Person",
        name: "Accountable Editor",
        sameAs: "https://github.com/editor",
      },
      dateCreated: "2026-07-16T10:00:00.000Z",
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
