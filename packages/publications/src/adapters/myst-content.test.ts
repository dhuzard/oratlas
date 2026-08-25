import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@oratlas/contracts";
import { normalizeMystPublicationContent } from "./myst-content.js";
import type { CapturedPublicationArtifact } from "../adapter.js";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function artifact(
  artifactKind: CapturedPublicationArtifact["artifactKind"],
  declaredPath: string,
  value: unknown,
): CapturedPublicationArtifact {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    artifactKind,
    declaredPath,
    mediaType: "application/json",
    bytes,
    contentSha256: digest(bytes),
  };
}

const context = {
  publicationVersionStableKey: "publication-version:test",
  publicationBaseUrl: "https://example.org/article/",
  limits: {
    maxDocuments: 8,
    maxBytesPerDocument: 100_000,
    maxTotalBytes: 200_000,
    maxTextLength: 20_000,
    maxNodesPerDocument: 1_000,
  },
};

function fixture() {
  return [
    artifact("cross-reference-inventory", "myst.xref.json", {
      references: [
        { kind: "page", url: "/methods/", data: "/content/methods.json" },
        { identifier: "results", url: "/results/", data: "content/results.json" },
      ],
    }),
    artifact("published-page-data", "content/results.json", {
      title: "Results",
      mdast: {
        type: "root",
        children: [
          {
            type: "block",
            children: [
              {
                type: "heading",
                depth: 1,
                children: [{ type: "text", value: "Results" }],
              },
              {
                type: "div",
                data: { oratlas: { kind: "claim", id: "result-1" } },
                children: [
                  {
                    type: "paragraph",
                    children: [
                      {
                        type: "text",
                        value: "The intervention improved the primary outcome.",
                      },
                    ],
                  },
                ],
              },
              {
                type: "table",
                children: [
                  {
                    type: "tableRow",
                    children: [
                      { type: "tableCell", children: [{ type: "text", value: "Group" }] },
                      { type: "tableCell", children: [{ type: "text", value: "Mean" }] },
                    ],
                  },
                ],
              },
            ],
          },
          { type: "html", value: "<script>globalThis.executed = true</script>" },
          {
            type: "pluginOutput",
            children: [{ type: "text", value: "secret executable plugin output" }],
          },
          { type: "iframe", children: [{ type: "text", value: "hidden frame" }] },
        ],
      },
    }),
    artifact("published-page-data", "content/methods.json", {
      mdast: {
        type: "root",
        children: [
          { type: "heading", depth: 1, children: [{ type: "text", value: "Methods" }] },
          {
            type: "paragraph",
            children: [
              { type: "text", value: "We used a prespecified protocol with " },
              { type: "inlineMath", value: "n=120" },
              { type: "text", value: "." },
            ],
          },
        ],
      },
    }),
  ];
}

describe("MyST normalized publication content", () => {
  it("produces deterministic scientific text from captured structured pages", () => {
    const first = normalizeMystPublicationContent(fixture(), context);
    const replay = normalizeMystPublicationContent(fixture(), context);
    expect(canonicalJson(replay)).toBe(canonicalJson(first));
    expect(first.documents.map(({ role, sourcePath }) => ({ role, sourcePath }))).toEqual([
      { role: "methods", sourcePath: "content/methods.json" },
      { role: "results", sourcePath: "content/results.json" },
    ]);
    expect(first.documents[0]?.text).toContain("prespecified protocol");
    expect(first.documents[0]?.text).toContain("$n=120$");
    expect(first.documents[1]?.text).toContain("Group");
    expect(first.documents[1]?.text).toContain("primary outcome");
    expect(first.completeness).toEqual({
      returnedDocuments: 2,
      totalDocumentsKnown: 2,
      truncated: false,
      coverage: "partial",
    });
  });

  it("never executes or preserves HTML, frames, scripts, or plugin output", () => {
    delete (globalThis as { executed?: boolean }).executed;
    const corpus = normalizeMystPublicationContent(fixture(), context);
    const text = corpus.documents.map((document) => document.text).join("\n");
    expect((globalThis as { executed?: boolean }).executed).toBeUndefined();
    expect(text).not.toMatch(/script|iframe|plugin output|globalThis/u);
  });

  it("applies document and text limits with explicit truncation", () => {
    const corpus = normalizeMystPublicationContent(fixture(), {
      ...context,
      limits: { ...context.limits, maxDocuments: 1, maxTextLength: 30 },
    });
    expect(corpus.documents).toHaveLength(1);
    expect(corpus.documents[0]!.text.length).toBeLessThanOrEqual(30);
    expect(corpus.completeness).toMatchObject({
      returnedDocuments: 1,
      totalDocumentsKnown: 2,
      truncated: true,
      coverage: "partial",
    });
  });

  it("fails closed on excessive safe-node depth without executing or aborting normalization", () => {
    let nested: Record<string, unknown> = { type: "text", value: "too deep" };
    for (let index = 0; index < 140; index += 1) {
      nested = { type: "blockquote", children: [nested] };
    }
    const artifacts = fixture();
    artifacts[1] = artifact("published-page-data", "content/results.json", {
      title: "Results",
      mdast: { type: "root", children: [nested] },
    });
    const corpus = normalizeMystPublicationContent(artifacts, context);
    expect(corpus.completeness.truncated).toBe(true);
    expect(corpus.documents.some((document) => document.text.includes("too deep"))).toBe(false);
  });
});
