import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
  canonicalJson,
  type PublicationVersionPacket,
} from "@oratlas/contracts";
import {
  OraScientificMeritEvaluator,
  ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT,
} from "./ora-certification-evaluator.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const contentText =
  "Objective, methods, results, uncertainty, limitations, disclosures, data and code.";
const packet: PublicationVersionPacket = {
  schemaVersion: "1.2.0",
  publication: {
    id: "publication-1",
    publicationType: "research-article",
    recordSource: "external-publication",
    sourceLocalPublicationId: "publication-1",
  },
  version: {
    id: "version-1",
    sourcesSha256: sha("sources"),
    sourceLocalPublicationId: "publication-1",
    versionLabel: "v1",
    title: "Synthetic publication",
    publisherCanonicalUrl: null,
    observedPublicationBaseUrl: "https://publisher.example/article/",
    adapterType: "myst",
    structuralProvenance: "published-structure",
    observedAt: "2026-08-24T00:00:00.000Z",
  },
  captures: [
    {
      id: "capture-1",
      artifactKind: "published-page-data",
      declaredPath: "article.md",
      requestedUrl: "https://publisher.example/article/article.md",
      observedUrl: "https://publisher.example/article/article.md",
      contentSha256: sha(contentText),
      byteLength: contentText.length,
      structuralProvenance: "published-structure",
    },
  ],
  content: [
    {
      id: "content-1",
      title: "Article",
      role: "other",
      sourcePath: "article.md",
      publishedUrl: "https://publisher.example/article/",
      representation: "published-structured-text",
      text: contentText,
      sha256: sha(contentText),
      sourceArtifactIdentitySha256: sha("slot"),
      sourceArtifactSha256: sha(contentText),
    },
  ],
  occurrences: [],
  productionProvenance: [],
  relations: [],
  challenges: [],
  completeness: {
    captures: { returned: 1, total: 1, truncated: false },
    content: {
      returnedDocuments: 1,
      totalDocumentsKnown: null,
      truncated: false,
      coverage: "partial",
    },
    occurrences: { returned: 0, total: 0, truncated: false },
    productionProvenance: { returned: 0, total: 0, truncated: false },
    relations: { returned: 0, total: 0, truncated: false },
    challenges: { returned: 0, total: 0, truncated: false },
  },
  links: {
    self: "/api/publication-versions/version-1/packet",
    publication: "/api/publications/publication-1",
    publicationVersion: "/api/publication-versions/version-1",
    content: "/api/publication-versions/version-1/content",
    productionProvenance: "/api/publication-versions/version-1/production-provenance",
  },
  sha256: sha("packet"),
};

function output(evidenceId = "content-1", extra: Record<string, unknown> = {}) {
  return canonicalJson({
    criteria: ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION.criteria.map((criterion) => ({
      criterionId: criterion.id,
      status: "pass",
      rationale: `Packet evidence satisfies ${criterion.id}.`,
      evidenceRefs: [{ type: "publication-content-document", id: evidenceId }],
    })),
    limitations: ["Synthetic evaluator fixture."],
    ...extra,
  });
}

describe("ORA AI evaluator", () => {
  it("uses a bounded provider-neutral JSON request and adds packet-specific limitations", async () => {
    const complete = vi.fn().mockResolvedValue(output());
    const result = await new OraScientificMeritEvaluator({
      name: "fixture-provider",
      model: "fixture-model",
      modelVersion: "2026-08",
      complete,
    }).evaluate({ packet, protocol: ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION });
    expect(result.criteria).toHaveLength(10);
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("partial"),
        expect.stringContaining("TRUST"),
        expect.stringContaining("challenges"),
      ]),
    );
    expect(result.executionMetadata.structuredOutputSha256).toBe(
      sha(canonicalJson({ criteria: result.criteria, limitations: result.limitations })),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        promptVersion: "ora-scientific-merit-pilot-0.1.0",
        maxTokens: 4_000,
        maxResponseBytes: 131_072,
      }),
    );
  });

  it("rejects hallucinated packet evidence after bounded retries", async () => {
    const complete = vi.fn().mockResolvedValue(output("invented"));
    await expect(
      new OraScientificMeritEvaluator({
        name: "fixture-provider",
        model: "fixture-model",
        complete,
      }).evaluate({ packet, protocol: ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION }),
    ).rejects.toThrow(/after 2 attempts.*unknown packet reference/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not accept a model-selected final outcome", async () => {
    const complete = vi.fn().mockResolvedValue(output("content-1", { outcome: "certified" }));
    await expect(
      new OraScientificMeritEvaluator({
        name: "fixture-provider",
        model: "fixture-model",
        complete,
      }).evaluate({ packet, protocol: ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION }),
    ).rejects.toThrow(/after 2 attempts/);
  });

  it("makes frozen-packet, missing-information, production-neutrality, and challenge caveats explicit", () => {
    expect(ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT).toMatch(/only the supplied frozen packet/i);
    expect(ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT).toMatch(/Missing information is not failure/i);
    expect(ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT).toMatch(
      /Human, AI-assisted, and agentic production modes do not determine scientific quality/i,
    );
    expect(ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT).toMatch(/empty challenges array is not proof/i);
    expect(ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT).toMatch(
      /Do not browse, fetch URLs, call tools, or execute code/i,
    );
  });
});
