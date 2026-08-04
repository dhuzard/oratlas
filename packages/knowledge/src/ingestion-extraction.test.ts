import { describe, expect, it } from "vitest";
import {
  extractIngestionCandidates,
  prepareIngestionExtractionPacket,
} from "./ingestion-extraction.js";
import type { LlmProvider } from "./discuss.js";

const source = [
  "The intervention reduced immobility in the prespecified primary analysis.",
  "The analysis used dataset DOI 10.1234/example.dataset.",
].join("\n");

function packet() {
  return prepareIngestionExtractionPacket({
    repository: {
      url: "https://github.com/example/review",
      commitSha: "b".repeat(40),
    },
    files: [{ path: "article.md", content: source }],
    existing: {
      claimCount: 0,
      citationCount: 0,
      nodeCount: 0,
      declaredClaimTexts: [],
    },
  });
}

function provider(outputs: string[]): LlmProvider {
  let index = 0;
  return {
    name: "test",
    model: "offline",
    async complete() {
      return outputs[Math.min(index++, outputs.length - 1)]!;
    },
  };
}

describe("ingestion extraction", () => {
  it("retries a non-verbatim source quote and accepts linked grounded candidates", async () => {
    const build = (quote: string) =>
      JSON.stringify({
        decision: "extract",
        claims: [
          {
            temporaryId: "claim-1",
            text: "The intervention reduced immobility in the primary analysis.",
            claimType: "empirical",
            source: { sourcePath: "article.md", sourceQuote: quote },
          },
        ],
        evidence: [
          {
            temporaryId: "evidence-1",
            title: "Example dataset",
            kind: "dataset",
            doi: "10.1234/example.dataset",
            source: {
              sourcePath: "article.md",
              sourceQuote: "The analysis used dataset DOI 10.1234/example.dataset.",
            },
          },
        ],
        relations: [
          {
            claimId: "claim-1",
            evidenceId: "evidence-1",
            relationType: "method-source",
            rationale: "The repository explicitly identifies this dataset as an analysis input.",
          },
        ],
        limitations: ["The candidate has not been reviewed by a human editor."],
      });
    const result = await extractIngestionCandidates(
      provider([
        build("The intervention definitely cured every animal."),
        build("The intervention reduced immobility in the prespecified primary analysis."),
      ]),
      packet(),
    );
    expect(result.attempts).toBe(2);
    expect(result.decision).toMatchObject({
      decision: "extract",
      claims: [{ temporaryId: "claim-1" }],
      evidence: [{ temporaryId: "evidence-1" }],
    });
  });

  it("rejects dangling relation identifiers", async () => {
    const invalid = JSON.stringify({
      decision: "extract",
      claims: [
        {
          temporaryId: "claim-1",
          text: "The intervention reduced immobility in the primary analysis.",
          claimType: "empirical",
          source: {
            sourcePath: "article.md",
            sourceQuote: "The intervention reduced immobility in the prespecified primary analysis.",
          },
        },
      ],
      evidence: [],
      relations: [
        {
          claimId: "claim-1",
          evidenceId: "missing",
          relationType: "supports",
          rationale: "This relation points to an evidence object that was never extracted.",
        },
      ],
      limitations: [],
    });
    const result = await extractIngestionCandidates(provider([invalid]), packet(), 1);
    expect(result.decision).toBeUndefined();
    expect(result.error).toContain("unknown temporary identifier");
  });

  it("preserves abstention", async () => {
    const result = await extractIngestionCandidates(
      provider([
        JSON.stringify({
          decision: "abstain",
          reason: "The captured files contain no explicit claim and evidence relationship to extract.",
          missingEvidence: ["A scientific results section"],
        }),
      ]),
      packet(),
    );
    expect(result.decision?.decision).toBe("abstain");
  });
});
