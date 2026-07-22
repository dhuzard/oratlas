import { describe, expect, it } from "vitest";
import type { PublicChallenge } from "@oratlas/contracts";
import { scholarlyJson, scholarlyJsonDocument, type ScholarlyJsonInput } from "./scholarly-json.js";
import type { VersionExportInput } from "./types.js";

const version: VersionExportInput = {
  platformVersion: "0.1.0",
  slug: "review",
  versionId: "version-1",
  title: "Review",
  contributors: [],
  keywords: [],
  domains: [],
  isExample: false,
  repositoryUrl: "https://github.com/example/review",
  commitSha: "a".repeat(40),
  canonicalUrl: "https://atlas.example/reviews/review/versions/version-1",
};

const challenge: PublicChallenge = {
  id: "challenge-1",
  reviewVersionId: "version-1",
  subjectType: "assessment-criterion",
  subjectLabel: "Entailment",
  subjectHref: "/reviews/review/versions/version-1#assessment-subject-assessment-1-entailment",
  canonicalSubjectHash: "b".repeat(64),
  filedContentHash: "c".repeat(64),
  grounds: "entailment",
  body: "Public objection.",
  contentStatus: "visible",
  contentRevision: 0,
  status: "resolved",
  revision: 1,
  challenger: { githubLogin: "challenger", displayName: "Challenger" },
  transitions: [
    {
      id: "PRIVATE-TRANSITION-ID",
      fromStatus: null,
      toStatus: "open",
      actor: { githubLogin: "challenger" },
      conflictOfInterest: { status: "not-provided" },
      revision: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  response: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

const input: ScholarlyJsonInput = {
  version,
  assessments: [
    {
      id: "assessment-2",
      url: `${version.canonicalUrl}#assessment-assessment-2`,
      relation: {
        id: "relation-1",
        claim: { localId: "claim-1", url: `${version.canonicalUrl}#claim-1` },
        citation: { localId: "citation-1" },
        relationType: "supports",
      },
      protocolVersion: "trust-v2",
      assessor: { type: "human", identifier: "reviewer-b" },
      assessedAt: "2026-07-03T00:00:00.000Z",
      criteria: { entailment: { rating: "low", status: "assessed" } },
      limitations: [],
      verification: {
        state: "unverified-import",
        effectiveReviewStatus: "unverified-import",
        sourceAssertion: { reviewStatus: "human-reviewed" },
      },
    },
    {
      id: "assessment-1",
      url: `${version.canonicalUrl}#assessment-assessment-1`,
      relation: {
        id: "relation-1",
        claim: { localId: "claim-1", url: `${version.canonicalUrl}#claim-1` },
        citation: { localId: "citation-1" },
        relationType: "supports",
      },
      protocolVersion: "trust-v2",
      assessor: { type: "human", identifier: "reviewer-a" },
      assessedAt: "2026-07-02T00:00:00.000Z",
      criteria: { entailment: { rating: "high", status: "assessed" } },
      limitations: ["Independent assessment disagrees."],
      verification: {
        state: "platform-verified",
        effectiveReviewStatus: "human-reviewed",
        platformAssertion: {
          status: "human-reviewed",
          reviewerLogin: "atlas-editor",
          reviewedAt: "2026-07-02T00:00:00.000Z",
        },
      },
    },
  ],
  challenges: [challenge],
  sourceDocuments: [],
};

describe("scholarly JSON", () => {
  it("preserves disagreeing assessments as independent records without synthesizing fields", () => {
    const document = scholarlyJsonDocument(input);
    expect(document.assessments.map(({ id }) => id)).toEqual(["assessment-1", "assessment-2"]);
    expect(document.assessments.map(({ criteria }) => criteria.entailment?.rating)).toEqual([
      "high",
      "low",
    ]);
    const serialized = scholarlyJson(input);
    expect(serialized).toBe(
      scholarlyJson({ ...input, assessments: [...input.assessments].reverse() }),
    );
    expect(serialized).not.toMatch(/aggregate|disagreement|crosswalk/i);
  });

  it("uses the ratified assessment time/type/id/protocol/assessment ordering", () => {
    const sameTime = input.assessments.map((assessment) => ({
      ...assessment,
      assessedAt: "2026-07-02T00:00:00.000Z",
    }));
    const reversedIds = sameTime.map((assessment, index) => ({
      ...assessment,
      id: index === 0 ? "assessment-a" : "assessment-z",
      assessor: { type: "human", identifier: index === 0 ? "reviewer-b" : "reviewer-a" },
    }));
    expect(
      scholarlyJsonDocument({ ...input, assessments: reversedIds }).assessments.map(
        ({ assessor }) => assessor.identifier,
      ),
    ).toEqual(["reviewer-a", "reviewer-b"]);
  });

  it("whitelists the public challenge projection and preserved-document metadata", () => {
    const serialized = scholarlyJson({
      ...input,
      sourceDocuments: [
        {
          kind: "trust",
          path: "TRUST.md",
          status: "preserved",
          size: 42,
          contentHash: "d".repeat(64),
          provenance: {
            source: "repository-file",
            commitSha: version.commitSha,
            extractorVersion: "extractor-1",
          },
          downloadUrl: "https://atlas.example/api/reviews/review/versions/version-1/files/TRUST.md",
        },
      ],
    });
    expect(serialized).toContain("Public objection.");
    expect(serialized).toContain("TRUST.md");
    expect(serialized).toContain(
      "https://atlas.example/reviews/review/versions/version-1#assessment-subject-assessment-1-entailment",
    );
    expect(serialized).toContain(
      "https://atlas.example/reviews/review/versions/version-1#challenge-challenge-1",
    );
    expect(serialized).not.toContain("PRIVATE-TRANSITION-ID");
    expect(serialized).not.toMatch(/rationale|roleSnapshot|actorId/);
  });
});
