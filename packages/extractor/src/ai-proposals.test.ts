import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  IngestionExtractionPacket,
  IngestionExtractionProposal,
  InspectionReport,
} from "@oratlas/contracts";
import {
  buildIngestionExtractionPacket,
  validateIngestionExtractionProposal,
} from "./ai-proposals.js";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const content = "Résumé\nClaim: Treatment reduced mortality.\nCitation: Example et al. 2025.\n";

function reportWith(files: InspectionReport["files"]): InspectionReport {
  return {
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: "lab",
      name: "review",
      canonicalUrl: "https://github.com/lab/review",
    },
    inspectedAt: "2026-08-05T00:00:00.000Z",
    status: "succeeded",
    latestCommitSha: commitSha,
    selectedSource: {
      kind: "release",
      commitSha,
      releaseTag: "v1.0.0",
      releaseUrl: "https://github.com/lab/review/releases/tag/v1.0.0",
      treeSha,
    },
    tree: [],
    treeTruncated: false,
    files,
    warnings: ["inspection warning"],
    limits: {
      maxFileBytes: 200_000,
      maxTotalBytes: 500_000,
      maxFileCount: 100,
      totalBytesFetched: Object.values(files).reduce((sum, file) => sum + file.size, 0),
      filesFetched: Object.keys(files).length,
    },
    tags: [],
    releases: [],
    topics: [],
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteSpan(packet: IngestionExtractionPacket, excerpt: string) {
  const file = packet.files[0]!;
  const all = Buffer.from(file.content, "utf8");
  const needle = Buffer.from(excerpt, "utf8");
  const startByte = all.indexOf(needle);
  if (startByte < 0) throw new Error("test excerpt is absent");
  return {
    path: file.path,
    startByte,
    endByte: startByte + needle.length,
    excerptSha256: sha256(needle),
  };
}

function validProposal(packet: IngestionExtractionPacket): IngestionExtractionProposal {
  const claim = "Treatment reduced mortality.";
  const citation = "Example et al. 2025.";
  return {
    schemaVersion: "1.0.0",
    claims: [
      {
        proposalId: "claim-1",
        text: claim,
        claimType: "effect",
        source: byteSpan(packet, claim),
      },
    ],
    citations: [
      {
        proposalId: "citation-1",
        rawCitationText: citation,
        source: byteSpan(packet, citation),
      },
    ],
    relations: [
      {
        claimProposalId: "claim-1",
        citationProposalId: "citation-1",
        relationType: "supports",
      },
    ],
    warnings: [],
  };
}

describe("buildIngestionExtractionPacket", () => {
  it("pins exact repository, commit, tree, path, bytes, and content hashes", () => {
    const packet = buildIngestionExtractionPacket(
      reportWith({
        "review.md": {
          path: "review.md",
          size: Buffer.byteLength(content),
          content,
          truncated: false,
        },
      }),
    );

    expect(packet).toMatchObject({
      schemaVersion: "1.0.0",
      repositoryUrl: "https://github.com/lab/review",
      commitSha,
      treeSha,
      warnings: ["inspection warning"],
    });
    expect(packet.files).toEqual([
      {
        path: "review.md",
        byteLength: Buffer.byteLength(content, "utf8"),
        sha256: sha256(content),
        content,
      },
    ]);
  });

  it("fails closed without an exact selected source or any eligible text", () => {
    const report = reportWith({});
    delete report.selectedSource;
    expect(() => buildIngestionExtractionPacket(report)).toThrow(/exact inspected source/i);

    expect(() =>
      buildIngestionExtractionPacket(
        reportWith({
          "figure.png": { path: "figure.png", size: 4, content: "data", truncated: false },
        }),
      ),
    ).toThrow(/at least one eligible, non-truncated text file/i);
  });

  it("excludes truncated and over-budget material deterministically", () => {
    const large = "x".repeat(50_001);
    const packet = buildIngestionExtractionPacket(
      reportWith({
        "a.md": { path: "a.md", size: content.length, content, truncated: false },
        "b.md": { path: "b.md", size: 4, content: "skip", truncated: true },
        "c.md": { path: "c.md", size: large.length, content: large, truncated: false },
      }),
    );
    expect(packet.files.map((file) => file.path)).toEqual(["a.md"]);
    expect(packet.warnings.join(" ")).toMatch(/c\.md.*bound/i);
  });
});

describe("validateIngestionExtractionProposal", () => {
  const packet = buildIngestionExtractionPacket(
    reportWith({
      "review.md": {
        path: "review.md",
        size: Buffer.byteLength(content),
        content,
        truncated: false,
      },
    }),
  );

  it("accepts only proposals grounded in exact UTF-8 byte spans", () => {
    expect(validateIngestionExtractionProposal(validProposal(packet), packet)).toEqual({
      ok: true,
      proposal: validProposal(packet),
      issues: [],
    });
  });

  it("rejects modified hashes, unknown files, and non-exact citation text", () => {
    const modified = validProposal(packet);
    modified.claims[0]!.source.excerptSha256 = "0".repeat(64);
    modified.citations[0]!.source.path = "missing.md";
    modified.citations[0]!.rawCitationText = "A fabricated citation";
    const result = validateIngestionExtractionProposal(modified, packet);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/hash mismatch/i);
    expect(result.issues.join(" ")).toMatch(/unknown source file/i);

    const wrongText = validProposal(packet);
    wrongText.citations[0]!.rawCitationText = "Example et al. 2024.";
    expect(validateIngestionExtractionProposal(wrongText, packet).issues.join(" ")).toMatch(
      /not the exact source span/i,
    );

    const whitespaceSpan = validProposal(packet);
    whitespaceSpan.citations[0]!.source = byteSpan(packet, " Example et al. 2025.");
    expect(validateIngestionExtractionProposal(whitespaceSpan, packet).issues.join(" ")).toMatch(
      /not the exact source span/i,
    );
  });

  it("rejects duplicate proposal ids and dangling relation references", () => {
    const modified = validProposal(packet);
    modified.claims.push(structuredClone(modified.claims[0]!));
    modified.relations[0]!.citationProposalId = "missing-citation";
    const result = validateIngestionExtractionProposal(modified, packet);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("duplicate claim proposal id claim-1");
    expect(result.issues).toContain("relation references an unknown citation");
  });

  it("rejects tampered packet bytes and duplicate relations", () => {
    const tampered = structuredClone(packet);
    tampered.files[0]!.content += "changed";
    const proposal = validProposal(packet);
    proposal.relations.push(structuredClone(proposal.relations[0]!));
    const result = validateIngestionExtractionProposal(proposal, tampered);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("packet byte length mismatch review.md");
    expect(result.issues).toContain("packet file hash mismatch review.md");
    expect(result.issues).toContain("duplicate extraction relation");
  });

  it("rejects byte spans that split a multibyte UTF-8 character", () => {
    const modified = validProposal(packet);
    modified.claims[0]!.source = {
      path: "review.md",
      startByte: 1,
      endByte: 2,
      excerptSha256: sha256(Buffer.from(content, "utf8").subarray(1, 2)),
    };
    const result = validateIngestionExtractionProposal(modified, packet);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/UTF-8 boundaries/i);
  });
});
