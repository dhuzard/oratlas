import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PublicationVersionPacket } from "@oratlas/contracts";
import { CertifierApiClient, OraCertificationService } from "./index.js";
import { createDeterministicOraTestEvaluator, type OraTestScenario } from "./testing.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const packetSha256 = sha("frozen-run-input");
const contentText =
  "Synthetic objectives, methods, results, uncertainty, limitations, and disclosures.";
const packet: PublicationVersionPacket = {
  schemaVersion: "1.2.0",
  publication: {
    id: "publication-1",
    publicationType: "research-article",
    recordSource: "external-publication",
    sourceLocalPublicationId: "demo",
  },
  version: {
    id: "version-1",
    sourcesSha256: sha("sources"),
    sourceLocalPublicationId: "demo",
    versionLabel: "v1",
    title: "Demo / synthetic",
    publisherCanonicalUrl: null,
    observedPublicationBaseUrl: "https://publisher.example/demo/",
    adapterType: "myst",
    structuralProvenance: "published-structure",
    observedAt: "2026-08-24T00:00:00.000Z",
  },
  captures: [
    {
      id: "capture-1",
      artifactKind: "published-page-data",
      declaredPath: "article.md",
      requestedUrl: "https://publisher.example/demo/article.md",
      observedUrl: "https://publisher.example/demo/article.md",
      contentSha256: sha(contentText),
      byteLength: contentText.length,
      structuralProvenance: "published-structure",
    },
  ],
  content: [
    {
      id: "content-1",
      title: "Demo",
      role: "other",
      sourcePath: "article.md",
      publishedUrl: "https://publisher.example/demo/",
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

function apiHarness() {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetcher = vi.fn(async (request: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(request));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url.pathname, method, body });
    if (url.pathname === "/api/certification-runs")
      return Response.json(
        { id: "run-1", status: "running", input: { packetSha256 } },
        { status: 201 },
      );
    if (url.pathname.endsWith("/input"))
      return Response.json({ certificationRunId: "run-1", packetSha256, packet });
    if (url.pathname.endsWith("/result"))
      return Response.json({ id: "result-1", ...body }, { status: 201 });
    if (url.pathname.endsWith("/transition")) return Response.json({ status: body.status });
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  });
  return {
    client: new CertifierApiClient(
      "https://atlas.example",
      "scoped-token",
      fetcher as typeof fetch,
    ),
    requests,
  };
}

describe("ORA API-only certification service", () => {
  it.each([
    ["strong", "certified"],
    ["concern", "certified-with-conditions"],
    ["failure", "not-certified"],
    ["incomplete", "inconclusive"],
  ] as const)(
    "submits the deterministic %s fixture as %s through generic HTTP",
    async (scenario, outcome) => {
      const { client, requests } = apiHarness();
      const recorder = {
        recordSucceeded: vi
          .fn()
          .mockResolvedValue({ agentRunId: "agent-run-1", structuredOutputSha256: sha("output") }),
      };
      const completed = await new OraCertificationService(
        client,
        createDeterministicOraTestEvaluator(scenario as OraTestScenario),
        recorder,
      ).certify({
        publicationVersionId: "version-1",
        certificationProtocolId: "protocol-1",
        idempotencyKey: `scenario-${scenario}`,
      });
      expect(completed.outcome).toBe(outcome);
      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "POST /api/certification-runs",
        "GET /api/certification-runs/run-1/input",
        "POST /api/certification-runs/run-1/result",
      ]);
      expect(requests[2]?.body).toMatchObject({
        outcome,
        packetSha256,
        conflictOfInterest: { status: "not-provided" },
        provenance: {
          agentRunId: "agent-run-1",
          promptVersion: "ora-scientific-merit-pilot-0.1.0",
        },
      });
      expect(recorder.recordSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({ packetSha256 }),
      );
    },
  );

  it("marks the generic run failed when evaluator execution fails", async () => {
    const { client, requests } = apiHarness();
    const evaluator = { evaluate: vi.fn().mockRejectedValue(new Error("provider unavailable")) };
    await expect(
      new OraCertificationService(client, evaluator, {
        recordSucceeded: vi.fn(),
      }).certify({
        publicationVersionId: "version-1",
        certificationProtocolId: "protocol-1",
        idempotencyKey: "provider-failure",
      }),
    ).rejects.toThrow("provider unavailable");
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /api/certification-runs",
      "GET /api/certification-runs/run-1/input",
      "POST /api/certification-runs/run-1/transition",
    ]);
    expect(requests.at(-1)?.body).toEqual({
      status: "failed",
      reason: "ORA evaluator failed: provider unavailable",
    });
  });

  it("binds result outcome to deterministic criteria rather than an evaluator field", async () => {
    const { client, requests } = apiHarness();
    const base = await createDeterministicOraTestEvaluator("failure").evaluate({
      packet,
      protocol: (await import("@oratlas/contracts")).ORA_SCIENTIFIC_MERIT_PROTOCOL_DEFINITION,
    });
    const evaluator = { evaluate: vi.fn().mockResolvedValue({ ...base, outcome: "certified" }) };
    const completed = await new OraCertificationService(client, evaluator, {
      recordSucceeded: vi
        .fn()
        .mockResolvedValue({ agentRunId: "agent", structuredOutputSha256: sha("output") }),
    }).certify({
      publicationVersionId: "version-1",
      certificationProtocolId: "protocol-1",
      idempotencyKey: "model-outcome-ignored",
    });
    expect(completed.outcome).toBe("not-certified");
    expect(requests[2]?.body).toMatchObject({ outcome: "not-certified" });
  });
});
