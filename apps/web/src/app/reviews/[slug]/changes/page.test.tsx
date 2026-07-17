import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSynthesisGenerationDiff } from "@/lib/synthesis-generation-diff";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/synthesis-generation-diff", () => ({
  getPublicSynthesisGenerationDiff: vi.fn(),
}));

import { getPublicSynthesisGenerationDiff } from "@/lib/synthesis-generation-diff";
import SynthesisChangesPage from "./page";

const mockedLoader = vi.mocked(getPublicSynthesisGenerationDiff);
const hash = "a".repeat(64);
const referenceId = "reference:sha256:" + "b".repeat(64);

function result(): PublicSynthesisGenerationDiff {
  return {
    slug: "bounded-synthesis",
    title: "Bounded synthesis",
    from: {
      id: "version-1",
      ordinal: 1,
      acceptedAt: "2026-01-15T00:00:00.000Z",
      packetHash: hash,
      documentHash: "c".repeat(64),
    },
    to: {
      id: "version-2",
      ordinal: 2,
      acceptedAt: "2026-02-15T00:00:00.000Z",
      packetHash: "d".repeat(64),
      documentHash: "e".repeat(64),
    },
    delta: {
      schemaVersion: "synthesis-generation-delta/1.0.0",
      previous: { packetHash: hash, documentHash: "c".repeat(64) },
      current: { packetHash: "d".repeat(64), documentHash: "e".repeat(64) },
      nodes: {
        added: [
          {
            nodeId: "node-b",
            nodeVersionId: "node-b-v1",
            referenceId,
          },
        ],
        removed: [],
        reassessed: [
          {
            nodeId: "node-a",
            previous: { nodeVersionId: "node-a-v1", referenceId },
            current: { nodeVersionId: "node-a-v2", referenceId },
          },
        ],
      },
      confirmedEdges: {
        added: [],
        removed: [],
        changed: [
          {
            edgeId: "edge-trust",
            previous: {
              source: { nodeId: "node-a", nodeVersionId: "node-a-v1" },
              relationType: "uses-dataset",
              target: { nodeId: "node-b", nodeVersionId: "node-b-v1" },
            },
            current: {
              source: { nodeId: "node-a", nodeVersionId: "node-a-v2" },
              relationType: "uses-dataset",
              target: { nodeId: "node-b", nodeVersionId: "node-b-v1" },
            },
            changedFields: ["binding", "trust"],
          },
        ],
      },
      contradictions: {
        opened: [
          {
            left: { nodeId: "node-a", nodeVersionId: "node-a-v2" },
            right: { nodeId: "node-b", nodeVersionId: "node-b-v1" },
            edgeIds: ["edge-contradiction"],
          },
        ],
        resolved: [],
      },
      sectionText: [
        {
          sectionId: "background",
          title: "Background",
          paragraphChanges: [
            {
              paragraphIndex: 0,
              previousText: "Previous public text.",
              currentText: "Current public text.",
            },
          ],
        },
      ],
      secondaryDocument: {
        title: { previous: "Previous title", current: "Current title" },
        paragraphCitations: [],
      },
      isNoop: false,
      checksum: "f".repeat(64),
    },
  };
}

beforeEach(() => {
  mockedLoader.mockReset();
  mockedLoader.mockResolvedValue(result());
});

describe("synthesis generation changes page", () => {
  it("renders structured evidence before secondary text with accessible deterministic metadata", async () => {
    const element = await SynthesisChangesPage({
      params: Promise.resolve({ slug: "bounded-synthesis" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('id="structured-evidence-delta"');
    expect(html).toContain("Re-assessed at a new immutable version");
    expect(html).toContain("TRUST re-assessed");
    expect(html).toContain("Contradiction pairs");
    expect(html).toContain('id="secondary-document-delta"');
    expect(html.indexOf("Structured evidence delta")).toBeLessThan(
      html.indexOf("Secondary review document delta"),
    );
    expect(html).toContain("Canonical delta SHA-256");
    expect(html).toContain("f".repeat(64));
    expect(html).not.toContain("packetJson");
    expect(html).not.toContain("documentJson");
    expect(html).not.toContain("agentRun");
  });
});
