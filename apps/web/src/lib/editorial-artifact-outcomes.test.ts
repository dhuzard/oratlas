import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  report: {
    schemaVersion: "1.1.0",
    artifactOutcomes: {
      claims: { status: "not-declared", loadedCount: 0, skippedCount: 0, sources: [] },
    },
  },
  findMany: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: { submission: { findMany: state.findMany } },
  parseJsonColumn: (_value: string | null, fallback: unknown) => fallback,
}));

vi.mock("./submission-payload", () => ({
  parseStoredSubmissionPayload: () => ({
    compatibilityReport: state.report,
    publicationTargets: { proseReview: true, knowledgeNodes: false },
  }),
  validNodeCandidates: () => [],
}));

import { listSubmissions } from "./editorial";

describe("editorial compatibility DTO", () => {
  it("projects the stored per-artifact report without deriving outcomes from empty arrays", async () => {
    state.findMany.mockResolvedValueOnce([
      {
        id: "submission-1",
        status: "pending-editorial-review",
        submittedAt: new Date("2026-07-20T00:00:00.000Z"),
        submitter: { githubLogin: "author" },
        repository: {
          canonicalUrl: "https://github.com/example/review",
          owner: "example",
          name: "review",
        },
        snapshot: { commitSha: "a".repeat(40), sourceTreeSha: "b".repeat(40) },
        inspectionCapture: { payloadHash: "c".repeat(64) },
        sourceKind: "tag",
        extractedMetadataJson: null,
        editedMetadataJson: null,
        validationReportJson: null,
        submittedPayloadJson: "stored-payload",
        editorialNote: null,
      },
    ]);

    const [submission] = await listSubmissions();
    expect(submission?.compatibilityReport).toBe(state.report);
    expect(submission?.nodeCandidates).toEqual([]);
    expect(submission?.compatibilityReport).toMatchObject({ schemaVersion: "1.1.0" });
  });
});
