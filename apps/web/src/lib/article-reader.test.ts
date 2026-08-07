import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMystArticle, parsePreservedMarkdown, safeUnicode } from "./article-reader";

describe("preserved article reader", () => {
  it("creates deterministic structure while leaving raw HTML inert text", () => {
    const document = parsePreservedMarkdown(
      "---\ntitle: untrusted\n---\n# Results\n\n<script>alert(1)</script>\n\n- first\n- second\n",
    );
    expect(document.toc).toEqual([{ id: "article-section-1-results", level: 1, text: "Results" }]);
    expect(document.blocks).toContainEqual({
      kind: "paragraph",
      text: "<script>alert(1)</script>",
    });
    expect(document.blocks).toContainEqual({
      kind: "list",
      ordered: false,
      items: ["first", "second"],
    });
  });

  it("repairs unpaired UTF-16 surrogates before UTF-8 output", () => {
    expect(safeUnicode(`before\ud800after\udc00`)).toBe("before�after�");
    expect(safeUnicode("valid 🧪 français தமிழ்")).toBe("valid 🧪 français தமிழ்");
  });

  it("builds a multi-page MyST reader and resolves source TRUST without merging it", () => {
    const files = {
      "myst.yml": preserved(
        "project:\n  toc:\n    - file: content/intro.md\n    - title: Findings\n      children:\n        - file: content/results.md\n",
      ),
      "content/intro.md": preserved("# Introduction\n\nA **rich** review."),
      "content/results.md": preserved(
        "# Results\n\nThe effect was reproducible.\n\n:::{trust-claim}\n:claim-id: claim-1\n:score: 85\n:::",
      ),
      "knowledge/claim_graph.json": preserved(
        JSON.stringify({
          claims: [
            {
              claim_id: "claim-1",
              claim_text: "The effect was reproducible.",
              human_review_required: true,
              trust_score: {
                rubric_version: "2.0.0",
                overall_score: 85,
                trust_label: "high_trust",
                components: {
                  traceability: { score: 4, rule_id: "T4", rationale: "Exact evidence." },
                },
              },
            },
          ],
        }),
      ),
    };

    const article = buildMystArticle({
      files,
      repositoryOwner: "lab",
      repositoryName: "review",
      commitSha: "a".repeat(40),
    });

    expect(article?.rendering).toBe("myst-ast");
    expect(article?.navigation.map((entry) => entry.path)).toEqual([
      "content/intro.md",
      "content/results.md",
    ]);
    expect(article?.pages[1]?.trustClaims[0]).toMatchObject({
      claimId: "claim-1",
      overallScore: 85,
      protocolVersion: "2.0.0",
      humanReviewRequired: true,
    });
    expect(JSON.stringify(article?.pages[1]?.ast)).toContain("trustClaimMarker");
  });

  it("turns repository HTML into displayed code instead of executable markup", () => {
    const article = buildMystArticle({
      files: { "README.md": preserved("# Safe\n\n<script>alert(1)</script>") },
      repositoryOwner: "lab",
      repositoryName: "review",
      commitSha: "b".repeat(40),
    });

    expect(article?.rendering).toBe("safe-markdown");
    expect(JSON.stringify(article?.pages[0]?.ast)).toContain("<script>alert(1)</script>");
    expect(JSON.stringify(article?.pages[0]?.ast)).not.toContain('"type":"html"');
  });
});

function preserved(content: string) {
  return { size: Buffer.byteLength(content), truncated: false, content };
}
